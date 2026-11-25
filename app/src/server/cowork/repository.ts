import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ScheduledPromptRun, ScheduledPromptTask, ScheduledPromptTaskInput } from '../../types/scheduled-prompt-task';
import type { LegacyStore } from './legacy-import';
import { advanceSchedule, catchUpAge, executionLease, historyAge, historyLimit, nextRunAt } from './schedule';

type TaskRow = { owner: string; data: string };
type RunRow = TaskRow & { lease_until: string | null };
type Outcome = Pick<ScheduledPromptRun, 'resultText' | 'errorCode' | 'errorMessage'> & {
    status: 'success' | 'failed' | 'skipped';
};

const interrupted = {
    status: 'failed',
    errorCode: 'INTERRUPTED',
    errorMessage: 'サーバーの停止などにより実行が中断されました。'
} satisfies Outcome;

export class CoWorkRepository {
    constructor(private readonly db: Database.Database) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS cowork_tasks (
                owner TEXT NOT NULL,
                id TEXT NOT NULL,
                due_at TEXT,
                data TEXT NOT NULL,
                PRIMARY KEY (owner, id)
            );
            CREATE INDEX IF NOT EXISTS cowork_due ON cowork_tasks(due_at) WHERE due_at IS NOT NULL;
            CREATE TABLE IF NOT EXISTS cowork_runs (
                owner TEXT NOT NULL,
                id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                trigger TEXT NOT NULL,
                scheduled_at TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                status TEXT NOT NULL,
                lease_until TEXT,
                data TEXT NOT NULL,
                PRIMARY KEY (owner, id)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS cowork_occurrence
                ON cowork_runs(owner, task_id, scheduled_at) WHERE trigger = 'scheduled';
            CREATE UNIQUE INDEX IF NOT EXISTS cowork_running
                ON cowork_runs(status) WHERE status = 'running';
            CREATE INDEX IF NOT EXISTS cowork_history ON cowork_runs(owner, started_at DESC);
            CREATE INDEX IF NOT EXISTS cowork_pending
                ON cowork_runs(status, scheduled_at) WHERE status IN ('queued', 'running');
            CREATE TABLE IF NOT EXISTS cowork_import (
                owner TEXT NOT NULL,
                kind TEXT NOT NULL,
                id TEXT NOT NULL,
                PRIMARY KEY (owner, kind, id)
            );
        `);
    }

    list(owner: string, now = new Date()) {
        const tasks = this.db.prepare<[string], TaskRow>(
            'SELECT data FROM cowork_tasks WHERE owner = ? ORDER BY rowid'
        ).all(owner).map(row => JSON.parse(row.data) as ScheduledPromptTask);
        const runs = this.db.prepare<[string, string, number], RunRow>(`
            SELECT data FROM cowork_runs WHERE owner = ?
                AND (started_at >= ? OR status IN ('queued', 'running'))
            ORDER BY started_at DESC, rowid DESC LIMIT ?
        `).all(owner, new Date(now.getTime() - historyAge).toISOString(), historyLimit)
            .map(row => JSON.parse(row.data) as ScheduledPromptRun);
        return { tasks, runs };
    }

    activity(owner: string, now = new Date()) {
        return this.db.prepare<[string, string, number], { id: string }>(`
            SELECT id FROM cowork_runs WHERE owner = ? AND finished_at IS NOT NULL
                AND started_at >= ? ORDER BY finished_at DESC, rowid DESC LIMIT ?
        `).all(owner, new Date(now.getTime() - historyAge).toISOString(), historyLimit)
            .map(row => row.id);
    }

    create(owner: string, input: ScheduledPromptTaskInput, now = new Date()) {
        const task = {
            ...input,
            id: randomUUID(),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            nextRunAt: ''
        };
        task.nextRunAt = nextRunAt(task, now);
        this.saveTask(owner, task);
        return task;
    }

    update(owner: string, id: string, input: ScheduledPromptTaskInput | { enabled: boolean }, now = new Date()) {
        return this.db.transaction(() => {
            const previous = this.findTask(owner, id);
            if (!previous) return undefined;
            const task = { ...previous, ...input, updatedAt: now.toISOString() };
            if ('schedule' in input || (task.enabled && task.nextRunAt <= task.updatedAt)) {
                task.nextRunAt = nextRunAt(task, now);
            }
            this.saveTask(owner, task);
            return task;
        }).immediate();
    }

    delete(owner: string, id: string, now = new Date()) {
        return this.db.transaction(() => {
            if (!this.db.prepare('DELETE FROM cowork_tasks WHERE owner = ? AND id = ?').run(owner, id).changes) {
                return false;
            }
            const queued = this.findPending(owner, id);
            if (queued?.status === 'queued') {
                this.saveRun(owner, {
                    ...queued,
                    status: 'skipped',
                    finishedAt: now.toISOString(),
                    errorCode: 'TASK_DELETED',
                    errorMessage: '実行開始前にタスクが削除されました。'
                });
                this.prune(owner, now);
            }
            return true;
        }).immediate();
    }

    enqueue(owner: string, id: string, now = new Date()) {
        return this.db.transaction(() => {
            const task = this.findTask(owner, id);
            if (!task) return undefined;
            const pending = this.findPending(owner, id);
            if (pending) return pending;
            const at = now.toISOString();
            const run = this.newRun(task, 'manual', at, at);
            this.saveRun(owner, run);
            return run;
        }).immediate();
    }

    pruneExpiredHistory(now = new Date()) {
        this.db.prepare(`
            DELETE FROM cowork_runs WHERE finished_at IS NOT NULL AND started_at < ?
        `).run(new Date(now.getTime() - historyAge).toISOString());
    }

    claim(now = new Date()): { owner: string; task: ScheduledPromptTask; run: ScheduledPromptRun } | undefined {
        return this.db.transaction(() => {
            const at = now.toISOString();
            const running = this.db.prepare<[], RunRow>(
                "SELECT owner, data, lease_until FROM cowork_runs WHERE status = 'running'"
            ).get();
            if (running) {
                const run = JSON.parse(running.data) as ScheduledPromptRun;
                if (running.lease_until && running.lease_until > at) {
                    this.skipOverlap(running.owner, run, now);
                    return undefined;
                }
                this.finishRun(running.owner, run, interrupted, now);
            }

            const queued = this.db.prepare<[], RunRow>(`
                SELECT owner, data, lease_until FROM cowork_runs
                WHERE status = 'queued' ORDER BY scheduled_at, rowid LIMIT 1
            `).get();
            const due = this.db.prepare<[string], TaskRow>(`
                SELECT owner, data FROM cowork_tasks WHERE due_at <= ?
                ORDER BY due_at, rowid LIMIT 1
            `).get(at);
            const dueTask = due && JSON.parse(due.data) as ScheduledPromptTask;
            const queuedRun = queued && JSON.parse(queued.data) as ScheduledPromptRun;
            if (queued && queuedRun && (!dueTask || queuedRun.scheduledAt < dueTask.nextRunAt)) {
                const task = this.findTask(queued.owner, queuedRun.taskId);
                if (task) return this.startRun(queued.owner, task, queuedRun, now);
            }
            if (!due || !dueTask) return undefined;
            const dueAt = this.advanceTask(due.owner, dueTask, now);
            if (now.getTime() - Date.parse(dueAt) > catchUpAge) {
                this.skipRun(due.owner, dueTask, dueAt, now, 'CATCH_UP_EXPIRED', '7日より古い予定のため実行しませんでした。');
                return undefined;
            }
            if (this.findPending(due.owner, dueTask.id)) {
                this.skipRun(due.owner, dueTask, dueAt, now, 'TASK_BUSY', '同じタスクの実行が予約済みのためスキップしました。');
                return undefined;
            }
            return this.startRun(due.owner, dueTask, this.newRun(dueTask, 'scheduled', dueAt, at), now);
        }).immediate();
    }

    complete(owner: string, id: string, outcome: Outcome, now = new Date()) {
        return this.db.transaction(() => {
            const row = this.db.prepare<[string, string], RunRow>(`
                SELECT data, lease_until FROM cowork_runs
                WHERE owner = ? AND id = ? AND status = 'running'
            `).get(owner, id);
            if (!row) return;
            const run = JSON.parse(row.data) as ScheduledPromptRun;
            this.skipOverlap(owner, run, now);
            this.finishRun(owner, run, outcome, now);
        }).immediate();
    }

    importLegacy(owner: string, source: LegacyStore, now = new Date()) {
        return this.db.transaction(() => {
            const at = now.toISOString();
            const mark = this.db.prepare('INSERT OR IGNORE INTO cowork_import(owner, kind, id) VALUES (?, ?, ?)');
            let tasks = 0;
            let runs = 0;
            for (const task of source.tasks) {
                if (!mark.run(owner, 'task', task.id).changes || this.findTask(owner, task.id)) continue;
                const nextAt = task.nextRunAt <= at ? nextRunAt(task, now) : task.nextRunAt;
                this.saveTask(owner, { ...task, nextRunAt: nextAt });
                tasks++;
            }
            for (const run of source.runs) {
                if (!mark.run(owner, 'run', run.id).changes) continue;
                const normalized = run.status === 'running' ? { ...run, ...interrupted } : run;
                const finishedAt = run.finishedAt ?? (run.status === 'running' ? at : run.startedAt);
                runs += this.saveRun(owner, { ...normalized, finishedAt }, null, true).changes;
            }
            this.prune(owner, now);
            return { tasks, runs };
        }).immediate();
    }

    private findTask(owner: string, id: string) {
        const row = this.db.prepare<[string, string], TaskRow>(
            'SELECT data FROM cowork_tasks WHERE owner = ? AND id = ?'
        ).get(owner, id);
        return row ? JSON.parse(row.data) as ScheduledPromptTask : undefined;
    }

    private findPending(owner: string, taskId: string) {
        const row = this.db.prepare<[string, string], RunRow>(`
            SELECT data FROM cowork_runs WHERE owner = ? AND task_id = ?
            AND status IN ('queued', 'running') LIMIT 1
        `).get(owner, taskId);
        return row ? JSON.parse(row.data) as ScheduledPromptRun : undefined;
    }

    private saveTask(owner: string, task: ScheduledPromptTask) {
        this.db.prepare(`
            INSERT INTO cowork_tasks(owner, id, due_at, data) VALUES (?, ?, ?, ?)
            ON CONFLICT(owner, id) DO UPDATE SET due_at = excluded.due_at, data = excluded.data
        `).run(owner, task.id, task.enabled ? task.nextRunAt : null, JSON.stringify(task));
    }

    private newRun(task: ScheduledPromptTask, trigger: ScheduledPromptRun['trigger'], scheduledAt: string, at: string): ScheduledPromptRun {
        return {
            id: randomUUID(),
            taskId: task.id,
            taskName: task.name,
            trigger,
            scheduledAt,
            startedAt: at,
            status: 'queued'
        };
    }

    private saveRun(owner: string, run: ScheduledPromptRun, leaseUntil: string | null = null, insertOnly = false) {
        const conflict = insertOnly ? 'ON CONFLICT DO NOTHING' : `
            ON CONFLICT(owner, id) DO UPDATE SET started_at = excluded.started_at,
                finished_at = excluded.finished_at, status = excluded.status,
                lease_until = excluded.lease_until, data = excluded.data
        `;
        return this.db.prepare(`
            INSERT INTO cowork_runs(owner, id, task_id, trigger, scheduled_at, started_at,
                finished_at, status, lease_until, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ${conflict}
        `).run(owner, run.id, run.taskId, run.trigger, run.scheduledAt, run.startedAt,
            run.finishedAt ?? null, run.status, leaseUntil, JSON.stringify(run));
    }

    private advanceTask(owner: string, task: ScheduledPromptTask, now: Date) {
        const { dueAt, nextAt } = advanceSchedule(task, now);
        this.saveTask(owner, { ...task, nextRunAt: nextAt, updatedAt: now.toISOString() });
        return dueAt;
    }

    private startRun(owner: string, task: ScheduledPromptTask, queued: ScheduledPromptRun, now: Date) {
        const run = { ...queued, taskName: task.name, startedAt: now.toISOString(), status: 'running' as const };
        const result = this.saveRun(owner, run, new Date(now.getTime() + executionLease).toISOString(), run.trigger === 'scheduled');
        if (result.changes) return { owner, task, run };
    }

    private skipOverlap(owner: string, run: ScheduledPromptRun, now: Date) {
        const task = this.findTask(owner, run.taskId);
        if (!task?.enabled || task.nextRunAt > now.toISOString()) return;
        const dueAt = this.advanceTask(owner, task, now);
        this.skipRun(owner, task, dueAt, now, 'TASK_BUSY', '同じタスクが実行中のためスキップしました。');
    }

    private skipRun(owner: string, task: ScheduledPromptTask, dueAt: string, now: Date, errorCode: string, errorMessage: string) {
        this.finishRun(owner, this.newRun(task, 'scheduled', dueAt, now.toISOString()), {
            status: 'skipped', errorCode, errorMessage
        }, now, true);
    }

    private finishRun(owner: string, run: ScheduledPromptRun, outcome: Outcome, now: Date, insertOnly = false) {
        const finishedAt = now.toISOString();
        if (!this.saveRun(owner, { ...run, ...outcome, finishedAt }, null, insertOnly).changes) return;
        const task = this.findTask(owner, run.taskId);
        if (task) this.saveTask(owner, { ...task, lastRunAt: finishedAt, lastStatus: outcome.status, updatedAt: finishedAt });
        this.prune(owner, now);
    }

    private prune(owner: string, now: Date) {
        this.db.prepare(`
            DELETE FROM cowork_runs
            WHERE owner = ? AND finished_at IS NOT NULL
            AND (started_at < ? OR rowid IN (
                SELECT rowid FROM cowork_runs WHERE owner = ? AND finished_at IS NOT NULL
                ORDER BY started_at DESC, rowid DESC LIMIT -1 OFFSET ?
            ))
        `).run(owner, new Date(now.getTime() - historyAge).toISOString(), owner, historyLimit);
    }
}

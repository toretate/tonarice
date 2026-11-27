import type { ScheduleTriggerInfo } from '@mastra/core/schedules';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COWORK_AGENT_ID } from '../../mastra/cowork-agent';
import {
    dispatchNextCoWorkRun,
    requeueUndeliveredCoWorkRun,
    runCoWorkTaskNow
} from '../mastra-queue';
import { createCoWorkScheduleHooks } from '../mastra-schedule-hooks';
import { ensureCoWorkSchedule, removeCoWorkTaskSchedule } from '../mastra-schedules';
import { CoWorkRepository } from '../repository';
import { createMastraScheduleFixture } from './mastra-fixture';

const owner = 'test-user';
const input = {
    prompt: '実行してください。',
    enabled: true,
    timeZone: 'Asia/Tokyo',
    schedule: { type: 'interval', intervalMinutes: 15 } as const
};

function fixture() {
    const db = new Database(':memory:');
    const repo = new CoWorkRepository(db);
    const stopping = new AbortController();
    const hooks = createCoWorkScheduleHooks(repo, stopping.signal);
    const { rows, schedules, mastra } = createMastraScheduleFixture();
    const createTask = (name: string) => repo.create(owner, { ...input, name });
    const context = (id: string, kind: ScheduleTriggerInfo['kind'] = 'manual') => ({
        mastra,
        agentId: COWORK_AGENT_ID,
        schedule: { id, agentId: COWORK_AGENT_ID, ...rows.get(id) },
        trigger: { kind, firedAt: new Date() }
    });
    return { db, repo, stopping, hooks, schedules, mastra, createTask, context };
}

let f: ReturnType<typeof fixture>;
beforeEach(() => { f = fixture(); });
afterEach(() => { f.db.close(); });

describe('CoWork の Mastra スケジュール', () => {
    it('prepare_発火後に次回予定を登録して生成結果を保存する', async () => {
        const task = f.repo.create(owner, { ...input, name: '定期実行' }, new Date(Date.now() - 900_000));
        const schedule = await ensureCoWorkSchedule(f.mastra, f.repo, owner, task);
        const ctx = f.context(schedule!.id, 'once');
        ctx.trigger.firedAt = new Date(schedule!.runAt!);
        const effective = await f.hooks.prepare!(ctx);
        expect(effective?.prompt).toBe(task.prompt);
        expect(f.repo.get(owner, task.id)?.nextRunAt).not.toBe(task.nextRunAt);
        await f.hooks.onFinish!({ ...ctx, outcome: 'succeeded', effective: { prompt: task.prompt }, result: { text: '完了' } });
        expect(f.repo.list(owner).runs[0]).toMatchObject({ status: 'success', resultText: '完了' });
    });

    it('prepare_配送後に削除されたタスクをスキップして次の実行に進む', async () => {
        const deleted = f.createTask('削除対象');
        const next = f.createTask('後続');
        const run = await runCoWorkTaskNow(f.mastra, f.repo, owner, deleted.id, f.stopping.signal);
        const scheduleId = f.repo.getScheduleId(owner, deleted.id)!;
        const queued = f.repo.enqueue(owner, next.id)!;
        f.repo.delete(owner, deleted.id);
        await removeCoWorkTaskSchedule(f.mastra, f.repo, owner, deleted.id);

        const ctx = f.context(scheduleId);
        expect(await f.hooks.prepare!(ctx)).toBeNull();
        await f.hooks.onFinish!({ ...ctx, outcome: 'skipped', effective: { prompt: deleted.prompt } });

        expect(f.repo.getRun(owner, run!.id)).toMatchObject({ status: 'skipped', errorCode: 'TASK_DELETED' });
        expect(f.repo.getRun(owner, queued.id)?.status).toBe('running');
        expect(f.schedules.run).toHaveBeenCalledTimes(2);
    });

    it('dispatchNextCoWorkRun_配送に失敗しても後続の待ち行列を進める', async () => {
        const failed = f.repo.enqueue(owner, f.createTask('配送失敗').id)!;
        const next = f.repo.enqueue(owner, f.createTask('後続').id)!;
        f.schedules.run.mockRejectedValueOnce(new Error('配送失敗'));

        await dispatchNextCoWorkRun(f.mastra, f.repo, f.stopping.signal);

        expect(f.repo.getRun(owner, failed.id)).toMatchObject({ status: 'failed', errorCode: 'SCHEDULE_FAILED' });
        expect(f.repo.getRun(owner, next.id)?.status).toBe('running');
        expect(f.schedules.run).toHaveBeenCalledTimes(2);
    });

    it('onAbort_停止時に現在の実行だけを中断し次の配送や再登録を行わない', async () => {
        const task = f.createTask('現在');
        const run = await runCoWorkTaskNow(f.mastra, f.repo, owner, task.id, f.stopping.signal);
        const ctx = f.context(f.repo.getScheduleId(owner, task.id)!);
        expect(await f.hooks.prepare!(ctx)).toEqual({ prompt: task.prompt });
        const queued = f.repo.enqueue(owner, f.createTask('後続').id)!;
        f.stopping.abort();
        f.schedules.update.mockClear();

        await f.hooks.onAbort!({ ...ctx, runId: 'agent-run', effective: { prompt: task.prompt } });

        expect(f.repo.getRun(owner, run!.id)).toMatchObject({ status: 'failed', errorCode: 'INTERRUPTED' });
        expect(f.repo.getRun(owner, queued.id)?.status).toBe('queued');
        expect(f.schedules.run).toHaveBeenCalledTimes(1);
        expect(f.schedules.update).not.toHaveBeenCalled();
    });

    it('requeueUndeliveredCoWorkRun_停止時に配送済みで未開始の実行を待ち行列へ戻す', async () => {
        const task = f.createTask('未開始');
        const run = await runCoWorkTaskNow(f.mastra, f.repo, owner, task.id, f.stopping.signal);
        f.stopping.abort();
        requeueUndeliveredCoWorkRun(f.mastra, f.repo);

        expect(await f.hooks.prepare!(f.context(f.repo.getScheduleId(owner, task.id)!))).toBeNull();
        expect(f.repo.getRun(owner, run!.id)?.status).toBe('queued');
    });

    it('onError_モデルの時間切れを該当する実行に記録する', async () => {
        const task = f.createTask('時間切れ');
        const run = await runCoWorkTaskNow(f.mastra, f.repo, owner, task.id, f.stopping.signal);
        const ctx = f.context(f.repo.getScheduleId(owner, task.id)!);
        await f.hooks.prepare!(ctx);
        const error = new Error('時間切れ');
        error.name = 'MastraTimeoutError';
        await f.hooks.onError!({ ...ctx, phase: 'run', error });

        expect(f.repo.getRun(owner, run!.id)).toMatchObject({ status: 'failed', errorCode: 'TIMEOUT' });
    });
});

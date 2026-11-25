import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScheduledPromptTaskInput } from '../../../types/scheduled-prompt-task';
import { legacyStoreSchema } from '../legacy-import';
import { CoWorkRepository } from '../repository';
import { executionLease } from '../schedule';

const owners = { first: 'usr_first', second: 'usr_second' };
const created = new Date('2026-11-25T01:00:00.000Z');
const at = (minutes: number, extraMs = 0) => new Date(+created + minutes * 60_000 + extraMs);
const input: ScheduledPromptTaskInput = {
    name: '朝の確認',
    prompt: '予定を確認してください。',
    schedule: { type: 'interval', intervalMinutes: 15 },
    timeZone: 'Asia/Tokyo',
    enabled: true
};

const databases: Database.Database[] = [];
let directory: string | undefined;

function repository(path = ':memory:') {
    const db = new Database(path);
    databases.push(db);
    return new CoWorkRepository(db);
}

afterEach(() => {
    for (const db of databases.splice(0)) if (db.open) db.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
});

describe('CoWorkRepository', () => {
    it('list_ユーザーごとにタスクと履歴を分離し他ユーザーによる変更を拒否する', () => {
        const repo = repository();
        const task = repo.create(owners.first, input, created);
        const run = repo.enqueue(owners.first, task.id, created);
        expect(run).toMatchObject({ status: 'queued' });
        expect(repo.list(owners.second, created)).toEqual({ tasks: [], runs: [] });
        expect(repo.update(owners.second, task.id, { enabled: false }, created)).toBeUndefined();
        expect(repo.enqueue(owners.second, task.id, created)).toBeUndefined();
        expect(repo.delete(owners.second, task.id, created)).toBe(false);
        expect(repo.claim(created)?.owner).toBe(owners.first);
        repo.complete(owners.second, run!.id, { status: 'success', resultText: '他のユーザー' }, created);
        expect(repo.list(owners.first, created).runs[0]?.status).toBe('running');
        repo.complete(owners.first, run!.id, { status: 'success', resultText: '完了' }, created);
        expect(repo.activity(owners.first, created)).toEqual([run!.id]);
        expect(repo.activity(owners.second, created)).toEqual([]);
    });

    it('claim_複数の接続と再起動で同じ予定を再取得しない', () => {
        directory = mkdtempSync(join(tmpdir(), 'cowork-db-'));
        const path = join(directory, 'cowork.sqlite');
        const first = repository(path);
        const second = repository(path);
        const task = first.create(owners.first, input, created);
        const claim = first.claim(at(15));
        expect(claim?.run).toMatchObject({ taskId: task.id, trigger: 'scheduled', scheduledAt: at(15).toISOString() });
        expect(second.claim(at(15))).toBeUndefined();
        expect(second.list(owners.first, at(15)).tasks[0]?.nextRunAt).toBe(at(30).toISOString());

        for (const db of databases) db.close();
        const restarted = repository(path);
        expect(restarted.claim(at(15, executionLease - 1))).toBeUndefined();
        expect(restarted.claim(at(15, executionLease))).toBeUndefined();
        expect(restarted.list(owners.first, at(16)).runs).toMatchObject([
            { id: claim?.run.id, status: 'failed', errorCode: 'INTERRUPTED' }
        ]);
        expect(restarted.claim(at(30))?.run.scheduledAt).toBe(at(30).toISOString());
    });

    it('claim_取りこぼした直近の予定だけを実行する', () => {
        const repo = repository();
        const task = repo.create(owners.first, input, created);
        expect(repo.claim(at(60, 30_000))?.run.scheduledAt).toBe(at(60).toISOString());
        expect(repo.list(owners.first, at(60)).tasks[0]).toMatchObject({ id: task.id, nextRunAt: at(75).toISOString() });
    });

    it('claim_期限を過ぎた予定はスキップし次回の時刻を保存する', () => {
        const repo = repository();
        repo.create(owners.first, { ...input, schedule: { type: 'daily', intervalDays: 30, time: '10:00' } }, created);
        const now = at(40 * 24 * 60);
        expect(repo.claim(now)).toBeUndefined();
        const data = repo.list(owners.first, now);
        expect(data.runs).toMatchObject([{ status: 'skipped', errorCode: 'CATCH_UP_EXPIRED' }]);
        expect(data.tasks[0]?.nextRunAt).toBe(at(60 * 24 * 60).toISOString());
    });

    it('enqueue_手動実行を永続化し同一タスクの同時リクエストをまとめる', () => {
        const repo = repository();
        const task = repo.create(owners.first, input, created);
        const first = repo.enqueue(owners.first, task.id, at(14));
        expect(repo.enqueue(owners.first, task.id, at(14))).toEqual(first);
        expect(repo.claim(at(14, 58_000))?.run.id).toBe(first?.id);
        expect(repo.claim(at(15))).toBeUndefined();
        expect(repo.list(owners.first, at(15)).runs).toMatchObject([
            { status: 'skipped', errorCode: 'TASK_BUSY' },
            { status: 'running', id: first?.id }
        ]);
    });

    it('delete_実行待ちのタスクを削除して履歴を残す', () => {
        const repo = repository();
        const task = repo.create(owners.first, input, created);
        const run = repo.enqueue(owners.first, task.id, created);
        expect(repo.delete(owners.first, task.id, at(1))).toBe(true);
        expect(repo.claim(at(1))).toBeUndefined();
        expect(repo.list(owners.first, at(1))).toMatchObject({
            tasks: [], runs: [{ id: run?.id, status: 'skipped', errorCode: 'TASK_DELETED' }]
        });
    });

    it('importLegacy_期限切れ予定を再実行せず再取込で削除済みタスクを復活させない', () => {
        const source = repository();
        const task = source.create(owners.first, input, created);
        source.claim(at(15));
        const legacy = legacyStoreSchema.parse(source.list(owners.first, at(15)));
        const destination = repository();
        expect(destination.importLegacy(owners.first, legacy, at(75))).toEqual({ tasks: 1, runs: 1 });
        expect(destination.claim(at(75))).toBeUndefined();
        expect(destination.list(owners.first, at(75))).toMatchObject({
            tasks: [{ id: task.id, nextRunAt: at(90).toISOString() }],
            runs: [{ status: 'failed', errorCode: 'INTERRUPTED' }]
        });
        destination.delete(owners.first, task.id, at(76));
        expect(destination.importLegacy(owners.first, legacy, at(76))).toEqual({ tasks: 0, runs: 0 });
        expect(destination.list(owners.first, at(76)).tasks).toEqual([]);
        expect(destination.list(owners.second, at(76))).toEqual({ tasks: [], runs: [] });
    });
});

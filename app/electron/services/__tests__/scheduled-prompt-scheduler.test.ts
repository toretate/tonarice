import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ScheduledPromptRepository } from '../scheduled-prompt-repository';
import { ScheduledPromptScheduler } from '../scheduled-prompt-scheduler';

const temporaryDirectories: string[] = [];

const createRepository = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tonarice-schedule-'));
    temporaryDirectories.push(directory);
    return new ScheduledPromptRepository(path.join(directory, 'tasks.json'));
};

afterEach(() => {
    vi.useRealTimers();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('ScheduledPromptScheduler', () => {
    it('createTask_入力を保存して次回実行日時を設定する', () => {
        const now = new Date('2026-07-24T00:00:00.000Z');
        const scheduler = new ScheduledPromptScheduler(
            createRepository(),
            vi.fn(),
            { now: () => now, createId: () => 'task-1' }
        );

        const task = scheduler.createTask({
            name: '朝の確認',
            prompt: '今日の予定を確認してください。',
            schedule: { type: 'daily', intervalDays: 1, time: '09:30' },
            timeZone: 'Asia/Tokyo',
            enabled: true
        });
        scheduler.stop();

        expect(task.id).toBe('task-1');
        expect(task.nextRunAt).toBe('2026-07-24T00:30:00.000Z');
        expect(scheduler.listTasks()).toHaveLength(1);
    });

    it('evaluateDueTasks_複数回の取りこぼしを最新一回だけ実行する', async () => {
        const repository = createRepository();
        let now = new Date('2026-07-24T00:00:00.000Z');
        const executor = vi.fn().mockResolvedValue({ resultText: '確認結果' });
        const ids = ['task-1', 'run-1'];
        const scheduler = new ScheduledPromptScheduler(
            repository,
            executor,
            { now: () => now, createId: () => ids.shift() ?? 'id' }
        );

        const task = scheduler.createTask({
            name: '定期確認',
            prompt: '確認してください。',
            schedule: { type: 'interval', intervalMinutes: 15 },
            timeZone: 'Asia/Tokyo',
            enabled: true
        });
        scheduler.stop();
        now = new Date('2026-07-24T01:01:00.000Z');

        await scheduler.evaluateDueTasks();
        await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(1));
        scheduler.stop();

        expect(executor.mock.calls[0][1].scheduledAt).toBe('2026-07-24T01:00:00.000Z');
        expect(scheduler.listTasks()[0].nextRunAt).toBe('2026-07-24T01:15:00.000Z');
        expect(task.id).toBe('task-1');
    });

    it('runTaskNow_同一タスクの多重実行を開始しない', async () => {
        const repository = createRepository();
        const now = new Date('2026-07-24T00:00:00.000Z');
        let resolveExecution: ((value: { resultText: string }) => void) | undefined;
        const executor = vi.fn(() => new Promise<{ resultText: string }>((resolve) => {
            resolveExecution = resolve;
        }));
        const scheduler = new ScheduledPromptScheduler(
            repository,
            executor,
            { now: () => now }
        );

        const task = scheduler.createTask({
            name: '重複確認',
            prompt: '確認してください。',
            schedule: { type: 'interval', intervalMinutes: 15 },
            timeZone: 'Asia/Tokyo',
            enabled: true
        });
        scheduler.stop();

        const first = scheduler.runTaskNow(task.id);
        const second = scheduler.runTaskNow(task.id);
        await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(1));
        resolveExecution?.({ resultText: '完了' });
        await Promise.all([first, second]);

        expect(executor).toHaveBeenCalledTimes(1);
    });
});

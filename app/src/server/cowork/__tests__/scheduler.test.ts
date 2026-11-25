import Database from 'better-sqlite3';
import type { NitroApp } from 'nitropack/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../plugins/cowork-scheduler';
import { ChatAiService } from '../../utils/chat-ai-service';
import { getDB } from '../../utils/db';
import { getCoWorkRepository } from '../runtime';
import { executionTimeout } from '../schedule';

vi.mock('nitropack/runtime', () => ({ defineNitroPlugin: (value: unknown) => value }));
vi.mock('../../utils/chat-ai-service', () => ({ ChatAiService: { generateResponse: vi.fn() } }));
vi.mock('../../utils/db', () => ({ getDB: vi.fn() }));

let db: Database.Database;
let close: (() => Promise<void>) | undefined;

const start = () => {
    plugin({
        hooks: { hook: (_name: string, callback: () => Promise<void>) => { close = callback; } }
    } as unknown as NitroApp);
};

beforeAll(() => {
    db = new Database(':memory:');
    vi.mocked(getDB).mockReturnValue(db);
});
afterAll(() => db.close());

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T01:00:00.000Z'));
    vi.stubEnv('COWORK_AI_ENGINE', 'gemini');
    vi.stubEnv('COWORK_AI_MODEL', 'test-model');
    vi.stubEnv('COWORK_AI_API_KEY', 'test-key');
    vi.mocked(ChatAiService.generateResponse).mockReset();
});

afterEach(async () => {
    await close?.();
    close = undefined;
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

describe('CoWork scheduler', () => {
    it('Nitro 起動_クライアントのアクセスがなくても予定の到達後に実行する', async () => {
        vi.mocked(ChatAiService.generateResponse).mockResolvedValue('実行結果');
        const repo = getCoWorkRepository();
        repo.create('user', {
            name: '確認', prompt: 'サーバーで実行してください。', enabled: true,
            timeZone: 'Asia/Tokyo', schedule: { type: 'interval', intervalMinutes: 15 }
        }, new Date(Date.now() - 15 * 60_000 + 1_000));
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(ChatAiService.generateResponse).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2_000);
        expect(ChatAiService.generateResponse).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            message: 'サーバーで実行してください。', model: 'test-model',
            maxRetries: 0, logContent: false, toolUseEnabled: false
        }));
        expect(repo.list('user').runs[0]).toMatchObject({ status: 'success', resultText: '実行結果' });
    });

    it('Nitro 終了_未完了の実行を中断し二重に要求しない', async () => {
        vi.mocked(ChatAiService.generateResponse).mockImplementation(() => new Promise(() => {}));
        const repo = getCoWorkRepository();
        const task = repo.create('stop-user', {
            name: '停止', prompt: '停止テスト', enabled: false,
            timeZone: 'Asia/Tokyo', schedule: { type: 'interval', intervalMinutes: 15 }
        });
        repo.enqueue('stop-user', task.id);
        start();
        await vi.advanceTimersByTimeAsync(2_000);
        expect(ChatAiService.generateResponse).toHaveBeenCalledTimes(1);
        await close?.();
        await vi.advanceTimersByTimeAsync(executionTimeout);
        expect(ChatAiService.generateResponse).toHaveBeenCalledTimes(1);
        expect(repo.list('stop-user').runs[0]).toMatchObject({ status: 'failed', errorCode: 'INTERRUPTED' });
    });

    it('AI 実行_時間切れを履歴へ保存し同じ回を再要求しない', async () => {
        vi.mocked(ChatAiService.generateResponse).mockImplementation(() => new Promise(() => {}));
        const repo = getCoWorkRepository();
        const task = repo.create('timeout-user', {
            name: 'タイムアウト', prompt: 'タイムアウトテスト', enabled: false,
            timeZone: 'Asia/Tokyo', schedule: { type: 'interval', intervalMinutes: 15 }
        });
        repo.enqueue('timeout-user', task.id);
        start();
        await vi.advanceTimersByTimeAsync(executionTimeout + 2_000);
        expect(ChatAiService.generateResponse).toHaveBeenCalledTimes(1);
        expect(repo.list('timeout-user').runs[0]).toMatchObject({ status: 'failed', errorCode: 'TIMEOUT' });
    });
});

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const fixture = vi.hoisted(() => ({ usersDir: '', broadcast: vi.fn() }));
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: async (event: any) => event.body,
    createError: ({ statusCode, statusMessage, data }: { statusCode: number; statusMessage?: string; data?: unknown }) =>
        Object.assign(new Error(statusMessage || 'request failed'), { statusCode, data })
}));
vi.mock('../utils/paths', () => ({ get USERS_DIR() { return fixture.usersDir; } }));
vi.mock('../utils/user-connections', () => ({ broadcastToUser: fixture.broadcast }));

import cliDataHandler from './cli-data.post';
import memosPostHandler from './memos.post';
import memosGetHandler from './memos.get';
import tasksPostHandler from './tasks.post';
import tasksGetHandler from './tasks.get';

fixture.usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tonarice-cli-data-'));
afterAll(() => fs.rmSync(fixture.usersDir, { recursive: true, force: true }));

describe('CLI データ操作と GUI 同期競合防止', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fs.rmSync(fixture.usersDir, { recursive: true, force: true });
        fs.mkdirSync(fixture.usersDir, { recursive: true });
    });

    it('handler_認証済みユーザーのメモを追加しリビジョン付きで画面へ通知する', async () => {
        const result = await (cliDataHandler as any)({
            context: { user: { id: 'u1' } },
            body: { kind: 'memo', action: 'add', text: '内容A' }
        });
        expect(result.success).toBe(true);
        expect(result.revision).toBe(1);
        expect(fixture.broadcast).toHaveBeenCalledWith('u1', 'memo-action', expect.objectContaining({
            action: 'add',
            memoId: result.id,
            revision: 1
        }));
    });

    it('handler_タスク完了を個別に更新しリビジョン付きで画面へ通知する', async () => {
        const added = await (cliDataHandler as any)({
            context: { user: { id: 'u1' } },
            body: { kind: 'todo', action: 'add', text: 'タスクA' }
        });
        vi.clearAllMocks();
        const updated = await (cliDataHandler as any)({
            context: { user: { id: 'u1' } },
            body: { kind: 'todo', action: 'update', id: added.id, completed: true }
        });
        expect(updated.success).toBe(true);
        expect(updated.revision).toBe(2);
        expect(fixture.broadcast).toHaveBeenCalledWith('u1', 'task-action', expect.objectContaining({
            action: 'updateTask',
            revision: 2
        }));
    });

    it('handler_未認証と不正な入力を拒否する', async () => {
        await expect((cliDataHandler as any)({ context: {}, body: {} })).rejects.toMatchObject({ statusCode: 401 });
        await expect((cliDataHandler as any)({ context: { user: { id: 'u1' } }, body: { kind: 'memo', action: 'delete' } })).rejects.toMatchObject({ statusCode: 400 });
        expect(fixture.broadcast).not.toHaveBeenCalled();
    });

    it('handler_CLI連続追加後に古い全件メモ保存が到着しても409で拒否し後続メモを消さない', async () => {
        const memoA = await (cliDataHandler as any)({
            context: { user: { id: 'u1' } },
            body: { kind: 'memo', action: 'add', text: 'メモA' }
        });
        const memoB = await (cliDataHandler as any)({
            context: { user: { id: 'u1' } },
            body: { kind: 'memo', action: 'add', text: 'メモB' }
        });
        expect(memoA.revision).toBe(1);
        expect(memoB.revision).toBe(2);

        // GUI が A 時点のリビジョン (1) のまま [A] だけの古い全件保存を送信してきた競合を再現
        await expect((memosPostHandler as any)({
            context: { user: { id: 'u1' } },
            body: { memos: [memoA.memo], baseRevision: 1 }
        })).rejects.toMatchObject({
            statusCode: 409,
            data: expect.objectContaining({ conflict: true, currentRevision: 2 })
        });

        const latest = await (memosGetHandler as any)({ context: { user: { id: 'u1' } } });
        expect(latest.revision).toBe(2);
        expect(latest.memos.map((m: any) => m.content)).toEqual(['メモA', 'メモB']);
    });

    it('handler_CLI連続追加後に別GUIの古い全件タスク保存が到着しても409で拒否し後続タスクを消さない', async () => {
        const taskA = await (cliDataHandler as any)({
            context: { user: { id: 'u1' } },
            body: { kind: 'todo', action: 'add', text: 'タスクA' }
        });
        const taskB = await (cliDataHandler as any)({
            context: { user: { id: 'u1' } },
            body: { kind: 'todo', action: 'add', text: 'タスクB' }
        });
        expect(taskA.revision).toBe(1);
        expect(taskB.revision).toBe(2);

        // 別クライアントが異なる古い状態（baseRevision: 0 や 1）で全件保存を送った場合
        await expect((tasksPostHandler as any)({
            context: { user: { id: 'u1' } },
            body: { categories: [], tasks: [taskA.task], baseRevision: 1 }
        })).rejects.toMatchObject({
            statusCode: 409,
            data: expect.objectContaining({ conflict: true, currentRevision: 2 })
        });

        const latest = await (tasksGetHandler as any)({ context: { user: { id: 'u1' } } });
        expect(latest.revision).toBe(2);
        expect(latest.tasks.map((t: any) => t.title)).toEqual(['タスクA', 'タスクB']);
    });

    it('handler_baseRevision未指定の全件メモ・タスク保存を400で拒否する', async () => {
        await expect((memosPostHandler as any)({
            context: { user: { id: 'u1' } },
            body: { memos: [] }
        })).rejects.toMatchObject({ statusCode: 400 });

        await expect((tasksPostHandler as any)({
            context: { user: { id: 'u1' } },
            body: { categories: [], tasks: [] }
        })).rejects.toMatchObject({ statusCode: 400 });
    });
});

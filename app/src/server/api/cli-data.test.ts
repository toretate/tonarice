import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ memo: vi.fn(), task: vi.fn(), update: vi.fn(), broadcast: vi.fn() }));
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: async (event: any) => event.body,
    createError: ({ statusCode }: { statusCode: number }) => Object.assign(new Error('request failed'), { statusCode })
}));
vi.mock('../utils/tool-executor', () => ({ executeMemosTool: mocks.memo, executeTasksTool: mocks.task }));
vi.mock('../utils/tasks-service', () => ({ updateTaskInDb: mocks.update }));
vi.mock('../utils/user-connections', () => ({ broadcastToUser: mocks.broadcast }));
import handler from './cli-data.post';

describe('CLI データ操作', () => {
    beforeEach(() => vi.clearAllMocks());

    it('handler_認証済みユーザーのメモを追加し画面へ通知する', async () => {
        mocks.memo.mockResolvedValue(JSON.stringify({ success: true, id: 'm1', memo: { id: 'm1', content: '内容' } }));
        const result = await (handler as any)({ context: { user: { id: 'u1' } }, body: { kind: 'memo', action: 'add', text: '内容' } });
        expect(result.success).toBe(true);
        expect(mocks.memo).toHaveBeenCalledWith('u1', expect.objectContaining({ action: 'add', content: '内容' }));
        expect(mocks.broadcast).toHaveBeenCalledWith('u1', 'memo-action', expect.objectContaining({ action: 'add', memoId: 'm1' }));
    });

    it('handler_タスク完了を個別に更新し画面へ通知する', async () => {
        mocks.task.mockResolvedValue(JSON.stringify({ success: true, id: 't1', task: { id: 't1', completed: true } }));
        mocks.update.mockReturnValue({ task: { id: 't1', completed: true }, categories: [] });
        await (handler as any)({ context: { user: { id: 'u1' } }, body: { kind: 'todo', action: 'update', id: 't1', completed: true } });
        expect(mocks.task).toHaveBeenCalledWith('u1', expect.objectContaining({ id: 't1', completed: true }));
        expect(mocks.broadcast).toHaveBeenCalledWith('u1', 'task-action', expect.objectContaining({ action: 'updateTask' }));
    });

    it('handler_未認証と不正な入力を拒否する', async () => {
        await expect((handler as any)({ context: {}, body: {} })).rejects.toMatchObject({ statusCode: 401 });
        await expect((handler as any)({ context: { user: { id: 'u1' } }, body: { kind: 'memo', action: 'delete' } })).rejects.toMatchObject({ statusCode: 400 });
        expect(mocks.memo).not.toHaveBeenCalled();
    });
});

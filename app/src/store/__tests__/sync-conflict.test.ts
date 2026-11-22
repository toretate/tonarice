// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useMemoStore } from '../memo';
import { useTaskStore } from '../task';

describe('メモ・タスクストアのサーバー起点同期と競合防止', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        setActivePinia(createPinia());
        localStorage.clear();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('applyServerMemoAction_連続更新の通知を受けてもサーバーへ全件POSTしない', async () => {
        const memoStore = useMemoStore();
        fetchMock.mockResolvedValueOnce({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ success: true, memos: [], revision: 0 })
        });
        await memoStore.loadFromLocalStorage();
        fetchMock.mockClear();

        await memoStore.applyServerMemoAction({
            action: 'add',
            memoId: 'm1',
            revision: 1,
            memo: { id: 'm1', content: 'メモA', order: 0, createdAt: '2026-11-22T00:00:00Z', updatedAt: '2026-11-22T00:00:00Z' }
        });
        await memoStore.applyServerMemoAction({
            action: 'add',
            memoId: 'm2',
            revision: 2,
            memo: { id: 'm2', content: 'メモB', order: 1, createdAt: '2026-11-22T00:00:01Z', updatedAt: '2026-11-22T00:00:01Z' }
        });
        await Promise.resolve();

        expect(memoStore.memos.map(m => m.id)).toEqual(['m1', 'm2']);
        expect(memoStore.serverRevision).toBe(2);
        const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
        expect(postCalls).toHaveLength(0);
    });

    it('applyServerMemoAction_リビジョン欠落がある別クライアントは全件POSTせず最新を再読込する', async () => {
        const memoStore = useMemoStore();
        fetchMock.mockResolvedValueOnce({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
                success: true,
                memos: [{ id: 'm0', content: '既存', order: 0, createdAt: '2026-11-22T00:00:00Z', updatedAt: '2026-11-22T00:00:00Z' }],
                revision: 1
            })
        });
        await memoStore.loadFromLocalStorage();
        fetchMock.mockClear();

        // revision 2 を飛ばして revision 3 が届いた場合（別クライアントの古い状態）
        fetchMock.mockResolvedValueOnce({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
                success: true,
                memos: [
                    { id: 'm0', content: '既存', order: 0, createdAt: '2026-11-22T00:00:00Z', updatedAt: '2026-11-22T00:00:00Z' },
                    { id: 'm1', content: 'メモA', order: 1, createdAt: '2026-11-22T00:00:01Z', updatedAt: '2026-11-22T00:00:01Z' },
                    { id: 'm2', content: 'メモB', order: 2, createdAt: '2026-11-22T00:00:02Z', updatedAt: '2026-11-22T00:00:02Z' }
                ],
                revision: 3
            })
        });

        await memoStore.applyServerMemoAction({
            action: 'add',
            memoId: 'm2',
            revision: 3,
            memo: { id: 'm2', content: 'メモB', order: 2, createdAt: '2026-11-22T00:00:02Z', updatedAt: '2026-11-22T00:00:02Z' }
        });
        await Promise.resolve();

        expect(memoStore.memos.map(m => m.id)).toEqual(['m0', 'm1', 'm2']);
        expect(memoStore.serverRevision).toBe(3);
        const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
        expect(postCalls).toHaveLength(0);
    });

    it('saveToLocalStorage_保存途中の連続編集を次のリビジョンで保存する', async () => {
        const memoStore = useMemoStore();
        fetchMock.mockResolvedValueOnce(Response.json({ success: true, memos: [], revision: 1 }));
        await memoStore.loadFromLocalStorage();
        const first = Promise.withResolvers<Response>();
        fetchMock.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(Response.json({ revision: 3 }));

        memoStore.addMemo('最初の編集');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        memoStore.addMemo('次の編集');
        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        first.resolve(Response.json({ revision: 2 }));
        await vi.waitFor(() => expect(memoStore.serverRevision).toBe(3));
        const secondPost = JSON.parse(fetchMock.mock.calls[2][1].body);
        expect(secondPost.baseRevision).toBe(2);
        expect(secondPost.memos.map((memo: { content: string }) => memo.content)).toEqual(['最初の編集', '次の編集']);
    });

    it('saveToLocalStorage_409の後に最新メモと未保存の編集を両方保存する', async () => {
        const memoStore = useMemoStore();
        fetchMock.mockResolvedValueOnce(Response.json({ success: true, memos: [], revision: 1 }));
        await memoStore.loadFromLocalStorage();
        const newMemo = { id: 'cli_m', content: 'CLI最新メモ', order: 0, createdAt: '2026-11-22T00:00:00Z', updatedAt: '2026-11-22T00:00:00Z' };
        fetchMock
            .mockResolvedValueOnce(Response.json({ data: { currentRevision: 2, memos: [newMemo] } }, { status: 409 }))
            .mockResolvedValueOnce(Response.json({ revision: 3 }));

        memoStore.addMemo('ローカル編集中メモ');
        await vi.waitFor(() => expect(memoStore.serverRevision).toBe(3));
        const retry = JSON.parse(fetchMock.mock.calls[2][1].body);
        expect(retry.baseRevision).toBe(2);
        expect(retry.memos.map((memo: { content: string }) => memo.content)).toEqual(['CLI最新メモ', 'ローカル編集中メモ']);
    });

    it('applyServerTaskAction_連続タスク更新と削除を受けてもサーバーへ全件POSTしない', async () => {
        const taskStore = useTaskStore();
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                success: true,
                categories: [
                    { id: 'default', name: 'Work', order: 0 },
                    { id: 'private', name: 'Private', order: 1 },
                    { id: 'meeting', name: '会議', order: 2 }
                ],
                tasks: [],
                revision: 0
            })
        });
        await taskStore.loadFromLocalStorage();
        fetchMock.mockClear();

        await taskStore.applyServerTaskAction({
            action: 'addTask',
            revision: 1,
            task: {
                id: 't1', categoryId: 'default', title: 'タスクA', completed: false,
                priority: 'normal', steps: [], order: 0, createdAt: '2026-11-22T00:00:00Z'
            }
        });
        await taskStore.applyServerTaskAction({
            action: 'addTask',
            revision: 2,
            task: {
                id: 't2', categoryId: 'default', title: 'タスクB', completed: false,
                priority: 'normal', steps: [], order: 1, createdAt: '2026-11-22T00:00:01Z'
            }
        });
        await taskStore.applyServerTaskAction({
            action: 'deleteTask',
            revision: 3,
            taskId: 't1'
        });
        await Promise.resolve();

        expect(taskStore.tasks.map(t => t.id)).toEqual(['t2']);
        expect(taskStore.serverRevision).toBe(3);
        const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
        expect(postCalls).toHaveLength(0);
    });
});

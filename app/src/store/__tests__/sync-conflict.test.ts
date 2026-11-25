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

    it('storageイベント_メモ保存保留中に複数通知が来てもisLoadedを維持し完了後にまとめて同期して次の編集も保存できる', async () => {
        const memoStore = useMemoStore();
        fetchMock.mockResolvedValueOnce(Response.json({ success: true, memos: [], revision: 1 }));
        await memoStore.loadFromLocalStorage();

        const firstPost = Promise.withResolvers<Response>();
        fetchMock
            .mockImplementationOnce(() => firstPost.promise)
            .mockResolvedValueOnce(Response.json({
                success: true,
                memos: [
                    { id: 'other_tab', content: '別タブのメモ', order: 0, createdAt: '2026-11-22T00:00:00Z', updatedAt: '2026-11-22T00:00:00Z' }
                ],
                revision: 3
            }));

        memoStore.addMemo('このタブのメモ1');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        // 保存保留中に別タブから複数の StorageEvent を送る（古い localStorage スナップショットも混在）
        localStorage.setItem('desktop-mascot-memos', JSON.stringify([{ id: 'stale_local', content: '古いローカル' }]));
        localStorage.setItem('desktop-mascot-show-memo-widget', 'true');
        window.dispatchEvent(new StorageEvent('storage', { key: 'desktop-mascot-memos' }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'desktop-mascot-memos' }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'desktop-mascot-show-memo-widget' }));

        expect(memoStore.isLoaded).toBe(true);
        // 保存完了前は余計な GET / POST が増えないこと
        expect(fetchMock).toHaveBeenCalledTimes(2);

        firstPost.resolve(Response.json({ revision: 2 }));
        await vi.waitFor(() => expect(memoStore.serverRevision).toBe(3));

        // 複数通知は 1 回の GET にまとまり、通知だけで POST が増えないこと
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(memoStore.isLoaded).toBe(true);
        expect(memoStore.showMemoWidget).toBe(true);
        expect(memoStore.memos.some(m => m.id === 'other_tab')).toBe(true);
        expect(memoStore.memos.some(m => m.id === 'stale_local')).toBe(false);

        // 古い GET 応答 (revision 2) が返っても現在の revision 3 を上書きしないこと
        fetchMock
            .mockResolvedValueOnce(Response.json({
                success: true,
                memos: [{ id: 'old_rev', content: '古い応答' }],
                revision: 2
            }))
            .mockResolvedValueOnce(Response.json({ revision: 4 }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'desktop-mascot-memos' }));
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        await Promise.resolve();
        expect(memoStore.serverRevision).toBe(3);
        expect(memoStore.memos.some(m => m.id === 'old_rev')).toBe(false);

        // 次の編集が新しい revision 3 を baseRevision として保存されること
        memoStore.addMemo('このタブのメモ2');
        await vi.waitFor(() => expect(memoStore.serverRevision).toBe(4));
        const nextPost = JSON.parse(fetchMock.mock.calls[4][1].body);
        expect(nextPost.baseRevision).toBe(3);
    });

    it('storageイベント_タスク保存保留中に複数通知が来てもisLoadedを維持し完了後に同期して次の編集も保存できる', async () => {
        const taskStore = useTaskStore();
        const defaultCategories = [
            { id: 'default', name: 'Work', order: 0 },
            { id: 'private', name: 'Private', order: 1 },
            { id: 'meeting', name: '会議', order: 2 }
        ];
        fetchMock.mockResolvedValueOnce(Response.json({
            success: true,
            categories: defaultCategories,
            tasks: [],
            revision: 1
        }));
        await taskStore.loadFromLocalStorage();

        const firstPost = Promise.withResolvers<Response>();
        fetchMock
            .mockImplementationOnce(() => firstPost.promise)
            .mockResolvedValueOnce(Response.json({
                success: true,
                categories: defaultCategories,
                tasks: [{
                    id: 'remote_t', categoryId: 'default', title: '別タブのタスク', completed: false,
                    priority: 'normal', steps: [], order: 0, createdAt: '2026-11-22T00:00:00Z'
                }],
                revision: 3
            }))
            .mockResolvedValueOnce(Response.json({ revision: 4 }));

        taskStore.addTask('default', 'このタブのタスク1');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        localStorage.setItem('desktop-mascot-show-task-widget', 'true');
        window.dispatchEvent(new StorageEvent('storage', { key: 'desktop-mascot-tasks' }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'desktop-mascot-tasks' }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'desktop-mascot-show-task-widget' }));

        expect(taskStore.isLoaded).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        firstPost.resolve(Response.json({ revision: 2 }));
        await vi.waitFor(() => expect(taskStore.serverRevision).toBe(3));

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(taskStore.isLoaded).toBe(true);
        expect(taskStore.showTaskWidget).toBe(true);
        expect(taskStore.tasks.some(t => t.id === 'remote_t')).toBe(true);

        taskStore.addTask('default', 'このタブのタスク2');
        await vi.waitFor(() => expect(taskStore.serverRevision).toBe(4));
        const nextPost = JSON.parse(fetchMock.mock.calls[3][1].body);
        expect(nextPost.baseRevision).toBe(3);
    });

    it('revisionSave_オブジェクトのキー順だけの差異ではPOSTせずリモート側の変更を保持する', async () => {
        const memoStore = useMemoStore();
        fetchMock.mockResolvedValueOnce(Response.json({
            success: true,
            memos: [{
                id: 'm1',
                content: '初期',
                color: 'yellow',
                pinned: false,
                order: 0,
                createdAt: '2026-11-22T00:00:00Z',
                updatedAt: '2026-11-22T00:00:00Z'
            }],
            revision: 1
        }));
        await memoStore.loadFromLocalStorage();
        fetchMock.mockClear();

        // キー順だけを入れ替えて再代入しても内容が同一なら POST は発生しない
        memoStore.memos = [{
            updatedAt: '2026-11-22T00:00:00Z',
            createdAt: '2026-11-22T00:00:00Z',
            order: 0,
            pinned: false,
            color: 'yellow',
            content: '初期',
            id: 'm1'
        }];
        await Promise.resolve();
        await Promise.resolve();
        expect(fetchMock).not.toHaveBeenCalled();

        // リモート側の変更が来ても未編集としてリモート値を取り込む
        await memoStore.applyServerMemoAction({
            action: 'update',
            memoId: 'm1',
            revision: 2,
            memo: {
                id: 'm1',
                content: 'CLI更新後',
                color: 'blue',
                pinned: true,
                order: 0,
                createdAt: '2026-11-22T00:00:00Z',
                updatedAt: '2026-11-22T00:01:00Z'
            }
        });
        expect(memoStore.memos[0].content).toBe('CLI更新後');
        expect(memoStore.memos[0].color).toBe('blue');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('revisionSave_非JSONの5xxエラー後に新しい通知が届くと保留差分を自動再同期する', async () => {
        const memoStore = useMemoStore();
        fetchMock.mockResolvedValueOnce(Response.json({ success: true, memos: [], revision: 1 }));
        await memoStore.loadFromLocalStorage();

        // 1回目 POST は 502 の非 JSON HTML を返す
        fetchMock
            .mockResolvedValueOnce(new Response('<html>502 Bad Gateway</html>', { status: 502 }))
            .mockResolvedValueOnce(Response.json({ revision: 3 }));

        memoStore.addMemo('未保存ローカルメモ');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        // 失敗直後に無限再試行しないこと
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(memoStore.serverRevision).toBe(1);

        // 後から新しいサーバー通知 (revision 2) が届くと、保留差分とマージして自動再送されること
        await memoStore.applyServerMemoAction({
            action: 'add',
            memoId: 'cli_m',
            revision: 2,
            memo: { id: 'cli_m', content: 'CLIメモ', order: 0, createdAt: '2026-11-22T00:00:00Z', updatedAt: '2026-11-22T00:00:00Z' }
        });
        await vi.waitFor(() => expect(memoStore.serverRevision).toBe(3));
        const resyncPost = JSON.parse(fetchMock.mock.calls[2][1].body);
        expect(resyncPost.baseRevision).toBe(2);
        expect(resyncPost.memos.map((m: { content: string }) => m.content)).toEqual(['CLIメモ', '未保存ローカルメモ']);
    });

    it('revisionSave_409上限到達後に新しい通知が届くと保留差分を最新revisionで自動再同期する', async () => {
        const memoStore = useMemoStore();
        fetchMock.mockResolvedValueOnce(Response.json({ success: true, memos: [], revision: 1 }));
        await memoStore.loadFromLocalStorage();

        const mk = (id: string, content: string) => ({
            id, content, order: 0, createdAt: '2026-11-22T00:00:00Z', updatedAt: '2026-11-22T00:00:00Z'
        });

        // 4回連続 409 でリトライ上限 (3回) に到達させる
        fetchMock
            .mockResolvedValueOnce(Response.json({ data: { currentRevision: 2, memos: [mk('r2', 'R2')] } }, { status: 409 }))
            .mockResolvedValueOnce(Response.json({ data: { currentRevision: 3, memos: [mk('r2', 'R2'), mk('r3', 'R3')] } }, { status: 409 }))
            .mockResolvedValueOnce(Response.json({ data: { currentRevision: 4, memos: [mk('r2', 'R2'), mk('r3', 'R3'), mk('r4', 'R4')] } }, { status: 409 }))
            .mockResolvedValueOnce(Response.json({ data: { currentRevision: 5, memos: [mk('r2', 'R2'), mk('r3', 'R3'), mk('r4', 'R4'), mk('r5', 'R5')] } }, { status: 409 }))
            .mockResolvedValueOnce(Response.json({ revision: 6 }));

        memoStore.addMemo('ローカル保留メモ');
        // 初回 GET(1) + POST 4回 = 5回呼ばれ、上限で停止すること
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect(memoStore.serverRevision).toBe(4);

        // 後から revision 5 の通知が届くと、手動編集を待たず最新 revision 5 で自動再送されること
        await memoStore.applyServerMemoAction({
            action: 'add',
            memoId: 'r5',
            revision: 5,
            memo: mk('r5', 'R5')
        });
        await vi.waitFor(() => expect(memoStore.serverRevision).toBe(6));
        const resyncPost = JSON.parse(fetchMock.mock.calls[5][1].body);
        expect(resyncPost.baseRevision).toBe(5);
        expect(resyncPost.memos.map((m: { content: string }) => m.content)).toContain('ローカル保留メモ');
        expect(resyncPost.memos.map((m: { content: string }) => m.content)).toContain('R5');
    });
});

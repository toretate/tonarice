import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listMemorySessions: vi.fn() }));
vi.mock('h3', async importOriginal => ({
    ...await importOriginal<typeof import('h3')>(),
    getQuery: (event: any) => event.query,
    setHeader: vi.fn()
}));
vi.mock('../../mastra/memory-store', () => ({ getMemoryStore: () => ({ memory: {} }) }));
vi.mock('../../mastra/memory-history', () => ({ listMemorySessions: mocks.listMemorySessions }));
import handler from '../mastra-history.get';

describe('Mastra履歴APIの選択スコープ', () => {
    beforeEach(() => mocks.listMemorySessions.mockReset().mockResolvedValue([]));

    it('get_認証済み利用者の識別子を返し生のユーザーIDを露出しないこと', async () => {
        const request = (userId: string, mascotId: string) => handler({
            context: { user: { id: userId } }, query: { mascotId, userId: '無視される指定' }
        } as any);
        const first = await request('owner-a', 'mascot-a');
        expect((await request('owner-a', 'mascot-b')).selectionScope).toBe(first.selectionScope);
        expect((await request('owner-b', 'mascot-a')).selectionScope).not.toBe(first.selectionScope);
        expect(first.selectionScope).not.toContain('owner-a');
        expect(mocks.listMemorySessions.mock.calls.map(call => call.slice(1))).toEqual([
            ['owner-a', 'mascot-a'], ['owner-a', 'mascot-b'], ['owner-b', 'mascot-a']
        ]);
    });

    it('get_未認証ではスコープも履歴も取得できないこと', async () => {
        await expect(handler({ context: {}, query: { mascotId: 'mascot-a' } } as any)).rejects.toMatchObject({ statusCode: 401 });
        expect(mocks.listMemorySessions).not.toHaveBeenCalled();
    });
});

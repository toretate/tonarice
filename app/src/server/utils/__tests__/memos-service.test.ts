import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { executeMemosTool } from '../tool-executor';
import { loadMemosFromDb, saveMemosToDb } from '../memos-service';

const fsMocks = vi.hoisted(() => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn()
}));

vi.mock('fs', () => fsMocks);
vi.mock('../paths', () => ({ USERS_DIR: 'test-users' }));
vi.mock('../fs-helpers', () => ({ safeWriteFileSync: vi.fn() }));

describe('memos-service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loadMemosFromDb メモファイルがない場合は空配列を返すこと', async () => {
        const missingFile = Object.assign(new Error('ファイルがありません'), { code: 'ENOENT' });
        fsMocks.readFileSync.mockImplementationOnce(() => { throw missingFile; });
        fsMocks.readFileSync.mockImplementationOnce(() => { throw missingFile; });

        expect(loadMemosFromDb('user-1')).toEqual([]);
        expect(JSON.parse(await executeMemosTool('user-1', { action: 'search' }))).toMatchObject({
            success: true,
            count: 0
        });
    });

    it('loadMemosFromDb 保存済みのメモ配列を返すこと', () => {
        fsMocks.readFileSync.mockReturnValue(JSON.stringify({
            memos: [{ id: 'memo-1', content: 'テスト' }]
        }));

        expect(loadMemosFromDb('user-1')).toEqual([{ id: 'memo-1', content: 'テスト' }]);
    });

    it('ユーザーディレクトリがない場合は作成して保存すること', async () => {
        fsMocks.existsSync.mockReturnValue(false);
        const { safeWriteFileSync } = await import('../fs-helpers');
        const memos = [{ id: 'memo-1', content: 'テスト' }];

        saveMemosToDb('user-1', memos);

        expect(fsMocks.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('user-1'), { recursive: true });
        expect(safeWriteFileSync).toHaveBeenCalledWith(
            expect.stringContaining('memos.json'),
            JSON.stringify({ memos }, null, 4)
        );
    });

    it.each([
        { args: {}, count: 2 },
        { args: { query: ' * ' }, count: 2 },
        { args: { query: '   ' }, count: 2 },
        { args: { query: 'meeting' }, count: 1 },
        { args: { query: 'MEETING*' }, count: 1 },
        { args: { query: '*', literalQuery: true }, count: 1 },
        { args: { query: '該当なし' }, count: 0 }
    ])('executeMemosTool 検索条件 $args で $count 件を返すこと', async ({ args, count }) => {
        const memos = [
            { id: 'memo-1', content: 'Meeting notes' },
            { id: 'memo-2', content: '* 買い物' }
        ];
        fsMocks.readFileSync.mockReturnValue(JSON.stringify({ memos }));

        expect(loadMemosFromDb('user-1')).toEqual(memos);
        const result = JSON.parse(await executeMemosTool('user-1', { action: 'search', ...args }));
        expect(result).toMatchObject({ success: true, count });
        if (args.literalQuery) {
            expect(result.message).toContain('[ID: memo-2]');
            expect(result.message).not.toContain('[ID: memo-1]');
        }
        expect(fsMocks.readFileSync.mock.calls).toEqual([
            [join('test-users', 'user-1', 'memos.json'), 'utf8'],
            [join('test-users', 'user-1', 'memos.json'), 'utf8']
        ]);
    });

    it.each(['不正な JSON', '{"memos":null}'])('executeMemosTool 保存形式が異常なら読み取り失敗を返すこと', async raw => {
        fsMocks.readFileSync.mockReturnValue(raw);
        expect(JSON.parse(await executeMemosTool('user-1', { action: 'search' }))).toEqual({
            success: false,
            error: 'メモの読み取りに失敗しました。'
        });
    });

    it('executeMemosTool 読み取り権限がない場合は失敗を返すこと', async () => {
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            fsMocks.readFileSync.mockImplementationOnce(() => {
                throw Object.assign(new Error('アクセス拒否: 非公開のパス'), { code: 'EACCES' });
            });
            expect(JSON.parse(await executeMemosTool('user-1', { action: 'search' })).success).toBe(false);
            expect(errorLog).toHaveBeenCalledWith('[MemosDB] メモの読み取りに失敗しました。', 'Error (EACCES)');
        } finally {
            errorLog.mockRestore();
        }
    });

    it.each([
        { query: '買い物*', ids: ['memo-1', 'memo-2', 'memo-4'] },
        { query: '*リスト', ids: ['memo-1', 'memo-2'] },
        { query: '買い物*リスト', ids: ['memo-1', 'memo-2'] },
        { query: '*買い物**リスト*', ids: ['memo-1', 'memo-2', 'memo-3'] },
        { query: '買い物*買い物', ids: [] },
        { query: '買い物*リスト', literalQuery: true, ids: [] }
    ])('executeMemosTool ワイルドカード検索 $query の一致を判定すること', async ({ query, literalQuery, ids }) => {
        fsMocks.readFileSync.mockReturnValue(JSON.stringify({
            memos: [
                { id: 'memo-1', content: '買い物リスト' },
                { id: 'memo-2', content: '買い物\n週末リスト' },
                { id: 'memo-3', content: '今週の買い物リストを確認' },
                { id: 'memo-4', content: '買い物' }
            ]
        }));

        const result = JSON.parse(await executeMemosTool('user-1', { action: 'search', query, literalQuery }));
        expect(result).toMatchObject({ success: true, count: ids.length });
        expect([...result.message.matchAll(/\[ID: ([^\]]+)\]/g)].map(match => match[1])).toEqual(ids);
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
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

    it('メモファイルがない場合は空配列を返すこと', () => {
        fsMocks.existsSync.mockReturnValue(false);

        expect(loadMemosFromDb('user-1')).toEqual([]);
    });

    it('保存済みのメモ配列を返すこと', () => {
        fsMocks.existsSync.mockReturnValue(true);
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
});

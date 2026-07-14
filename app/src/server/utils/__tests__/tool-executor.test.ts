import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTasksTool, executeMemosTool } from '../tool-executor';
import * as tasksService from '../tasks-service';
import * as memosService from '../memos-service';

vi.mock('../tasks-service', () => ({
    addTaskToDb: vi.fn(),
    searchTasksFromDb: vi.fn(),
    updateTaskInDb: vi.fn(),
    deleteTaskFromDb: vi.fn()
}));

vi.mock('../memos-service', () => ({
    addMemoToDb: vi.fn(),
    searchMemosFromDb: vi.fn(),
    updateMemoInDb: vi.fn(),
    deleteMemoFromDb: vi.fn()
}));

describe('tool-executor.ts のテスト', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executeTasksTool - search アクションで結果に task ID が含まれること', async () => {
        vi.mocked(tasksService.searchTasksFromDb).mockReturnValue([
            { id: 'task_abc', title: 'テストタスク', completed: false, scheduledAt: null }
        ]);

        const resultStr = await executeTasksTool('user_1', { action: 'search', query: 'テスト' });
        const result = JSON.parse(resultStr);

        expect(result.success).toBe(true);
        expect(result.message).toContain('[ID: task_abc]');
        expect(tasksService.searchTasksFromDb).toHaveBeenCalledWith('user_1', 'テスト', undefined, undefined);
    });

    it('executeTasksTool - delete アクションで渡された ID が deleteTaskFromDb にそのまま渡ること', async () => {
        const resultStr = await executeTasksTool('user_1', { action: 'delete', id: 'task_abc' });
        const result = JSON.parse(resultStr);

        expect(result.success).toBe(true);
        expect(result.action).toBe('delete');
        expect(result.id).toBe('task_abc');
        expect(tasksService.deleteTaskFromDb).toHaveBeenCalledWith('user_1', 'task_abc');
    });

    it('executeMemosTool - search アクションで結果に memo ID が含まれること', async () => {
        vi.mocked(memosService.searchMemosFromDb).mockReturnValue([
            { id: 'memo_xyz', content: 'テストメモ内容' }
        ]);

        const resultStr = await executeMemosTool('user_1', { action: 'search', query: 'テスト' });
        const result = JSON.parse(resultStr);

        expect(result.success).toBe(true);
        expect(result.message).toContain('[ID: memo_xyz]');
        expect(memosService.searchMemosFromDb).toHaveBeenCalledWith('user_1', 'テスト');
    });

    it('executeMemosTool - delete アクションで渡された ID が deleteMemoFromDb にそのまま渡ること', async () => {
        const resultStr = await executeMemosTool('user_1', { action: 'delete', id: 'memo_xyz' });
        const result = JSON.parse(resultStr);

        expect(result.success).toBe(true);
        expect(result.action).toBe('delete');
        expect(result.id).toBe('memo_xyz');
        expect(memosService.deleteMemoFromDb).toHaveBeenCalledWith('user_1', 'memo_xyz');
    });
});

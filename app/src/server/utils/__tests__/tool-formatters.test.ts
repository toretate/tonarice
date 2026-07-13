import { describe, it, expect } from 'vitest';
import { formatTaskSearchResults, formatMemoSearchResults } from '../tool-formatters';

describe('tool-formatters.ts のテスト', () => {
    it('formatTaskSearchResults - タスクが0件の時の既存メッセージを返すこと', () => {
        const result = formatTaskSearchResults([]);
        expect(result).toBe('該当する予定やタスクは見つかりませんでした。');
    });

    it('formatTaskSearchResults - 複数件のタスクが正しくフォーマットされること（ID、完了状態、タイトル、予定日時）', () => {
        const tasks = [
            { id: 'task_1', title: '朝会', completed: false, scheduledAt: '2026-07-13T10:00:00+09:00' },
            { id: 'task_2', title: '買い物', completed: true, scheduledAt: null }
        ];
        const result = formatTaskSearchResults(tasks);
        expect(result).toContain('タスク・予定が 2 件見つかりました：');
        expect(result).toContain('- [ID: task_1] [未完了] 朝会 (予定日時: 2026/7/13 10:00:00)');
        expect(result).toContain('- [ID: task_2] [完了] 買い物');
    });

    it('formatMemoSearchResults - メモが0件の時の既存メッセージを返すこと', () => {
        const result = formatMemoSearchResults([]);
        expect(result).toBe('該当するメモは見つかりませんでした。');
    });

    it('formatMemoSearchResults - メモが正しくフォーマットされること（ID、内容）', () => {
        const memos = [
            { id: 'memo_1', content: '牛乳を買う' },
            { id: 'memo_2', content: '部屋の掃除' }
        ];
        const result = formatMemoSearchResults(memos);
        expect(result).toContain('メモが 2 件見つかりました：');
        expect(result).toContain('- [ID: memo_1] 牛乳を買う');
        expect(result).toContain('- [ID: memo_2] 部屋の掃除');
    });
});

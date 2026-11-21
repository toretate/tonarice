import { describe, expect, it } from 'vitest';
import { describeToolApproval } from '../tool-approval-display';

describe('操作確認の表示', () => {
    it('describeToolApproval_メモ追加を日本語の項目で表示すること', () => {
        expect(describeToolApproval({ id: '1', name: 'manageMemos', input: { action: 'add', content: 'テスト' } })).toEqual({
            title: 'メモを追加しますか？', fields: [{ label: '内容', value: 'テスト' }]
        });
    });

    it('describeToolApproval_削除対象と未知の項目を省略しないこと', () => {
        expect(describeToolApproval({ id: '1', name: 'manageTasks', input: { action: 'delete', id: 'task-1', extra: '値' } })).toEqual({
            title: 'タスクを削除しますか？', fields: [{ label: '対象ID', value: 'task-1' }, { label: 'extra', value: '値' }]
        });
    });
});

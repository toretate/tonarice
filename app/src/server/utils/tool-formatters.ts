export interface TaskFormatterInput {
    id: string;
    title: string;
    completed: boolean;
    scheduledAt?: string | null;
}

export interface MemoFormatterInput {
    id: string;
    content: string;
}

/**
 * タスクの検索結果を表示文字列にフォーマットします。
 * 各タスク項目には一意の ID [ID: task_xxxx] を付与し、AI が正確に参照できるようにします。
 */
export function formatTaskSearchResults(tasks: TaskFormatterInput[]): string {
    if (tasks.length === 0) {
        return '該当する予定やタスクは見つかりませんでした。';
    }
    const lines = tasks.map(t => {
        const dateStr = t.scheduledAt ? ` (予定日時: ${new Date(t.scheduledAt).toLocaleString('ja-JP')})` : '';
        const statusStr = t.completed ? '[完了]' : '[未完了]';
        return `- [ID: ${t.id}] ${statusStr} ${t.title}${dateStr}`;
    });
    return `タスク・予定が ${tasks.length} 件見つかりました：\n${lines.join('\n')}`;
}

/**
 * メモの検索結果を表示文字列にフォーマットします。
 * 各メモ項目には一意の ID [ID: memo_xxxx] を付与し、AI が正確に参照できるようにします。
 */
export function formatMemoSearchResults(memos: MemoFormatterInput[]): string {
    if (memos.length === 0) {
        return '該当するメモは見つかりませんでした。';
    }
    const lines = memos.map(m => `- [ID: ${m.id}] ${m.content}`);
    return `メモが ${memos.length} 件見つかりました：\n${lines.join('\n')}`;
}

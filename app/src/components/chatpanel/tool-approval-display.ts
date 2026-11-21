export const toolApprovalLabels: Record<string, string> = {
    manageTasks: 'タスク', manageMemos: 'メモ', adjustVolume: '音量', launchApp: 'アプリ起動'
};

const fieldLabels: Record<string, string> = {
    id: '対象ID', title: 'タイトル', content: '内容', scheduledAt: '予定日時', priority: '優先度',
    categoryId: 'カテゴリID', completed: '完了状態', color: '色', pinned: 'ピン留め', volume: '音量', appName: 'アプリ'
};

export interface ToolApprovalRequest {
    id: string;
    name: string;
    input: Record<string, unknown>;
    targetLabel?: string;
}

export function describeToolApproval(request: ToolApprovalRequest): { title: string; fields: { label: string; value: string }[] } {
    const name = toolApprovalLabels[request.name] || 'ツール';
    const actions: Record<string, string> = { add: '追加', update: '変更', delete: '削除' };
    const action = typeof request.input.action === 'string' ? actions[request.input.action] : undefined;
    const title = action ? `${name}を${action}しますか？` : `${name}を実行しますか？`;
    const fields = Object.entries(request.input).filter(([key]) => key !== 'action').map(([key, value]) => ({
        label: fieldLabels[key] || key,
        value: value === null ? '解除' : typeof value === 'boolean' ? (value ? 'はい' : 'いいえ') : typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)
    }));
    if (request.name === 'adjustVolume') {
        const field = fields.find(item => item.label === '音量');
        if (field) field.value += '%';
    }
    if (typeof request.input.action === 'string' && !action) fields.unshift({ label: '操作', value: request.input.action });
    if (request.targetLabel) fields.unshift({ label: '対象（表示中の情報）', value: request.targetLabel });
    return { title, fields };
}

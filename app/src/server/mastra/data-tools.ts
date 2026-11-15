import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { manageTasksToolShared } from '../../utils/task-tools-shared';
import { manageMemos } from '../../utils/memo-tools-shared';

const taskInputSchema = z.object({
    action: z.enum(['add', 'search', 'update', 'delete']).describe('操作種別'),
    title: z.string().optional().describe('add時のタスク名'),
    scheduledAt: z.string().nullable().optional().describe('予定日時。ISO 8601形式。update時のnullは期限削除'),
    priority: z.enum(['normal', 'star', 'thunder']).optional().describe('優先度'),
    categoryId: z.string().optional().describe('カテゴリID。Workはdefault、Privateはprivate'),
    id: z.string().optional().describe('update・delete時に必須のタスクID。タイトルを指定しない'),
    query: z.string().optional().describe('search時の検索キーワード'),
    date: z.string().optional().describe('search時の予定日。YYYY-MM-DD形式'),
    completed: z.boolean().optional().describe('search時の完了絞り込み、またはupdate時の完了状態')
});

const memoInputSchema = z.object({
    action: z.enum(['add', 'search', 'update', 'delete']).describe('操作種別'),
    content: z.string().optional().describe('add時のメモ本文'),
    id: z.string().optional().describe('update・delete時に必須のメモID。本文を指定しない'),
    query: z.string().optional().describe('search時の検索キーワード'),
    color: z.string().optional().describe('付箋色'),
    pinned: z.boolean().optional().describe('ピン留め')
});

/**
 * ユーザー別DBの実行関数はWebSocketの認証済み接続から注入する。
 */
async function executeDataTool(
    name: 'manageTasks' | 'manageMemos',
    input: Record<string, unknown>,
    requestContext: {
        get: (key: 'dataToolsEnabled' | 'executeDataTool' | 'onDataToolResult') => unknown;
    }
): Promise<unknown> {
    const execute = requestContext.get('executeDataTool');
    if (requestContext.get('dataToolsEnabled') !== true || typeof execute !== 'function') {
        return { success: false, error: 'データ管理ツールは利用できません。' };
    }
    console.info(`[MastraTool] ${name}の実行を開始`);
    try {
        const output = await execute(name, input);
        const parsed = JSON.parse(output);
        const notify = requestContext.get('onDataToolResult');
        if (parsed?.success === true && typeof notify === 'function') {
            try {
                notify(name, input, output);
            } catch {
                console.warn(`[MastraTool] ${name}の画面同期に失敗`);
            }
        }
        console.info(`[MastraTool] ${name}の実行が完了`);
        return parsed;
    } catch {
        console.warn(`[MastraTool] ${name}の実行に失敗`);
        return { success: false, error: 'データ操作に失敗しました。' };
    }
}

export const mastraTasksTool = createTool({
    id: 'manageTasks',
    description: manageTasksToolShared.description,
    inputSchema: taskInputSchema,
    execute: async (input, { requestContext }) => executeDataTool('manageTasks', input, requestContext)
});

export const mastraMemosTool = createTool({
    id: 'manageMemos',
    description: manageMemos.description,
    inputSchema: memoInputSchema,
    execute: async (input, { requestContext }) => executeDataTool('manageMemos', input, requestContext)
});

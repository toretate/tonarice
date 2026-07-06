import { tool } from '@lmstudio/sdk';
import { z } from 'zod';

export const addTaskTool = tool({
    name: 'addTask',
    description: '新しいタスク（TODO）を追加します。期限や予定日時がないタスクに対して使用します。',
    parameters: {
        title: z.string().describe('タスクの内容・タイトル'),
        priority: z.enum(['normal', 'star', 'thunder']).optional().default('normal').describe('タスクの優先度。デフォルトは normal。'),
        categoryId: z.string().optional().default('default').describe('追加先のカテゴリID。Work（仕事）の場合は default、Private（プライベート）の場合は private を指定してください。')
    },
    implementation: async ({ title, priority, categoryId }) => {
        // 実際のアクションはフロントエンドで実行されるため、ここでは成功の旨のメッセージと構造化データを返却します。
        return JSON.stringify({
            success: true,
            action: 'addTask',
            task: {
                title,
                priority,
                categoryId
            }
        });
    }
});

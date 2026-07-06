import { tool } from '@lmstudio/sdk';
import { z } from 'zod';

export const addScheduleTool = tool({
    name: 'addSchedule',
    description: '予定日時や期限付きのスケジュール（タスク）を追加します。カレンダーに登録するような日付や時間指定のあるタスクに使用します。',
    parameters: {
        title: z.string().describe('予定・タスクの内容・タイトル'),
        scheduledAt: z.string().describe('予定日時。ISO 8601形式の文字列 (例: 2026-07-06T18:00:00+09:00)。ユーザーが指示した日付・時間をこの形式に変換して指定してください。'),
        priority: z.enum(['normal', 'star', 'thunder']).optional().default('normal').describe('優先度。デフォルトは normal。'),
        categoryId: z.string().optional().default('default').describe('追加先のカテゴリID。Work（仕事）の場合は default、Private（プライベート）の場合は private を指定してください。')
    },
    implementation: async ({ title, scheduledAt, priority, categoryId }) => {
        // 実際のアクションはフロントエンドで実行されるため、ここでは成功の旨のメッセージと構造化データを返却します。
        return JSON.stringify({
            success: true,
            action: 'addSchedule',
            schedule: {
                title,
                scheduledAt,
                priority,
                categoryId
            }
        });
    }
});

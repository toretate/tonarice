import { defineEventHandler, readBody, createError } from 'h3';
import fs from 'fs';
import path from 'path';
import { USERS_DIR } from '../utils/paths';
import { saveHistoryToDB } from '../utils/history-db';

export default defineEventHandler(async (event) => {
    try {
        console.log('[Server] Save chat history request received');
        if (!event.context.user) {
            throw createError({
                statusCode: 401,
                statusMessage: '認証情報が見つかりません。'
            });
        }

        const userId = event.context.user.id;
        const userDir = path.join(USERS_DIR, userId);

        // ユーザーディレクトリの自動生成
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        const history = await readBody(event);
        saveHistoryToDB(userId, history);
        console.log(`[Server] Chat history saved successfully to database for user: ${userId}`);
        return { success: true };
    } catch (error: any) {
        console.error('[Server] Failed to save chat history:', error.message);
        throw createError({
            statusCode: 500,
            statusMessage: error.message
        });
    }
});

import { defineEventHandler, createError } from 'h3';
import fs from 'fs';
import path from 'path';
import { HISTORY_TEMPLATE_PATH, USERS_DIR } from '../utils/paths';
import { loadHistoryFromDB } from '../utils/history-db';

export default defineEventHandler(async (event) => {
    try {
        console.log('[Server] Load chat history request received');
        if (!event.context.user) {
            throw createError({
                statusCode: 401,
                statusMessage: '認証情報が見つかりません。'
            });
        }

        const userId = event.context.user.id;
        const userJsonPath = path.join(USERS_DIR, userId, 'chat_history.json');
        const userDbPath = path.join(USERS_DIR, userId, 'chat_histories.db');
        const userDir = path.dirname(userJsonPath);

        // ユーザーディレクトリの自動生成
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        // 新規ユーザーでJsonもSQLiteも存在しない場合、テンプレートからJsonをコピー
        if (!fs.existsSync(userDbPath) && !fs.existsSync(userJsonPath)) {
            if (fs.existsSync(HISTORY_TEMPLATE_PATH)) {
                fs.copyFileSync(HISTORY_TEMPLATE_PATH, userJsonPath);
                console.log(`[Server] ルートの chat_history.json をユーザー用履歴として初期化コピーしました: ${userId}`);
            }
        }

        const history = loadHistoryFromDB(userId);
        return { success: true, history };
    } catch (error: any) {
        console.error('[Server] Failed to load chat history:', error.message);
        throw createError({
            statusCode: 500,
            statusMessage: error.message
        });
    }
});

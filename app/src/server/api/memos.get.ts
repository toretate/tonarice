import { createError, defineEventHandler } from 'h3';
import { loadMemosFromDb } from '../utils/memos-service';

export default defineEventHandler((event) => {
    if (!event.context.user) {
        throw createError({
            statusCode: 401,
            statusMessage: '認証情報が見つかりません。'
        });
    }

    try {
        return {
            success: true,
            memos: loadMemosFromDb(event.context.user.id)
        };
    } catch (error: any) {
        console.error('[Server] Failed to load memos:', error.message);
        throw createError({
            statusCode: 500,
            statusMessage: `memos.json の読み込みに失敗しました: ${error.message}`
        });
    }
});

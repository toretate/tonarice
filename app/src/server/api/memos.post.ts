import { createError, defineEventHandler, readBody } from 'h3';
import { saveMemosToDb } from '../utils/memos-service';

export default defineEventHandler(async (event) => {
    if (!event.context.user) {
        throw createError({
            statusCode: 401,
            statusMessage: '認証情報が見つかりません。'
        });
    }

    const body = await readBody(event);
    if (!Array.isArray(body?.memos)) {
        throw createError({
            statusCode: 400,
            statusMessage: 'memos は配列で指定してください。'
        });
    }

    try {
        saveMemosToDb(event.context.user.id, body.memos);
        return { success: true };
    } catch (error: any) {
        console.error('[Server] Failed to save memos:', error.message);
        throw createError({
            statusCode: 500,
            statusMessage: `memos.json の保存に失敗しました: ${error.message}`
        });
    }
});

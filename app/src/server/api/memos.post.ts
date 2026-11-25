import { createError, defineEventHandler, readBody } from 'h3';
import { saveMemosToDb } from '../utils/memos-service';
import { DataRevisionConflictError } from '../utils/revision-conflict';

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
    if (
        typeof body.baseRevision !== 'number'
        || !Number.isSafeInteger(body.baseRevision)
        || body.baseRevision < 0
    ) {
        throw createError({
            statusCode: 400,
            statusMessage: 'baseRevision は 0 以上の整数で指定してください。'
        });
    }

    try {
        const saved = saveMemosToDb(event.context.user.id, body.memos, {
            baseRevision: body.baseRevision
        });
        return { success: true, revision: saved.revision };
    } catch (error: any) {
        if (error instanceof DataRevisionConflictError) {
            throw createError({
                statusCode: 409,
                statusMessage: error.message,
                data: {
                    conflict: true,
                    currentRevision: error.currentRevision,
                    ...(error.latestData as Record<string, unknown>)
                }
            });
        }
        console.error('[Server] Failed to save memos:', error.message);
        throw createError({
            statusCode: 500,
            statusMessage: `memos.json の保存に失敗しました: ${error.message}`
        });
    }
});

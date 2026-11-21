import { createError, defineEventHandler, readBody } from 'h3';
import { getLmStudioModelStatus, LmStudioManagementError } from '../../utils/lmstudio-model-management';

export default defineEventHandler(async (event) => {
    const body = await readBody<{ endpoint?: string; modelKey?: string }>(event);
    try {
        return await getLmStudioModelStatus(body?.endpoint, body?.modelKey || '');
    } catch (error) {
        const statusCode = error instanceof LmStudioManagementError ? error.statusCode : 400;
        const message = error instanceof Error ? error.message : 'モデル情報の取得に失敗しました。';
        throw createError({ statusCode, message });
    }
});

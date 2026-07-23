import { createError, defineEventHandler, readBody } from 'h3';
import { fetchLmStudioModels } from '../../utils/lmstudio-api';

export default defineEventHandler(async (event) => {
    const body = await readBody<{ endpoint?: string }>(event);

    try {
        const models = await fetchLmStudioModels(body?.endpoint);
        return { success: true, models };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'LM Studioとの接続に失敗しました。';
        throw createError({
            statusCode: message.includes('HTTPまたはHTTPS') ? 400 : 502,
            statusMessage: message
        });
    }
});

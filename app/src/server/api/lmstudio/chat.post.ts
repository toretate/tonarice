import { createError, defineEventHandler, readBody } from 'h3';
import { ChatAiService } from '../../utils/chat-ai-service';
import { normalizeLmStudioEndpoint } from '../../utils/lmstudio-api';

interface LmStudioChatBody {
    message?: string;
    systemPrompt?: string;
    modelName?: string;
    endpoint?: string;
    history?: unknown[];
    attachments?: unknown[];
}

export default defineEventHandler(async (event) => {
    const body = await readBody<LmStudioChatBody>(event);
    if (!body?.message) {
        throw createError({ statusCode: 400, statusMessage: 'message is required' });
    }

    try {
        const response = await ChatAiService.generateResponse({
            message: body.message,
            apiKey: '',
            systemPrompt: body.systemPrompt || '',
            model: body.modelName || '',
            engine: 'lmstudio',
            lmstudioEndpoint: normalizeLmStudioEndpoint(body.endpoint),
            history: body.history,
            attachments: body.attachments,
            tools: {}
        });
        return { success: true, response };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'LM Studioとの接続に失敗しました。';
        throw createError({
            statusCode: message.includes('HTTPまたはHTTPS') ? 400 : 502,
            statusMessage: message
        });
    }
});

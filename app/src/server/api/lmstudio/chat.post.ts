import { createError, defineEventHandler, readBody } from 'h3';
import { MastraChatService } from '../../mastra/mastra-chat-service';
import { resolveMastraChatModel } from '../../mastra/model-resolver';
import { getMastraChatErrorMessage } from '../../mastra/chat-route';
import type { MastraChatAttachment, MastraChatHistoryItem } from '../../mastra/chat-input';
import { normalizeLmStudioEndpoint } from '../../utils/lmstudio-api';

interface LmStudioChatBody {
    message?: string;
    systemPrompt?: string;
    modelName?: string;
    endpoint?: string;
    history?: MastraChatHistoryItem[];
    attachments?: MastraChatAttachment[];
}

export default defineEventHandler(async (event) => {
    const body = await readBody<LmStudioChatBody>(event);
    if (typeof body?.message !== 'string' || !body.message.trim()) {
        throw createError({ statusCode: 400, statusMessage: 'message is required' });
    }

    let endpoint: string;
    try {
        endpoint = normalizeLmStudioEndpoint(body.endpoint);
    } catch {
        throw createError({ statusCode: 400, statusMessage: 'LM StudioのエンドポイントはHTTPまたはHTTPSで指定してください。' });
    }

    try {
        const resolved = resolveMastraChatModel({
            apiKey: '',
            model: body.modelName || '',
            engine: 'lmstudio',
            lmstudioEndpoint: endpoint
        });
        const response = await MastraChatService.generateResponse({
            ...resolved,
            message: body.message,
            systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : '',
            history: Array.isArray(body.history) ? body.history.filter(item => item && typeof item === 'object') : undefined,
            attachments: Array.isArray(body.attachments) ? body.attachments.filter(item => item && typeof item === 'object') : undefined
        });
        return { success: true, response };
    } catch (error) {
        throw createError({
            statusCode: 502,
            message: getMastraChatErrorMessage(error, 'lmstudio')
        });
    }
});

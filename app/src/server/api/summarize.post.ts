import { defineEventHandler, readBody, createError } from 'h3';
import { ChatAiService } from '../utils/chat-ai-service';

export default defineEventHandler(async (event) => {
    try {
        const body = await readBody(event);
        const {
            prompt,
            engine,
            model,
            apiKey,
            lmstudioEndpoint
        } = body as {
            prompt?: string;
            engine?: string;
            model?: string;
            apiKey?: string;
            lmstudioEndpoint?: string;
        };

        if (!prompt) {
            throw createError({
                statusCode: 400,
                statusMessage: 'prompt is required'
            });
        }

        console.log(`[Server] Summarize request: engine=${engine || 'default'}, model=${model || 'default'}`);

        const summary = await ChatAiService.generateResponse({
            message: prompt,
            apiKey: apiKey || '',
            systemPrompt: 'あなたは優秀な対話要約アシスタントです。',
            model: model || '',
            engine: engine || 'gemini',
            lmstudioEndpoint: lmstudioEndpoint || 'http://127.0.0.1:1234/v1/',
            tools: {
                toolsCurrentTime: false,
                toolsGpsLocation: false,
                toolsWeather: false,
                toolsVolume: false,
                toolsAppLauncher: false,
                toolsWebSearch: false
            }
        });

        return { success: true, summary };
    } catch (error: any) {
        console.error('[Server] Summarization failed:', error.message);
        throw createError({
            statusCode: 500,
            statusMessage: error.message
        });
    }
});

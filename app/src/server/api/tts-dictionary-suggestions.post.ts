import { createError, defineEventHandler, readBody } from 'h3';
import { suggestTtsDictionaryEntries } from '../utils/tts-dictionary-suggester';

export default defineEventHandler(async (event) => {
    const body = await readBody(event) as {
        text?: string;
        engine?: string;
        model?: string;
        apiKey?: string;
        lmstudioEndpoint?: string;
    };

    if (!body.text?.trim()) {
        throw createError({ statusCode: 400, statusMessage: '選択文が空です。' });
    }
    if (body.text.length > 10000) {
        throw createError({ statusCode: 400, statusMessage: '選択文が長すぎます。' });
    }

    try {
        const entries = await suggestTtsDictionaryEntries({
            text: body.text,
            engine: body.engine || 'gemini',
            model: body.model || '',
            apiKey: body.apiKey || '',
            lmstudioEndpoint: body.lmstudioEndpoint
        });
        return { success: true, entries };
    } catch (error: any) {
        console.error('[TtsDictionary] AIへの読み問い合わせに失敗しました:', error.message);
        throw createError({
            statusCode: 500,
            statusMessage: error.message || 'AIへの読み問い合わせに失敗しました。'
        });
    }
});

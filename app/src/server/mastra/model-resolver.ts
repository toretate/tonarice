import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';

export interface MastraModelRequest {
    engine: string;
    model?: string;
    apiKey: string;
}

/**
 * APIキーを共有ランタイムに保存せず、リクエストごとにモデルを作成する。
 */
export function resolveMastraChatModel(params: MastraModelRequest): {
    resolvedModel: unknown;
    engine: 'gemini' | 'openai';
    modelId: string;
} {
    const engine = params.engine || 'gemini';
    const apiKey = params.apiKey?.trim();

    if (engine === 'gemini') {
        if (!apiKey) {
            throw new Error('Gemini API KEYが設定されていません。設定画面の「APIキー」から設定してください。');
        }
        const modelId = params.model?.trim() || 'gemini-1.5-flash';
        return {
            resolvedModel: createGoogleGenerativeAI({ apiKey })(modelId),
            engine,
            modelId
        };
    }
    if (engine === 'openai') {
        if (!apiKey) {
            throw new Error('OpenAI API KEYが設定されていません。設定画面の「APIキー」から設定してください。');
        }
        const modelId = params.model?.trim() || 'gpt-4o';
        return {
            // 現在の制限付きキーはResponsesへのWriteを許可している。
            resolvedModel: createOpenAI({ apiKey })(modelId),
            engine,
            modelId
        };
    }
    throw new Error(`Mastraチャットで未対応のAIエンジンです: ${engine}`);
}

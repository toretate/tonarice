import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MastraChatService } from '../mastra-chat-service';
import { resetMastraRuntimeForTest } from '../runtime';

const liveTestEnabled = process.env.MASTRA_LIVE_TEST === '1';

function getRequiredApiKey(name: 'GEMINI_API_KEY' | 'OPENAI_API_KEY'): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`${name}が設定されていません。`);
    }
    return value;
}

function createSanitizedError(
    provider: string,
    error: unknown,
    secrets: readonly string[]
): Error {
    let message = error instanceof Error ? error.message : '詳細不明のエラー';
    for (const secret of secrets) {
        if (secret) {
            message = message.replaceAll(secret, '[REDACTED]');
        }
    }
    return new Error(`${provider}との実接続テストに失敗しました: ${message}`);
}

describe.skipIf(!liveTestEnabled)('MastraChatService.generateResponseの実接続テスト', () => {
    const originalFeatureFlag = process.env.MASTRA_CHAT_ENABLED;

    beforeAll(() => {
        process.env.MASTRA_CHAT_ENABLED = 'true';
        resetMastraRuntimeForTest();
    });

    afterAll(() => {
        if (originalFeatureFlag === undefined) {
            delete process.env.MASTRA_CHAT_ENABLED;
        } else {
            process.env.MASTRA_CHAT_ENABLED = originalFeatureFlag;
        }
        resetMastraRuntimeForTest();
    });

    it('generateResponse_Gemini実接続で確認文字列を返すこと', async () => {
        const geminiApiKey = getRequiredApiKey('GEMINI_API_KEY');
        const geminiModelId = process.env.MASTRA_TEST_GEMINI_MODEL || 'gemini-3.5-flash-lite';
        const google = createGoogleGenerativeAI({ apiKey: geminiApiKey });

        let geminiResponse: string;
        try {
            geminiResponse = await MastraChatService.generateResponse({
                message: '確認文字列 GEMINI_MASTRA_OK をそのまま返してください。',
                systemPrompt: '指定された確認文字列だけを返してください。説明や句読点を追加しないでください。',
                resolvedModel: google(geminiModelId),
                engine: 'gemini',
                modelId: geminiModelId,
                maxOutputTokens: 128
            });
        } catch (error) {
            throw createSanitizedError('Gemini', error, [geminiApiKey]);
        }

        expect(geminiResponse).toContain('GEMINI_MASTRA_OK');
    }, 120000);

    it('generateResponse_OpenAI実接続で確認文字列を返すこと', async () => {
        const openAiApiKey = getRequiredApiKey('OPENAI_API_KEY');
        const openAiModelId = process.env.MASTRA_TEST_OPENAI_MODEL || 'gpt-4o-mini';
        const openai = createOpenAI({ apiKey: openAiApiKey });

        let openAiResponse: string;
        try {
            openAiResponse = await MastraChatService.generateResponse({
                message: '確認文字列 OPENAI_MASTRA_OK をそのまま返してください。',
                systemPrompt: '指定された確認文字列だけを返してください。説明や句読点を追加しないでください。',
                // 現在の制限付きキーで許可されたResponses APIを使用する。
                resolvedModel: openai(openAiModelId),
                engine: 'openai',
                modelId: openAiModelId,
                maxOutputTokens: 128
            });
        } catch (error) {
            throw createSanitizedError('OpenAI', error, [openAiApiKey]);
        }

        expect(openAiResponse).toContain('OPENAI_MASTRA_OK');
    }, 120000);
});

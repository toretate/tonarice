import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerCalls = vi.hoisted(() => ({
    google: vi.fn(),
    googleConfig: vi.fn(),
    openai: vi.fn(),
    openaiConfig: vi.fn(),
    openaiChat: vi.fn()
}));

vi.mock('@ai-sdk/google', () => ({
    createGoogleGenerativeAI: (options: unknown) => {
        providerCalls.googleConfig(options);
        return providerCalls.google;
    }
}));
vi.mock('@ai-sdk/openai', () => ({
    createOpenAI: (options: unknown) => {
        providerCalls.openaiConfig(options);
        return Object.assign(providerCalls.openai, { chat: providerCalls.openaiChat });
    }
}));

import { resolveMastraChatModel } from '../model-resolver';

describe('resolveMastraChatModelのテスト', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resolveMastraChatModel_リクエストごとにGeminiモデルを解決すること', () => {
        const resolved = resolveMastraChatModel({ engine: 'gemini', model: 'gemini-test', apiKey: 'test-key' });

        expect(providerCalls.google).toHaveBeenCalledWith('gemini-test');
        expect(resolved.engine).toBe('gemini');
        expect(resolved.modelId).toBe('gemini-test');
    });

    it('resolveMastraChatModel_OpenAIはResponsesモデルを選択すること', () => {
        const resolved = resolveMastraChatModel({ engine: 'openai', model: 'gpt-test', apiKey: 'test-key' });

        expect(providerCalls.openai).toHaveBeenCalledWith('gpt-test');
        expect(providerCalls.openaiChat).not.toHaveBeenCalled();
        expect(resolved.modelId).toBe('gpt-test');
    });

    it('resolveMastraChatModel_異なるAPIキーをリクエスト間で再利用しないこと', () => {
        resolveMastraChatModel({ engine: 'openai', model: 'gpt-test', apiKey: 'first-key' });
        resolveMastraChatModel({ engine: 'openai', model: 'gpt-test', apiKey: 'second-key' });

        expect(providerCalls.openaiConfig).toHaveBeenNthCalledWith(1, { apiKey: 'first-key' });
        expect(providerCalls.openaiConfig).toHaveBeenNthCalledWith(2, { apiKey: 'second-key' });
    });

    it('resolveMastraChatModel_キー未設定と未対応エンジンを拒否すること', () => {
        expect(() => resolveMastraChatModel({ engine: 'openai', apiKey: '' }))
            .toThrow('OpenAI API KEYが設定されていません');
        expect(() => resolveMastraChatModel({ engine: 'lmstudio', apiKey: 'test-key' }))
            .toThrow('未対応');
    });
});

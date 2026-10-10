import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { MastraChatService } from '../mastra-chat-service';
import { resetMastraRuntimeForTest } from '../runtime';

describe('MastraChatService.generateResponseのテスト', () => {
    const originalFeatureFlag = process.env.MASTRA_CHAT_ENABLED;

    beforeEach(() => {
        process.env.MASTRA_CHAT_ENABLED = 'true';
        resetMastraRuntimeForTest();
    });

    afterEach(() => {
        if (originalFeatureFlag === undefined) {
            delete process.env.MASTRA_CHAT_ENABLED;
        } else {
            process.env.MASTRA_CHAT_ENABLED = originalFeatureFlag;
        }
        resetMastraRuntimeForTest();
    });

    it('generateResponse_連続するリクエストで指定された異なるモデルを使用すること', async () => {
        const firstModel = createMockModel({
            mockText: '最初のモデルの応答',
            version: 'v2'
        });
        const secondModel = createMockModel({
            mockText: '次のモデルの応答',
            version: 'v2'
        });

        const first = await MastraChatService.generateResponse({
            message: 'こんにちは',
            systemPrompt: '簡潔に回答してください。',
            resolvedModel: firstModel,
            engine: 'gemini',
            modelId: 'first-model'
        });
        const second = await MastraChatService.generateResponse({
            message: 'こんにちは',
            systemPrompt: '簡潔に回答してください。',
            resolvedModel: secondModel,
            engine: 'openai',
            modelId: 'second-model'
        });

        expect(first).toBe('最初のモデルの応答');
        expect(second).toBe('次のモデルの応答');
    });

    it('generateResponse_機能フラグが無効な場合はAgentを実行しないこと', async () => {
        process.env.MASTRA_CHAT_ENABLED = 'false';
        const model = createMockModel({
            mockText: '呼び出されない応答',
            version: 'v2'
        });

        await expect(MastraChatService.generateResponse({
            message: 'こんにちは',
            systemPrompt: '簡潔に回答してください。',
            resolvedModel: model,
            engine: 'gemini',
            modelId: 'disabled-model'
        })).rejects.toThrow('Mastraチャット経路は無効です。');
    });

    it('generateResponse_履歴と添付画像をAgentへ渡すこと', async () => {
        const model = createMockModel({ mockText: '確認しました', version: 'v2' });
        const generate = vi.spyOn(model as { doGenerate: (options: unknown) => Promise<unknown> }, 'doGenerate');
        const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n9sAAAAASUVORK5CYII=';

        const reply = await MastraChatService.generateResponse({
            message: '画像を確認して',
            systemPrompt: '簡潔に回答してください。',
            resolvedModel: model,
            engine: 'openai',
            modelId: 'test-model',
            history: [
                { sender: 'user', text: '前の質問' },
                { sender: 'mascot', text: '前の返事' }
            ],
            attachments: [{ type: 'image', name: 'sample.png', url: `data:image/png;base64,${image}` }]
        });

        expect(reply).toBe('確認しました');
        expect(generate).toHaveBeenCalledOnce();
        const request = JSON.stringify(generate.mock.calls[0]?.[0]);
        expect(request).toContain('前の質問');
        expect(request).toContain('前の返事');
        expect(request).toContain('画像を確認して');
        expect(request).toContain('image/png');
    });
});

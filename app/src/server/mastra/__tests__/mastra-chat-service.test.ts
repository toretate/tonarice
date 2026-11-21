import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { MastraChatService } from '../mastra-chat-service';
import { resetMastraRuntimeForTest } from '../runtime';
import { GenerationBudget } from '../generation-budget';

describe('MastraChatService.generateResponseのテスト', () => {
    it('generateResponse_中断後にAgentが空で終了しても代替文を正常応答として返さないこと', async () => {
        const controller = new AbortController();
        const budget = new GenerationBudget(controller.signal);
        const model = createMockModel({ mockText: '未使用', version: 'v2' });
        let finish!: () => void;
        vi.spyOn(model as any, 'doGenerate').mockImplementation(async () => {
            await new Promise<void>(resolve => { finish = resolve; });
            return { content: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 0 }, warnings: [] };
        });
        const pending = MastraChatService.generateResponse({
            message: '試験', systemPrompt: '', engine: 'lmstudio', modelId: 'test', resolvedModel: model, generationBudget: budget
        });
        const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await vi.waitFor(() => expect(finish).toBeDefined());
        controller.abort();
        finish();
        await rejected;
        budget.dispose();
    });
    beforeEach(() => {
        resetMastraRuntimeForTest();
    });

    afterEach(() => {
        resetMastraRuntimeForTest();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
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

    it('generateResponse_設定が有効な発話だけ天気ツールを公開すること', async () => {
        const enabledCall = vi.fn();
        const disabledCall = vi.fn();
        const enabledModel = createMockModel({ mockText: '天気の応答', spyGenerate: enabledCall, version: 'v2' });
        const disabledModel = createMockModel({ mockText: '通常の応答', spyGenerate: disabledCall, version: 'v2' });

        await MastraChatService.generateResponse({
            message: '東京の天気は？', systemPrompt: '簡潔に回答してください。',
            resolvedModel: enabledModel, engine: 'gemini', modelId: 'enabled-model', weatherEnabled: true
        });
        await MastraChatService.generateResponse({
            message: '東京の天気は？', systemPrompt: '簡潔に回答してください。',
            resolvedModel: disabledModel, engine: 'gemini', modelId: 'disabled-model', weatherEnabled: false
        });

        expect(JSON.stringify(enabledCall.mock.calls[0]?.[0])).toContain('getWeather');
        expect(JSON.stringify(disabledCall.mock.calls[0]?.[0])).not.toContain('getWeather');
    });

    it('generateResponse_天気ツールを一度実行して結果を返答に反映すること', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                current: {
                    temperature_2m: 22.5,
                    relative_humidity_2m: 65,
                    weather_code: 3,
                    wind_speed_10m: 12
                }
            })
        });
        vi.stubGlobal('fetch', fetchMock);
        const model = createMockModel({ mockText: '使わない応答', version: 'v2' });
        const generate = vi.spyOn(model as { doGenerate: (options: unknown) => Promise<unknown> }, 'doGenerate');
        let callCount = 0;
        generate.mockImplementation(async () => {
            callCount += 1;
            return {
                content: callCount === 1
                    ? [
                        { type: 'tool-call', toolCallId: 'weather-1', toolName: 'getWeather', input: '{"city":"東京"}' },
                        { type: 'tool-call', toolCallId: 'weather-2', toolName: 'getWeather', input: '{"city":"東京"}' }
                    ]
                    : [{ type: 'text', text: '東京は曇りで22.5°Cです。' }],
                finishReason: callCount === 1 ? 'tool-calls' : 'stop',
                usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
                warnings: []
            };
        });

        const reply = await MastraChatService.generateResponse({
            message: '東京の天気は？', systemPrompt: '簡潔に回答してください。',
            resolvedModel: model, engine: 'gemini', modelId: 'test-model', weatherEnabled: true
        });

        expect(reply).toContain('曇り');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(generate).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(generate.mock.calls[1]?.[0])).toContain('22.5°C');
        expect(JSON.stringify(generate.mock.calls[1]?.[0])).toContain('取得済み');
    });
});

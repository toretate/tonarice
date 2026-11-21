import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MastraChatService } from '../mastra-chat-service';
import { resolveMastraChatModel } from '../model-resolver';
import { resetMastraRuntimeForTest } from '../runtime';

describe('LMStudioのMastra接続テスト', () => {
    beforeEach(() => {
        resetMastraRuntimeForTest();
    });

    afterEach(() => {
        resetMastraRuntimeForTest();
        vi.unstubAllGlobals();
    });

    it('generateResponse_ChatCompletionsへローカル設定を含む要求を送ること', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            id: 'chatcmpl-test', object: 'chat.completion', created: 1, model: 'local-model',
            choices: [{ index: 0, message: { role: 'assistant', content: 'ローカルモデルの返答' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        const resolved = resolveMastraChatModel({
            engine: 'lmstudio', model: 'local-model', apiKey: '',
            lmstudioEndpoint: 'http://127.0.0.1:1234/v1/',
            repetitionPenalty: 1.2, enableThinking: false
        });

        const reply = await MastraChatService.generateResponse({
            message: 'こんにちは', systemPrompt: '短く返答してください。',
            history: [{ sender: 'user', text: '前の発話\n/no_think' }],
            enableThinking: false,
            ...resolved
        });

        expect(reply).toBe('ローカルモデルの返答');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:1234/v1/chat/completions');
        const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body);
        expect(body).toMatchObject({
            model: 'local-model', repetition_penalty: 1.2,
            reasoning_format: 'none', include_reasoning: false
        });
        expect(JSON.stringify(body.messages.filter((item: { role: string }) => item.role === 'system'))).not.toContain('/no_think');
        expect(JSON.stringify(body.messages.filter((item: { role: string }) => item.role === 'user'))).toContain('前の発話');
        expect(JSON.stringify(body.messages)).not.toContain('前の発話\\n/no_think');
        expect(JSON.stringify(body.messages)).not.toContain('/no_think');
    });
});

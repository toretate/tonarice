import { vi, describe, it, expect } from 'vitest';

// readBody をモック化するために h3 をモック
vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        readBody: vi.fn()
    };
});

import { readBody } from 'h3';
import summarizeHandler from '../api/summarize.post';
import { ChatAiService } from '../utils/chat-ai-service';

vi.mock('../utils/chat-ai-service', () => {
    return {
        ChatAiService: {
            generateResponse: vi.fn()
        }
    };
});

describe('要約API (/api/summarize) のテスト', () => {
    it('summarize.post - 正常なパラメータを受け取ったときに ChatAiService を呼び出し要約結果を返却すること', async () => {
        const mockPrompt = 'これはテストする会話履歴です。';
        const mockSummary = '要約されたテキスト';
        
        // readBody が返すダミーデータを設定
        vi.mocked(readBody).mockResolvedValue({
            prompt: mockPrompt,
            engine: 'gemini',
            model: 'gemini-1.5-flash',
            apiKey: 'mock-api-key',
            lmstudioEndpoint: 'http://localhost:1234/v1'
        });

        // ChatAiService.generateResponse の返り値を設定
        vi.mocked(ChatAiService.generateResponse).mockResolvedValue(mockSummary);

        const dummyEvent = {} as any; // h3 event
        const result = await summarizeHandler(dummyEvent);

        expect(result).toEqual({
            success: true,
            summary: mockSummary
        });

        expect(ChatAiService.generateResponse).toHaveBeenCalledWith({
            message: mockPrompt,
            apiKey: 'mock-api-key',
            systemPrompt: 'あなたは優秀な対話要約アシスタントです。',
            model: 'gemini-1.5-flash',
            engine: 'gemini',
            lmstudioEndpoint: 'http://localhost:1234/v1',
            tools: {
                toolsCurrentTime: false,
                toolsGpsLocation: false,
                toolsWeather: false,
                toolsVolume: false,
                toolsAppLauncher: false,
                toolsWebSearch: false
            }
        });
    });

    it('summarize.post - prompt パラメータが不足している場合に 400 エラーをスローすること', async () => {
        vi.mocked(readBody).mockResolvedValue({
            engine: 'gemini',
            model: 'gemini-1.5-flash'
        });

        const dummyEvent = {} as any;
        
        await expect(summarizeHandler(dummyEvent)).rejects.toThrow();
    });
});

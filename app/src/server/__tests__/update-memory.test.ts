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
import updateMemoryHandler from '../api/update-memory.post';
import { ChatAiService } from '../utils/chat-ai-service';

vi.mock('../utils/chat-ai-service', () => {
    return {
        ChatAiService: {
            generateResponse: vi.fn()
        }
    };
});

describe('長期記憶更新API (/api/update-memory) のテスト', () => {
    it('updateMemory.post - 正常なパラメータを受け取ったときに ChatAiService を呼び出し記憶更新結果を返却すること', async () => {
        const mockCurrentMemory = '以前の記憶テキスト';
        const mockChatHistory = 'これはテストする会話履歴です。';
        const mockNewMemory = '# Mascot Long-term Memory\n- テスト用の新しい記憶';

        vi.mocked(readBody).mockResolvedValue({
            currentMemory: mockCurrentMemory,
            chatHistory: mockChatHistory,
            engine: 'gemini',
            model: 'gemini-1.5-flash',
            apiKey: 'mock-api-key',
            lmstudioEndpoint: 'http://localhost:1234/v1'
        });

        vi.mocked(ChatAiService.generateResponse).mockResolvedValue(mockNewMemory);

        const dummyEvent = {} as any;
        const result = await updateMemoryHandler(dummyEvent);

        expect(result).toEqual({
            success: true,
            memory: mockNewMemory
        });

        expect(ChatAiService.generateResponse).toHaveBeenCalledWith({
            message: expect.stringContaining(mockCurrentMemory),
            apiKey: 'mock-api-key',
            systemPrompt: 'あなたは優秀な対話分析・記憶管理アシスタントです。',
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

    it('updateMemory.post - パラメータが不足している場合に 400 エラーをスローすること', async () => {
        vi.mocked(readBody).mockResolvedValue({
            engine: 'gemini',
            model: 'gemini-1.5-flash'
        });

        const dummyEvent = {} as any;
        
        await expect(updateMemoryHandler(dummyEvent)).rejects.toThrow();
    });
});

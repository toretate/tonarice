import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ChatAiService } from '../utils/chat-ai-service';
import { suggestTtsDictionaryEntries } from '../utils/tts-dictionary-suggester';

vi.mock('../utils/chat-ai-service', () => ({
    ChatAiService: {
        generateResponse: vi.fn()
    }
}));

describe('suggestTtsDictionaryEntries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('suggestTtsDictionaryEntries - AI応答から候補語の有効な読みだけを返すこと', async () => {
        vi.mocked(ChatAiService.generateResponse).mockResolvedValue([
            '```json',
            '[',
            '  {"term":"biome","reading":"バイオーム"},',
            '  {"term":"ESLint","reading":"イーエスリント"},',
            '  {"term":"選択文にない語","reading":"不正"},',
            '  {"term":"Prettier","reading":"Prettier"}',
            ']',
            '```'
        ].join('\n'));

        const result = await suggestTtsDictionaryEntries({
            text: 'BiomeとESLintとPrettierを比較する。',
            engine: 'gemini',
            model: 'test-model',
            apiKey: 'test-key'
        });

        expect(result).toEqual([
            { term: 'Biome', reading: 'バイオーム' },
            { term: 'ESLint', reading: 'イーエスリント' }
        ]);
        expect(ChatAiService.generateResponse).toHaveBeenCalledOnce();
    });

    test('suggestTtsDictionaryEntries - 英語候補がない場合はAIへ問い合わせないこと', async () => {
        await expect(suggestTtsDictionaryEntries({
            text: '日本語だけです。',
            engine: 'gemini',
            model: 'test-model',
            apiKey: 'test-key'
        })).resolves.toEqual([]);
        expect(ChatAiService.generateResponse).not.toHaveBeenCalled();
    });
});

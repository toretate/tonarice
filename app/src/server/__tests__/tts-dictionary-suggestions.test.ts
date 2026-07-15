import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return { ...actual, readBody: vi.fn() };
});

vi.mock('../utils/tts-dictionary-suggester', () => ({
    suggestTtsDictionaryEntries: vi.fn()
}));

import { readBody } from 'h3';
import handler from '../api/tts-dictionary-suggestions.post';
import { suggestTtsDictionaryEntries } from '../utils/tts-dictionary-suggester';

describe('TTS読み候補API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('tts-dictionary-suggestions.post - AIの読み候補を返すこと', async () => {
        vi.mocked(readBody).mockResolvedValue({
            text: 'Biomeの読み',
            engine: 'gemini',
            model: 'test-model',
            apiKey: 'test-key',
            lmstudioEndpoint: 'http://localhost:1234/v1/'
        });
        vi.mocked(suggestTtsDictionaryEntries).mockResolvedValue([
            { term: 'Biome', reading: 'バイオーム' }
        ]);

        await expect(handler({} as any)).resolves.toEqual({
            success: true,
            entries: [{ term: 'Biome', reading: 'バイオーム' }]
        });
        expect(suggestTtsDictionaryEntries).toHaveBeenCalledWith({
            text: 'Biomeの読み',
            engine: 'gemini',
            model: 'test-model',
            apiKey: 'test-key',
            lmstudioEndpoint: 'http://localhost:1234/v1/'
        });
    });

    test('tts-dictionary-suggestions.post - 空の選択文を拒否すること', async () => {
        vi.mocked(readBody).mockResolvedValue({ text: '  ' });
        await expect(handler({} as any)).rejects.toThrow();
        expect(suggestTtsDictionaryEntries).not.toHaveBeenCalled();
    });
});

import { afterEach, describe, expect, test, vi } from 'vitest';
import { GeminiImageConnector } from '../gemini-image-connector';

describe('GeminiImageConnector', () => {
    afterEach(() => vi.unstubAllGlobals());

    test.each([
        ['gemini-2.5-flash-image', 'Nano Banana'],
        ['gemini-3.1-flash-image', 'Nano Banana 2'],
        ['gemini-3-pro-image', 'Nano Banana Pro']
    ] as const)('generateImage_%sでt2i生成できること', async (model, _displayName) => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: 'image-data', mimeType: 'image/png' } }] } }] })
        });
        vi.stubGlobal('fetch', fetchMock);

        expect(await GeminiImageConnector.generateImage({ prompt: 'test', model, imageSize: '2K' }, 'api-key')).toBe('image-data');
        const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
        expect(body.contents[0].parts).toEqual([{ text: 'test' }]);
        expect(body.generationConfig.responseFormat.image.aspectRatio).toBe('ASPECT_RATIO_ONE_BY_ONE');
        expect(body.generationConfig.responseFormat.image.imageSize).toBe(model === 'gemini-2.5-flash-image' ? undefined : 'IMAGE_SIZE_TWO_K');
    });

    test('generateImage_添付画像を使ってi2i編集できること', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: 'edited-image' } }] } }] })
        });
        vi.stubGlobal('fetch', fetchMock);

        await GeminiImageConnector.generateImage({
            prompt: '表情を笑顔にする',
            initImage: 'data:image/png;base64,aW1hZ2U='
        }, 'api-key');

        const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
        expect(body.contents[0].parts[1]).toEqual({ inline_data: { mime_type: 'image/png', data: 'aW1hZ2U=' } });
    });

    test('generateImage_APIエラーを呼び出し元へ返すこと', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 429,
            text: async () => JSON.stringify({ error: { message: 'quota exceeded' } })
        }));

        await expect(GeminiImageConnector.generateImage({ prompt: 'test' }, 'api-key')).rejects.toThrow(
            'Geminiとの接続エラー: quota exceeded'
        );
    });
});

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { OpenAiImageConnector } from '../openai-image-connector';

describe('OpenAiImageConnector', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    test('generateImage - テキストから画像を生成できること', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ data: [{ b64_json: 'generated-image' }] })
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await OpenAiImageConnector.generateImage({
            prompt: '青空を飛ぶマスコット',
            model: 'gpt-image-2',
            quality: 'high',
            size: '1024x1024',
            background: 'opaque'
        }, 'test-api-key');

        expect(result).toBe('generated-image');
        expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/images/generations', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
                model: 'gpt-image-2',
                prompt: '青空を飛ぶマスコット',
                n: 1,
                quality: 'high',
                size: '1024x1024',
                background: 'opaque',
                output_format: 'png'
            })
        }));
    });

    test('generateImage - 添付画像を編集できること', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ data: [{ b64_json: 'edited-image' }] })
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await OpenAiImageConnector.generateImage({
            prompt: '背景を夜にする',
            initImage: 'data:image/png;base64,aW1hZ2U='
        }, 'test-api-key');

        expect(result).toBe('edited-image');
        expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/images/edits', expect.objectContaining({
            method: 'POST',
            body: expect.any(FormData)
        }));
        const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
        const formData = request.body as FormData;
        expect(formData.get('model')).toBe('gpt-image-2');
        expect(formData.get('prompt')).toBe('背景を夜にする');
        expect(formData.get('image[]')).toBeInstanceOf(Blob);
    });

    test('generateImage - APIキーが未設定の場合にエラーを返すこと', async () => {
        await expect(OpenAiImageConnector.generateImage({ prompt: 'test' }, '')).rejects.toThrow(
            'OpenAI APIキーが設定されていません。'
        );
    });

    test('generateImage - APIエラーのメッセージを接続エラーとして返すこと', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            text: async () => JSON.stringify({ error: { message: 'invalid image' } })
        }));

        await expect(OpenAiImageConnector.generateImage({ prompt: 'test' }, 'test-api-key')).rejects.toThrow(
            'OpenAIとの接続エラー: invalid image'
        );
    });

    test('generateImage - JSON以外のAPIエラー本文を呼び出し元へ返すこと', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 502,
            text: async () => 'upstream unavailable'
        }));

        await expect(OpenAiImageConnector.generateImage({ prompt: 'test' }, 'test-api-key')).rejects.toThrow(
            'OpenAIとの接続エラー: OpenAI Images API returned status 502: upstream unavailable'
        );
    });
});

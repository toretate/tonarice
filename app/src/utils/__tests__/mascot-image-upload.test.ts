import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getImageExtension, saveMascotImageSource } from '../mascot-image-upload';

describe('saveMascotImageSource', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('window', {
            electronAPI: { isWeb: true }
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('Web版ではBlobをmultipartで送信すること', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true, path: '/mascots/test.png?v=1' })
        });

        const result = await saveMascotImageSource(
            'mascot_1',
            'outfits/test.png',
            new Blob(['image'], { type: 'image/png' })
        );

        expect(result.path).toBe('/mascots/test.png?v=1');
        const [, options] = fetchMock.mock.calls[0];
        expect(options.method).toBe('POST');
        expect(options.body).toBeInstanceOf(FormData);
        expect(options.headers).toBeUndefined();
    });

    it('multipart失敗時はJSON互換経路で再試行すること', async () => {
        class FileReaderMock {
            result: string | null = null;
            error: Error | null = null;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;

            readAsDataURL(): void {
                this.result = 'data:image/png;base64,aW1hZ2U=';
                this.onload?.();
            }
        }
        vi.stubGlobal('FileReader', FileReaderMock);
        fetchMock
            .mockResolvedValueOnce({ ok: false, status: 415 })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, path: '/mascots/fallback.png?v=2' })
            });

        const result = await saveMascotImageSource(
            'mascot_1',
            'outfits/fallback.png',
            new Blob(['image'], { type: 'image/png' })
        );

        expect(result.path).toBe('/mascots/fallback.png?v=2');
        const [, options] = fetchMock.mock.calls[1];
        expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(JSON.parse(options.body).base64Data).toBe('data:image/png;base64,aW1hZ2U=');
    });
});

describe('getImageExtension', () => {
    it('BlobのMIMEタイプから拡張子を決定すること', () => {
        expect(getImageExtension(new Blob([], { type: 'image/jpeg' }))).toBe('jpg');
        expect(getImageExtension(new Blob([], { type: 'image/webp' }))).toBe('webp');
    });
});

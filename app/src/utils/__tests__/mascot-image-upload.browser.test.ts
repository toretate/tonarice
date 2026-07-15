import { describe, expect, it } from 'vitest';
import {
    blobToDataUrl,
    canvasToImageBlob,
    dataUrlToBlob,
} from '../mascot-image-upload';

function createRedCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;

    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Canvas 2D contextを取得できません。');
    }
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
}

describe('mascot-image-upload（実ブラウザ）', () => {
    it('canvasToImageBlob_CanvasをPNG Blobへ変換できること', async () => {
        const blob = await canvasToImageBlob(createRedCanvas());

        expect(blob.type).toBe('image/png');
        expect(blob.size).toBeGreaterThan(0);

        const dataUrl = await blobToDataUrl(blob);
        expect(dataUrl).toMatch(/^data:image\/png;base64,/);

        const restoredBlob = dataUrlToBlob(dataUrl);
        expect(restoredBlob.type).toBe('image/png');
        expect(restoredBlob.size).toBe(blob.size);
    });

    it('canvasToImageBlob_PNG変換後も描画ピクセルを保持すること', async () => {
        const blob = await canvasToImageBlob(createRedCanvas());
        const bitmap = await createImageBitmap(blob);

        try {
            const output = document.createElement('canvas');
            output.width = bitmap.width;
            output.height = bitmap.height;
            const context = output.getContext('2d');
            if (!context) {
                throw new Error('Canvas 2D contextを取得できません。');
            }
            context.drawImage(bitmap, 0, 0);

            expect(Array.from(context.getImageData(0, 0, 1, 1).data)).toEqual([255, 0, 0, 255]);
        } finally {
            bitmap.close();
        }
    });
});

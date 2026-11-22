// @vitest-environment node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createCanvas, loadImage } from 'canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeBackground } from '../remove-bg-service';

interface ImglyResourceEntry {
    chunks: Array<{ hash: string; offsets: [number, number] }>;
    size: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * テスト用の小さな PNG（白背景と中央の前景矩形を含む 32x32 画像）を生成する。
 */
function createSamplePng(width: number, height: number): Buffer {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#2850c8';
    ctx.fillRect(8, 8, width - 16, height - 16);
    return canvas.toBuffer('image/png');
}

/**
 * IMG.LY の既定モデル（medium）がローカルに揃っているか検証する。
 */
function verifyLocalImglyMediumModel(): { available: boolean; reason?: string } {
    const distDir = path.resolve(process.cwd(), 'node_modules/@imgly/background-removal-node/dist');
    const resourcesPath = path.join(distDir, 'resources.json');
    if (!fs.existsSync(resourcesPath)) {
        return { available: false, reason: `ローカルモデル定義が見つかりません: ${resourcesPath}` };
    }

    const resources = JSON.parse(fs.readFileSync(resourcesPath, 'utf8')) as Record<string, ImglyResourceEntry>;
    const medium = resources['/models/medium'];
    if (!medium || medium.chunks.length === 0) {
        return { available: false, reason: 'resources.json に /models/medium の定義がありません。' };
    }

    const missingChunk = medium.chunks.find((chunk) => !fs.existsSync(path.join(distDir, chunk.hash)));
    if (missingChunk) {
        return { available: false, reason: `ローカルモデルチャンクが見つかりません: ${missingChunk.hash}` };
    }

    return { available: true };
}

describe('remove-bg-service の回帰テスト', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('removeBackground_既定のIMGLY経路でローカルモデルのみを使い透過PNGを返すこと', async () => {
        const localModel = verifyLocalImglyMediumModel();
        if (!localModel.available) {
            throw new Error(`ローカル IMG.LY モデルが不足しているためテストを実行できません: ${localModel.reason}`);
        }

        // テストから外部モデルを取得しないよう、外部 fetch を禁止する。
        const blockedFetch = vi.fn(async (input: unknown) => {
            throw new Error(`外部ネットワークアクセスは許可されていません: ${String(input)}`);
        });
        vi.stubGlobal('fetch', blockedFetch);

        const inputPng = createSamplePng(32, 32);
        const outputPng = await removeBackground(inputPng, 'image/png', 'imgly');

        expect(blockedFetch).not.toHaveBeenCalled();
        expect(outputPng.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

        const decoded = await loadImage(outputPng);
        expect(decoded.width).toBe(32);
        expect(decoded.height).toBe(32);

        const outCanvas = createCanvas(decoded.width, decoded.height);
        const outCtx = outCanvas.getContext('2d');
        outCtx.drawImage(decoded, 0, 0);
        const { data } = outCtx.getImageData(0, 0, decoded.width, decoded.height);

        let transparentPixelCount = 0;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 255) {
                transparentPixelCount += 1;
            }
        }
        expect(transparentPixelCount).toBeGreaterThan(0);
    }, 60_000);
});

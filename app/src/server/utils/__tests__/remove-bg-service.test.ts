// @vitest-environment node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeBackground } from '../remove-bg-service';

interface ImglyResourceEntry {
    chunks: Array<{ hash: string; offsets: [number, number] }>;
    size: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function createPngChunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type, 'ascii');
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/**
 * テスト用の小さな PNG（背景と中央オブジェクトを含む 32x32 RGBA）を生成する。
 */
function createSamplePng(width: number, height: number): Buffer {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const rowStart = y * (stride + 1);
        raw[rowStart] = 0; // フィルタなし
        for (let x = 0; x < width; x += 1) {
            const offset = rowStart + 1 + x * 4;
            const isForeground = x >= 8 && x < width - 8 && y >= 8 && y < height - 8;
            raw[offset] = isForeground ? 40 : 255;
            raw[offset + 1] = isForeground ? 80 : 255;
            raw[offset + 2] = isForeground ? 200 : 255;
            raw[offset + 3] = 255;
        }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // ビット深度 8
    ihdr[9] = 6; // カラータイプ 6 (RGBA)
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
        PNG_SIGNATURE,
        createPngChunk('IHDR', ihdr),
        createPngChunk('IDAT', zlib.deflateSync(raw)),
        createPngChunk('IEND', Buffer.alloc(0))
    ]);
}

/**
 * PNG の IHDR 情報・tRNS チャンク・IDAT データを読み取る。
 */
function parsePngMetadata(buffer: Buffer): {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
    trnsChunk: Buffer | null;
    idatChunks: Buffer[];
} {
    expect(buffer.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = -1;
    let trnsChunk: Buffer | null = null;
    const idatChunks: Buffer[] = [];

    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const data = buffer.subarray(dataStart, dataEnd);

        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8] ?? 0;
            colorType = data[9] ?? -1;
        } else if (type === 'tRNS') {
            trnsChunk = data;
        } else if (type === 'IDAT') {
            idatChunks.push(data);
        } else if (type === 'IEND') {
            break;
        }
        offset = dataEnd + 4;
    }

    return { width, height, bitDepth, colorType, trnsChunk, idatChunks };
}

/**
 * PNG が透過情報（アルファチャンネルまたは tRNS チャンク）と実際の透過値を持つか判定する。
 */
function hasTransparentPixel(meta: ReturnType<typeof parsePngMetadata>): boolean {
    if (meta.colorType === 3) {
        // パレット形式（sharp の quality 指定 PNG 出力）は tRNS チャンクにアルファ値を持つ。
        return meta.trnsChunk !== null && meta.trnsChunk.some((alpha) => alpha < 255);
    }
    if (meta.colorType === 4 || meta.colorType === 6) {
        const channels = meta.colorType === 6 ? 4 : 2;
        const inflated = zlib.inflateSync(Buffer.concat(meta.idatChunks));
        const rowStride = meta.width * channels + 1;
        if (inflated.length !== rowStride * meta.height) {
            return false;
        }
        for (let y = 0; y < meta.height; y += 1) {
            const rowStart = y * rowStride + 1;
            for (let x = 0; x < meta.width; x += 1) {
                if (inflated[rowStart + x * channels + (channels - 1)] < 255) {
                    return true;
                }
            }
        }
    }
    return false;
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

        const meta = parsePngMetadata(outputPng);
        expect(meta.width).toBe(32);
        expect(meta.height).toBe(32);
        expect(meta.bitDepth).toBe(8);
        expect([3, 4, 6]).toContain(meta.colorType);
        expect(meta.idatChunks.length).toBeGreaterThan(0);
        expect(hasTransparentPixel(meta)).toBe(true);
    }, 60_000);
});

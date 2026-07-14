import { beforeEach, describe, expect, it, vi } from 'vitest';
import generateNofaceHandler from '../api/mascots/generate-noface.post';
import packAtlasHandler from '../api/mascots/pack-atlas.post';
import saveNofaceHandler from '../api/mascots/save-noface.post';

const { mockReadBody, mockGenerateNofaceImage, mockNormalizeNofaceImage, mockPackTextureAtlas, mockResolveMascotPath, mockMkdirSync, mockWriteFileSync } = vi.hoisted(() => ({
    mockReadBody: vi.fn(),
    mockGenerateNofaceImage: vi.fn(),
    mockNormalizeNofaceImage: vi.fn(),
    mockPackTextureAtlas: vi.fn(),
    mockResolveMascotPath: vi.fn((requestPath: string) => `C:\\mascots${requestPath.replaceAll('/', '\\')}`),
    mockMkdirSync: vi.fn(),
    mockWriteFileSync: vi.fn()
}));

vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('h3')>();
    return { ...actual, readBody: mockReadBody };
});

vi.mock('../utils/expression-edit-service', () => ({
    generateNofaceImage: mockGenerateNofaceImage,
    normalizeNofaceImage: mockNormalizeNofaceImage,
    packTextureAtlas: mockPackTextureAtlas
}));

vi.mock('../utils/paths', () => ({
    resolveMascotPath: mockResolveMascotPath
}));

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
        ...actual,
        default: { ...actual, mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync },
        mkdirSync: mockMkdirSync,
        writeFileSync: mockWriteFileSync
    };
});

describe('衣装別noface API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('generate-noface_衣装別パスへ生成すること', async () => {
        const expectedPath = '/mascots/users/usr_local_dev_bypass/mascot_1/outfits/outfit_2/noface.png';
        mockReadBody.mockResolvedValue({ mascotId: 'mascot_1', outfitId: 'outfit_2', inputPath: '/outfit.png' });
        mockGenerateNofaceImage.mockResolvedValue(expectedPath);

        const result = await generateNofaceHandler({} as any);

        expect(mockGenerateNofaceImage).toHaveBeenCalledWith('/outfit.png', expectedPath, undefined, undefined, undefined, undefined, true);
        expect(result.path).toBe(expectedPath);
    });

    it('save-noface_衣装別パスへ保存すること', async () => {
        const expectedPath = '/mascots/users/usr_local_dev_bypass/mascot_1/outfits/outfit_2/noface.png';
        mockReadBody.mockResolvedValue({
            mascotId: 'mascot_1',
            outfitId: 'outfit_2',
            sourcePath: '/mascots/outfit.png',
            imageBase64: 'data:image/png;base64,aGVsbG8='
        });

        const result = await saveNofaceHandler({} as any);

        expect(mockResolveMascotPath).toHaveBeenCalledWith(expectedPath);
        expect(mockWriteFileSync).toHaveBeenCalledOnce();
        expect(mockNormalizeNofaceImage).toHaveBeenCalledWith('/mascots/outfit.png', expectedPath);
        expect(result.path).toBe(expectedPath);
    });

    it('generate-noface_不正な衣装IDを400で拒否すること', async () => {
        mockReadBody.mockResolvedValue({ mascotId: 'mascot_1', outfitId: '../outfit', inputPath: '/outfit.png' });

        await expect(generateNofaceHandler({} as any)).rejects.toMatchObject({ statusCode: 400 });
        expect(mockGenerateNofaceImage).not.toHaveBeenCalled();
    });

    it('pack-atlas_衣装別ディレクトリを指定すること', async () => {
        const partsList = [{ name: 'eyes_open', path: '/parts.png', offsetX: 1, offsetY: 2 }];
        mockReadBody.mockResolvedValue({ mascotId: 'mascot_1', outfitId: 'outfit_2', partsList });
        mockPackTextureAtlas.mockResolvedValue({
            success: true,
            atlasPath: '/atlas.png',
            jsonPath: '/atlas.json',
            width: 256,
            height: 256
        });

        const result = await packAtlasHandler({} as any);

        expect(mockPackTextureAtlas).toHaveBeenCalledWith('usr_local_dev_bypass', 'mascot_1', 'outfit_2', partsList);
        expect(result.atlasPath).toBe('/atlas.png');
    });
});

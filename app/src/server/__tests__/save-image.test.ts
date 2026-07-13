import { beforeEach, describe, expect, it, vi } from 'vitest';
import saveImageHandler from '../api/mascots/save-image.post';

const { mockReadBody, mockMkdirSync, mockWriteFileSync } = vi.hoisted(() => ({
    mockReadBody: vi.fn(),
    mockMkdirSync: vi.fn(),
    mockWriteFileSync: vi.fn()
}));

vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('h3')>();
    return {
        ...actual,
        readBody: mockReadBody
    };
});

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
        ...actual,
        default: {
            ...actual,
            mkdirSync: mockMkdirSync,
            writeFileSync: mockWriteFileSync
        },
        mkdirSync: mockMkdirSync,
        writeFileSync: mockWriteFileSync
    };
});

describe('/api/mascots/save-image', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const runHandler = () => saveImageHandler({
        context: {
            user: { id: 'test_user' }
        }
    } as any);

    it('正常系：正しいパラメータで呼び出された場合、画像保存に成功すること', async () => {
        mockReadBody.mockResolvedValueOnce({
            mascotId: 'mascot_ok',
            filename: 'outfits/outfit_1.png',
            base64Data: 'data:image/png;base64,iVBORw0K...'
        });

        const result = await runHandler();

        expect(result.success).toBe(true);
        expect(result.path).toBe('/mascots/users/test_user/mascot_ok/outfits/outfit_1.png');
        expect(mockWriteFileSync).toHaveBeenCalledOnce();
    });

    it('異常系：不正なmascotIdは400となり、ファイルを書き込まないこと', async () => {
        mockReadBody.mockResolvedValueOnce({
            mascotId: '../malicious',
            filename: 'outfits/outfit_1.png',
            base64Data: 'data:image/png;base64,iVBORw0K...'
        });

        await expect(runHandler()).rejects.toMatchObject({ statusCode: 400 });
        expect(mockMkdirSync).not.toHaveBeenCalled();
        expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('異常系：親ディレクトリを含むfilenameは400となり、ファイルを書き込まないこと', async () => {
        mockReadBody.mockResolvedValueOnce({
            mascotId: 'mascot_ok',
            filename: '../../outfits/outfit_1.png',
            base64Data: 'data:image/png;base64,iVBORw0K...'
        });

        await expect(runHandler()).rejects.toMatchObject({ statusCode: 400 });
        expect(mockMkdirSync).not.toHaveBeenCalled();
        expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('異常系：URLエンコードされた親ディレクトリも包含チェックで拒否すること', async () => {
        mockReadBody.mockResolvedValueOnce({
            mascotId: 'mascot_ok',
            filename: '%2e%2e/%2e%2e/%2e%2e/escaped.png',
            base64Data: 'data:image/png;base64,iVBORw0K...'
        });

        await expect(runHandler()).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'Directory traversal detected'
        });
        expect(mockMkdirSync).not.toHaveBeenCalled();
        expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
});

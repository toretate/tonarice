import { beforeEach, describe, expect, it, vi } from 'vitest';
import reloadHandler from '../reload.post';

const { mockReadBody, mockReloadModel } = vi.hoisted(() => ({
    mockReadBody: vi.fn(),
    mockReloadModel: vi.fn()
}));

vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('h3')>();
    return { ...actual, readBody: mockReadBody };
});

vi.mock('../../../utils/lmstudio-model-management', () => ({
    reloadLmStudioModel: mockReloadModel,
    LmStudioManagementError: class extends Error {}
}));

function createEvent(headers: Record<string, string>) {
    return { context: {}, node: { req: { headers } } } as any;
}

describe('LM Studio再ロードAPI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockReadBody.mockResolvedValue({
            endpoint: 'http://127.0.0.1:1234/v1/',
            modelKey: 'test-model',
            contextLength: 8192
        });
        mockReloadModel.mockResolvedValue({ modelKey: 'test-model', contextLength: 8192, unchanged: false });
    });

    it('reload_接続元IPが取得できなくてもローカル同一オリジンから受け付ける', async () => {
        const event = createEvent({
            host: 'localhost:3000',
            origin: 'http://localhost:3000',
            'content-type': 'application/json'
        });

        await expect(reloadHandler(event)).resolves.toMatchObject({ contextLength: 8192 });
        expect(mockReloadModel).toHaveBeenCalledWith('http://127.0.0.1:1234/v1/', 'test-model', 8192);
    });

    it('reload_ローカル以外のHostを拒否する', async () => {
        const event = createEvent({
            host: 'example.test:3000',
            origin: 'http://example.test:3000',
            'content-type': 'application/json'
        });

        await expect(reloadHandler(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(mockReloadModel).not.toHaveBeenCalled();
    });

    it('reload_異なるオリジンからの要求を拒否する', async () => {
        const event = createEvent({
            host: 'localhost:3000',
            origin: 'http://example.test:3000',
            'content-type': 'application/json'
        });

        await expect(reloadHandler(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(mockReloadModel).not.toHaveBeenCalled();
    });
});

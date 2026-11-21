import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLmStudioModelStatus, reloadLmStudioModel } from '../lmstudio-model-management';

const endpoint = 'http://127.0.0.1:1234/v1/';
const modelKey = 'example/model';

function modelResponse(contextLength = 4096, instances = 1, loadOptions: object = {}) {
    return new Response(JSON.stringify({
        models: [{
            key: modelKey,
            type: 'llm',
            max_context_length: 32768,
            loaded_instances: Array.from({ length: instances }, (_, index) => ({
                id: `instance-${index}`,
                config: { context_length: contextLength, ...loadOptions }
            }))
        }]
    }), { status: 200 });
}

const okResponse = () => new Response('{}', { status: 200 });

describe('LM Studioモデル管理', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('getLmStudioModelStatus_管理APIから選択モデルの現在値と最大値を取得する', async () => {
        const fetchMock = vi.fn().mockResolvedValue(modelResponse());
        vi.stubGlobal('fetch', fetchMock);

        const status = await getLmStudioModelStatus(endpoint, modelKey);

        expect(status).toEqual({
            modelKey,
            maxContextLength: 32768,
            loadedInstances: [{ id: 'instance-0', contextLength: 4096 }]
        });
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://127.0.0.1:1234/api/v1/models');
    });

    it('reloadLmStudioModel_選択モデルのインスタンスだけを解除して指定サイズでロードする', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(modelResponse())
            .mockResolvedValueOnce(okResponse())
            .mockResolvedValueOnce(okResponse());
        vi.stubGlobal('fetch', fetchMock);

        const result = await reloadLmStudioModel(endpoint, modelKey, 16384);

        expect(result).toEqual({ modelKey, contextLength: 16384, unchanged: false });
        expect(String(fetchMock.mock.calls[1][0])).toBe('http://127.0.0.1:1234/api/v1/models/unload');
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ instance_id: 'instance-0' });
        expect(String(fetchMock.mock.calls[2][0])).toBe('http://127.0.0.1:1234/api/v1/models/load');
        expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ model: modelKey, context_length: 16384 });
    });

    it('reloadLmStudioModel_指定サイズが現在値と同じ場合は解除しない', async () => {
        const fetchMock = vi.fn().mockResolvedValue(modelResponse());
        vi.stubGlobal('fetch', fetchMock);

        expect(await reloadLmStudioModel(endpoint, modelKey, 4096)).toMatchObject({ unchanged: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reloadLmStudioModel_既存の読み込み設定を保持する', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(modelResponse(4096, 1, { flash_attention: true, eval_batch_size: 512 }))
            .mockResolvedValueOnce(okResponse())
            .mockResolvedValueOnce(okResponse());
        vi.stubGlobal('fetch', fetchMock);

        await reloadLmStudioModel(endpoint, modelKey, 8192);

        expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
            model: modelKey,
            context_length: 8192,
            flash_attention: true,
            eval_batch_size: 512
        });
    });

    it('reloadLmStudioModel_最大値超過と複数インスタンスを拒否する', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => modelResponse(4096, 2));
        vi.stubGlobal('fetch', fetchMock);

        await expect(reloadLmStudioModel(endpoint, modelKey, 65536)).rejects.toThrow('最大コンテキストサイズ');
        await expect(reloadLmStudioModel(endpoint, modelKey, 8192)).rejects.toThrow('複数インスタンス');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reloadLmStudioModel_整数でない指定を管理APIへの通信前に拒否する', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(reloadLmStudioModel(endpoint, modelKey, 8192.5)).rejects.toThrow('1024以上の整数');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reloadLmStudioModel_ロード失敗時に以前のサイズへ復旧する', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(modelResponse())
            .mockResolvedValueOnce(okResponse())
            .mockResolvedValueOnce(new Response('{}', { status: 500 }))
            .mockResolvedValueOnce(okResponse());
        vi.stubGlobal('fetch', fetchMock);

        await expect(reloadLmStudioModel(endpoint, modelKey, 8192)).rejects.toThrow('管理APIがエラー');
        expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ model: modelKey, context_length: 4096 });
    });

    it('reloadLmStudioModel_復旧失敗時に手動確認を促す', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(modelResponse())
            .mockResolvedValueOnce(okResponse())
            .mockResolvedValueOnce(new Response('{}', { status: 500 }))
            .mockResolvedValueOnce(new Response('{}', { status: 500 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(reloadLmStudioModel(endpoint, modelKey, 8192)).rejects.toThrow('復旧に失敗しました');
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });
});

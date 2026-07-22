import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLmStudioModels, normalizeLmStudioEndpoint } from '../utils/lmstudio-api';

describe('LM Studio APIサーバー経路のテスト', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('normalizeLmStudioEndpoint_v1なしのURLをOpenAI互換URLへ正規化すること', () => {
        expect(normalizeLmStudioEndpoint('http://192.168.10.10:1234'))
            .toBe('http://192.168.10.10:1234/v1/');
    });

    it('normalizeLmStudioEndpoint_HTTP以外のURLを拒否すること', () => {
        expect(() => normalizeLmStudioEndpoint('file:///tmp/lmstudio'))
            .toThrow('HTTPまたはHTTPS');
    });

    it('fetchLmStudioModels_APIサーバー側からモデル一覧を取得すること', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            data: [{ id: 'local-model' }]
        }), { status: 200 }));

        await expect(fetchLmStudioModels('http://localhost:1234/v1/'))
            .resolves.toEqual([{ id: 'local-model' }]);
        expect(fetchMock).toHaveBeenCalledWith(
            new URL('http://localhost:1234/v1/models'),
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
    });
});

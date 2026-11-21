import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLmStudioFetch, normalizeLmStudioBaseUrl } from '../lmstudio-fetch';

describe('normalizeLmStudioBaseUrlのテスト', () => {
    it('normalizeLmStudioBaseUrl_末尾のv1を重複させないこと', () => {
        expect(normalizeLmStudioBaseUrl('http://127.0.0.1:1234/v1/')).toBe('http://127.0.0.1:1234/v1');
        expect(normalizeLmStudioBaseUrl('http://127.0.0.1:1234/')).toBe('http://127.0.0.1:1234/v1');
        expect(normalizeLmStudioBaseUrl('')).toBe('http://localhost:1234/v1');
    });
});

describe('createLmStudioFetchのテスト', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('createLmStudioFetch_反復ペナルティと思考無効を要求本文へ反映すること', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);

        await createLmStudioFetch(1.2, false)('http://localhost:1234/v1/chat/completions', {
            method: 'POST', body: JSON.stringify({ model: 'local-model', messages: [] })
        });

        const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body);
        expect(body).toMatchObject({
            model: 'local-model', repetition_penalty: 1.2,
            reasoning_format: 'none', include_reasoning: false
        });
    });

    it('createLmStudioFetch_設定がない場合は要求本文を保つこと', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
        const body = JSON.stringify({ model: 'local-model' });

        await createLmStudioFetch()('http://localhost:1234/v1/chat/completions', { method: 'POST', body });

        expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body)).toEqual({ model: 'local-model' });
    });
});

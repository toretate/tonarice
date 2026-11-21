import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchIrodoriLoras } from '../irodori-loras';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('fetchIrodoriLoras', () => {
    it('fetchIrodoriLoras_HTTP以外の接続先は外部通信せず拒否すること', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        expect(await fetchIrodoriLoras('file:///tmp/test')).toMatchObject({ success: false, loras: [] });
        expect(await fetchIrodoriLoras(123 as never)).toMatchObject({ success: false, loras: [] });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('fetchIrodoriLoras_失敗時もタイマーと認証情報を残さないこと', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret-api-key')));
        const result = await fetchIrodoriLoras('http://localhost:8088');
        expect(result).toMatchObject({ success: false, loras: [] });
        expect(JSON.stringify(result)).not.toContain('secret-api-key');
        expect(vi.getTimerCount()).toBe(0);
    });
    it('fetchIrodoriLoras_正常な一覧を返しタイマーを解除すること', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: ['sample'] }) }));
        expect(await fetchIrodoriLoras('http://localhost:8088/')).toEqual({ success: true, loras: ['sample'] });
        expect(vi.getTimerCount()).toBe(0);
    });
});

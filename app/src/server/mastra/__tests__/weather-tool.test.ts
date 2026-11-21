import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCurrentWeather } from '../../../skills/tool-use/weather-core';
import { createMascotRequestContext } from '../request-context';
import { mastraWeatherTool } from '../weather-tool';

const weatherResponse = {
    current: {
        temperature_2m: 22.5,
        relative_humidity_2m: 65,
        weather_code: 3,
        wind_speed_10m: 12
    }
};

function createContext(weatherEnabled: boolean) {
    return createMascotRequestContext({
        resolvedModel: {},
        engine: 'gemini',
        modelId: 'test-model',
        weatherEnabled
    });
}

async function executeWeather(input: { city?: string }, weatherEnabled: boolean, context = createContext(weatherEnabled)) {
    if (!mastraWeatherTool.execute) throw new Error('天気ツールの実行関数がありません。');
    return mastraWeatherTool.execute(input, { requestContext: context } as never);
}

describe('fetchCurrentWeatherのテスト', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('fetchCurrentWeather_都市から座標を解決して現在の天気を取得すること', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => weatherResponse });
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCurrentWeather({ city: '大阪' });

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0]?.[0]).toContain('latitude=34.6937');
        expect(result).toEqual({
            city: '大阪', temperature: '22.5°C', humidity: '65%', weather: '曇り', windSpeed: '12 km/h'
        });
    });

    it('fetchCurrentWeather_未知の都市を東京の天気として返さないこと', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCurrentWeather({ city: '未対応の都市' });

        expect(result).toContain('都市名が見つかりません');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls.every(([url]) => String(url).includes('geocoding-api.open-meteo.com'))).toBe(true);
    });

    it('fetchCurrentWeather_徳島を徳島市として検索して天気を取得すること', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    results: [{ name: '徳島市', latitude: 34.06667, longitude: 134.56667, country_code: 'JP', feature_code: 'PPLA' }]
                })
            })
            .mockResolvedValueOnce({ ok: true, json: async () => weatherResponse });
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCurrentWeather({ city: '徳島' });

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(new URL(fetchMock.mock.calls[1]?.[0]).searchParams.get('name')).toBe('徳島市');
        expect(fetchMock.mock.calls[2]?.[0]).toContain('latitude=34.06667&longitude=134.56667');
        expect(result).toMatchObject({ city: '徳島', weather: '曇り' });
    });

    it('fetchCurrentWeather_地名検索が失敗した場合は天気APIを呼ばないこと', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false });
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCurrentWeather({ city: '徳島' });

        expect(result).toBe('都市名の検索に失敗しました。');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('fetchCurrentWeather_地名検索が返した国外の座標は利用しないこと', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ results: [{ name: '徳島市', latitude: 34.06667, longitude: 134.56667, country_code: 'US', feature_code: 'PPLA' }] })
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCurrentWeather({ city: '徳島' });

        expect(result).toContain('都市名が見つかりません');
        expect(fetchMock.mock.calls.every(([url]) => String(url).includes('geocoding-api.open-meteo.com'))).toBe(true);
    });

    it('fetchCurrentWeather_外部APIの失敗を機密情報なしの文面へ変換すること', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error('secret-response-body'));
        vi.stubGlobal('fetch', fetchMock);
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await fetchCurrentWeather({ city: '東京' });

        expect(result).toBe('天気予報の取得処理でエラーが発生しました。');
        expect(JSON.stringify(warning.mock.calls)).not.toContain('secret-response-body');
    });
});

describe('mastraWeatherToolのテスト', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('execute_設定が無効な場合は外部APIを呼ばないこと', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const result = await executeWeather({ city: '東京' }, false);

        expect(result).toEqual({ error: '天気ツールは無効です。' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('execute_同じ発話で外部APIを一度だけ呼ぶこと', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => weatherResponse });
        vi.stubGlobal('fetch', fetchMock);
        const context = createContext(true);

        const [first, second] = await Promise.all([
            executeWeather({ city: '東京' }, true, context),
            executeWeather({ city: '大阪' }, true, context)
        ]);

        expect(first).toMatchObject({ city: '東京', weather: '曇り' });
        expect(second).toEqual({ error: 'この発話では天気情報を取得済みです。' });
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});

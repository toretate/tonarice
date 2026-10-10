interface Coordinates {
    latitude: number;
    longitude: number;
}

interface GeocodingResult extends Coordinates {
    name?: string;
    country_code?: string;
    feature_code?: string;
}

interface GeocodingResponse {
    results?: GeocodingResult[];
}

/**
 * 日本語の地名は「徳島」では検索できず「徳島市」で見つかる場合があるため、自治体の接尾辞も試す。
 */
function getSearchNames(city: string): string[] {
    if (!/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(city)
        || /[市町村都道府県]$/.test(city)) {
        return [city];
    }
    return [city, `${city}市`, `${city}町`, `${city}村`];
}

/**
 * Open-Meteoの地名検索から、日本国内の有人地点だけを選ぶ。
 */
export async function resolveJapaneseCity(city: string, signal: AbortSignal, abortSignal?: AbortSignal): Promise<Coordinates | string> {
    console.info('[WeatherService] Open-Meteoの地名検索を開始');
    try {
        for (const name of getSearchNames(city)) {
            const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
            url.searchParams.set('name', name);
            url.searchParams.set('count', '10');
            url.searchParams.set('language', 'ja');
            url.searchParams.set('countryCode', 'JP');

            const response = await fetch(url.toString(), { signal });
            if (!response.ok) {
                console.warn('[WeatherService] Open-Meteoの地名検索からエラー応答');
                return '都市名の検索に失敗しました。';
            }

            const data = await response.json() as GeocodingResponse;
            const results = Array.isArray(data?.results) ? data.results : [];
            const locations = results.filter(result => result && typeof result === 'object'
                && result.country_code === 'JP'
                && typeof result.feature_code === 'string' && result.feature_code.startsWith('PPL')
                && typeof result.name === 'string'
                && Number.isFinite(result.latitude) && result.latitude >= -90 && result.latitude <= 90
                && Number.isFinite(result.longitude) && result.longitude >= -180 && result.longitude <= 180);
            const location = locations.find(result => result.name === name)
                ?? (/^[\x00-\x7F]+$/.test(name) ? locations[0] : undefined);
            if (location) {
                console.info('[WeatherService] Open-Meteoの地名検索が完了');
                return { latitude: location.latitude, longitude: location.longitude };
            }
        }
        console.warn('[WeatherService] Open-Meteoの地名検索で該当地点なし');
        return '都市名が見つかりませんでした。緯度・経度を指定してください。';
    } catch (error) {
        if (abortSignal?.aborted) throw error;
        console.warn('[WeatherService] Open-Meteoの地名検索との接続エラー');
        return '都市名の検索に失敗しました。';
    }
}

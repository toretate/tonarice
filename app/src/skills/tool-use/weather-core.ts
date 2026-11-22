import { lmStudioZod as z } from '../../utils/lmstudio-tool-schema';
import { resolveJapaneseCity } from './weather-geocoding';

export const weatherDescription = '指定された緯度・経度、または都市の現在の天気予報を取得します。緯度経度がわからない場合は都市名(city)のみを指定してください。';

export const weatherParameters = {
    latitude: z.number().min(-90).max(90).optional().describe('緯度（例: 35.6895）'),
    longitude: z.number().min(-180).max(180).optional().describe('経度（例: 139.6917）'),
    city: z.string().trim().min(1).max(100).optional().describe('都市名（例: 大阪、東京）')
};

export const weatherInputSchema = z.object(weatherParameters);
export type WeatherInput = z.infer<typeof weatherInputSchema>;

export interface WeatherData {
    city: string;
    temperature: string;
    humidity: string;
    weather: string;
    windSpeed: string;
}

// 既存ツールで対応している主要都市の代表地点を共通化する。
const CITY_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
    '東京': { latitude: 35.6895, longitude: 139.6917 },
    '大阪': { latitude: 34.6937, longitude: 135.5023 },
    '京都': { latitude: 35.0116, longitude: 135.7681 },
    '名古屋': { latitude: 35.1815, longitude: 136.9066 },
    '福岡': { latitude: 33.5904, longitude: 130.4017 },
    '札幌': { latitude: 43.0621, longitude: 141.3544 },
    '仙台': { latitude: 38.2682, longitude: 140.8694 },
    '広島': { latitude: 34.3853, longitude: 132.4553 },
    '那覇': { latitude: 26.2124, longitude: 127.6809 },
    '沖縄': { latitude: 26.2124, longitude: 127.6809 }
};

const WEATHER_CODES: Record<number, string> = {
    0: '晴れ', 1: '主に晴れ', 2: '一部曇り', 3: '曇り',
    45: '霧', 48: '霧氷',
    51: '軽度の小雨', 53: '小雨', 55: '重度の小雨',
    61: '小雨', 63: '雨', 65: '大雨',
    71: '小雪', 73: '雪', 75: '大雪',
    77: '細氷',
    80: 'にわか雨', 81: '激しいにわか雨', 82: '猛烈なにわか雨',
    85: '軽い雪', 86: '大雪',
    95: '雷雨', 96: '激しい雷雨'
};

/**
 * 天気APIへの通信を一箇所にまとめ、LM StudioとMastraの両方から利用する。
 */
export async function fetchCurrentWeather(input: WeatherInput, abortSignal?: AbortSignal): Promise<WeatherData | string> {
    let { latitude, longitude } = input;
    const city = input.city?.trim();
    const signal = abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);

    if (city && (latitude === undefined || longitude === undefined)) {
        const cleanCity = city.replace(/(市|都|府|県)$/, '').trim();
        const coordinates = CITY_COORDINATES[cleanCity] || CITY_COORDINATES[city]
            || await resolveJapaneseCity(city, signal, abortSignal);
        if (typeof coordinates === 'string') return coordinates;
        latitude = coordinates.latitude;
        longitude = coordinates.longitude;
    }

    if (latitude === undefined || longitude === undefined) {
        return '都市名または緯度・経度の両方を指定してください。';
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
        || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return '緯度・経度の値が範囲外です。';
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Asia%2FTokyo`;
    console.info('[WeatherService] Open-Meteoとの通信を開始');
    try {
        const response = await fetch(url, { signal });
        if (!response.ok) {
            console.warn('[WeatherService] Open-Meteoからエラー応答');
            return '天気情報の取得に失敗しました。';
        }
        const data = await response.json() as { current?: Record<string, number> };
        const current = data.current;
        if (!current || !Number.isFinite(current.temperature_2m)
            || !Number.isFinite(current.relative_humidity_2m)
            || !Number.isFinite(current.weather_code)
            || !Number.isFinite(current.wind_speed_10m)) {
            console.warn('[WeatherService] Open-Meteoの応答形式が不正');
            return '天気情報の取得に失敗しました。';
        }
        console.info('[WeatherService] Open-Meteoとの通信が完了');
        return {
            city: city || '指定地点',
            temperature: `${current.temperature_2m}°C`,
            humidity: `${current.relative_humidity_2m}%`,
            weather: WEATHER_CODES[current.weather_code] || '不明',
            windSpeed: `${current.wind_speed_10m} km/h`
        };
    } catch (error) {
        if (abortSignal?.aborted) throw error;
        console.warn('[WeatherService] Open-Meteoとの接続エラー');
        return '天気予報の取得処理でエラーが発生しました。';
    }
}

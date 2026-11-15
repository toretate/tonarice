import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * IPアドレス由来の概算位置だけを返す。取得失敗時に別の都市を現在地として返さない。
 */
export const mastraLocationTool = createTool({
    id: 'getGPSLocation',
    description: 'IPアドレスに基づくユーザーの大まかな位置情報（都市名、緯度・経度）を取得します。GPSの精密位置ではありません。',
    inputSchema: z.object({}),
    execute: async (_input, { requestContext, abortSignal }) => {
        if (requestContext.get('locationEnabled') !== true) {
            return { error: '位置情報ツールは無効です。' };
        }
        if (requestContext.get('locationUsed') === true) {
            return { error: 'この発話では位置情報を取得済みです。' };
        }
        requestContext.set('locationUsed', true);
        console.info('[MastraTool] getGPSLocationの実行を開始');
        try {
            const response = await fetch('http://ip-api.com/json/?lang=ja', { signal: abortSignal });
            if (!response.ok) {
                console.warn('[MastraTool] getGPSLocationの通信に失敗');
                return { error: '位置情報の取得に失敗しました。' };
            }
            const data = await response.json() as Record<string, unknown>;
            if (data.status === 'fail' || typeof data.city !== 'string'
                || typeof data.lat !== 'number' || typeof data.lon !== 'number') {
                console.warn('[MastraTool] getGPSLocationの応答が不正');
                return { error: '位置情報を特定できませんでした。' };
            }
            console.info('[MastraTool] getGPSLocationの実行が完了');
            return {
                city: data.city,
                latitude: data.lat,
                longitude: data.lon,
                country: typeof data.country === 'string' ? data.country : '',
                accuracy: 'IPアドレスに基づく概算位置'
            };
        } catch {
            console.warn('[MastraTool] getGPSLocationとの接続エラー');
            return { error: '位置情報の取得に失敗しました。' };
        }
    }
});

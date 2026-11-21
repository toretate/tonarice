import { createTool } from '@mastra/core/tools';
import { fetchCurrentWeather, weatherDescription, weatherInputSchema } from '../../skills/tool-use/weather-core';
import { observeTool } from './tool-observation';

/**
 * 共通の天気取得処理をMastra Agentへ公開する読み取り専用アダプター。
 */
export const mastraWeatherTool = createTool({
    id: 'getWeather',
    description: weatherDescription,
    inputSchema: weatherInputSchema,
    execute: async (input, { requestContext, abortSignal }) => {
        if (requestContext.get('weatherEnabled') !== true) {
            return { error: '天気ツールは無効です。' };
        }
        if (requestContext.get('weatherUsed') === true) {
            return { error: 'この発話では天気情報を取得済みです。' };
        }

        // 並行したツール呼び出しでも外部APIを重複実行しない。
        requestContext.set('weatherUsed', true);
        console.info('[MastraTool] getWeatherの実行を開始');
        const result = await observeTool(requestContext, 'getWeather', () => fetchCurrentWeather(input, abortSignal), result => typeof result === 'string', input);
        if (typeof result === 'string') {
            console.warn('[MastraTool] getWeatherの実行に失敗');
            return { error: result };
        }
        console.info('[MastraTool] getWeatherの実行が完了');
        return result;
    }
});

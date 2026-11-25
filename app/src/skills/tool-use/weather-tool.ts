import { tool } from '@lmstudio/sdk';
import { lmStudioZod as z } from '../../utils/lmstudio-tool-schema';
import { fetchCurrentWeather, weatherDescription } from './weather-core';

/**
 * 既存LM Studio経路向けの天気ツールアダプター。
 */
export const weatherTool = tool({
    name: 'getWeather',
    description: weatherDescription,
    parameters: {
        latitude: z.number().min(-90).max(90).optional().describe('緯度（例: 35.6895）'),
        longitude: z.number().min(-180).max(180).optional().describe('経度（例: 139.6917）'),
        city: z.string().trim().min(1).max(100).optional().describe('都市名（例: 大阪、東京）')
    },
    implementation: async (input, context) => {
        const result = await fetchCurrentWeather(input, context?.signal);
        return typeof result === 'string' ? result : JSON.stringify(result);
    }
});

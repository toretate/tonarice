import { tool } from '@lmstudio/sdk';
import { fetchCurrentWeather, weatherDescription, weatherParameters } from './weather-core';

/**
 * 既存LM Studio経路向けの天気ツールアダプター。
 */
export const weatherTool = tool({
    name: 'getWeather',
    description: weatherDescription,
    parameters: weatherParameters,
    implementation: async (input, context) => {
        const result = await fetchCurrentWeather(input, context?.signal);
        return typeof result === 'string' ? result : JSON.stringify(result);
    }
});

import { Agent } from '@mastra/core/agent';
import type { MascotAgentRequestContextValues } from './request-context';
import { mastraWeatherTool } from './weather-tool';

export const MASCOT_AGENT_ID = 'mascot-agent';

/**
 * マスコット用Agentを生成する。
 * モデルはリクエストごとに解決し、認証情報を持つモデルを共有しない。
 */
export function createMascotAgent(): Agent<
    typeof MASCOT_AGENT_ID,
    Record<string, typeof mastraWeatherTool>,
    undefined,
    MascotAgentRequestContextValues
> {
    return new Agent({
        id: MASCOT_AGENT_ID,
        name: 'Tonarice Mascot Agent',
        instructions: 'あなたはデスクトップマスコットとしてユーザーと対話します。',
        model: ({ requestContext }) => {
            const resolvedModel = requestContext.get('resolvedModel');
            if (!resolvedModel) {
                throw new Error('Mastra Agentにモデルが設定されていません。');
            }

            // AI SDK v6モデルとMastra内部の複数世代モデル型の境界をここへ限定する。
            return resolvedModel as never;
        },
        tools: ({ requestContext }): Record<string, typeof mastraWeatherTool> => {
            if (requestContext.get('weatherEnabled')) {
                return { getWeather: mastraWeatherTool };
            }
            return {};
        }
    });
}

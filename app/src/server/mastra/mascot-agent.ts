import { Agent } from '@mastra/core/agent';
import type { MascotAgentRequestContextValues } from './request-context';
import { mastraWeatherTool } from './weather-tool';
import { mastraWebSearchTool } from './web-search-tool';
import { mastraLocationTool } from './location-tool';
import { mastraTasksTool, mastraMemosTool } from './data-tools';
import { mastraVolumeTool, mastraAppLauncherTool } from './desktop-tools';
import { mastraKeywordSearchTool } from './chat-keyword-tool';

type MascotTool = typeof mastraWeatherTool | typeof mastraWebSearchTool
    | typeof mastraLocationTool | typeof mastraTasksTool | typeof mastraMemosTool
    | typeof mastraVolumeTool | typeof mastraAppLauncherTool | typeof mastraKeywordSearchTool;

export const MASCOT_AGENT_ID = 'mascot-agent';

/**
 * マスコット用Agentを生成する。
 * モデルはリクエストごとに解決し、認証情報を持つモデルを共有しない。
 */
export function createMascotAgent(): Agent<
    typeof MASCOT_AGENT_ID,
    Record<string, MascotTool>,
    undefined,
    MascotAgentRequestContextValues
> {
    return new Agent({
        id: MASCOT_AGENT_ID,
        name: 'tonarice Mascot Agent',
        instructions: 'あなたはデスクトップマスコットとしてユーザーと対話します。',
        model: ({ requestContext }) => {
            const resolvedModel = requestContext.get('resolvedModel');
            if (!resolvedModel) {
                throw new Error('Mastra Agentにモデルが設定されていません。');
            }

            // AI SDK v6モデルとMastra内部の複数世代モデル型の境界をここへ限定する。
            return resolvedModel as never;
        },
        tools: ({ requestContext }): Record<string, MascotTool> => {
            const tools: Record<string, MascotTool> = {};
            if (requestContext.get('weatherEnabled')) {
                tools.getWeather = mastraWeatherTool;
            }
            if (requestContext.get('webSearchEnabled')) {
                tools.searchWeb = mastraWebSearchTool;
            }
            if (requestContext.get('locationEnabled')) {
                tools.getGPSLocation = mastraLocationTool;
            }
            if (requestContext.get('dataToolsEnabled')) {
                tools.manageTasks = mastraTasksTool;
                tools.manageMemos = mastraMemosTool;
            }
            if (requestContext.get('keywordSearchScope')) {
                tools.searchPastRecords = mastraKeywordSearchTool;
            }
            if (requestContext.get('volumeEnabled')) {
                tools.adjustVolume = mastraVolumeTool;
            }
            if (requestContext.get('appLauncherEnabled')) {
                tools.launchApp = mastraAppLauncherTool;
            }
            return tools;
        }
    });
}

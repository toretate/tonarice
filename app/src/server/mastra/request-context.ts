import { RequestContext } from '@mastra/core/request-context';
import type { ToolStatusCallback } from './tool-observation';

export interface MascotAgentRequestContextValues {
    resolvedModel: unknown;
    engine: string;
    modelId: string;
    weatherEnabled: boolean;
    weatherUsed: boolean;
    webSearchEnabled: boolean;
    webSearchUsed: boolean;
    locationEnabled: boolean;
    locationUsed: boolean;
    volumeEnabled: boolean;
    volumeUsed: boolean;
    appLauncherEnabled: boolean;
    appLauncherUsed: boolean;
    dataToolsEnabled: boolean;
    onToolStatus?: ToolStatusCallback;
    authorizeSideEffect?: (name: string, input: Record<string, unknown>) => Promise<string | null>;
    executeDataTool?: (name: 'manageTasks' | 'manageMemos', input: Record<string, unknown>) => Promise<string>;
    onDataToolResult?: (name: 'manageTasks' | 'manageMemos', input: Record<string, unknown>, output: string) => void;
}

export interface CreateMascotRequestContextParams {
    resolvedModel: unknown;
    engine: string;
    modelId: string;
    weatherEnabled?: boolean;
    webSearchEnabled?: boolean;
    locationEnabled?: boolean;
    volumeEnabled?: boolean;
    appLauncherEnabled?: boolean;
    executeDataTool?: MascotAgentRequestContextValues['executeDataTool'];
    onDataToolResult?: MascotAgentRequestContextValues['onDataToolResult'];
    onToolStatus?: ToolStatusCallback;
    authorizeSideEffect?: MascotAgentRequestContextValues['authorizeSideEffect'];
}

/**
 * Agent実行用のRequest Contextを生成する。
 * APIキーはモデル内部に閉じ込め、Contextへ直接格納しない。
 */
export function createMascotRequestContext(
    params: CreateMascotRequestContextParams
): RequestContext<MascotAgentRequestContextValues> {
    return new RequestContext<MascotAgentRequestContextValues>([
        ['resolvedModel', params.resolvedModel],
        ['engine', params.engine],
        ['modelId', params.modelId],
        ['weatherEnabled', params.weatherEnabled === true],
        ['weatherUsed', false],
        ['webSearchEnabled', params.webSearchEnabled === true],
        ['webSearchUsed', false],
        ['locationEnabled', params.locationEnabled === true],
        ['locationUsed', false],
        ['volumeEnabled', params.volumeEnabled === true],
        ['volumeUsed', false],
        ['appLauncherEnabled', params.appLauncherEnabled === true],
        ['appLauncherUsed', false],
        ['dataToolsEnabled', typeof params.executeDataTool === 'function'],
        ['onToolStatus', params.onToolStatus],
        ['authorizeSideEffect', params.authorizeSideEffect],
        ['executeDataTool', params.executeDataTool],
        ['onDataToolResult', params.onDataToolResult]
    ]);
}

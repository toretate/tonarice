import { isMastraChatEnabled } from './feature-flag';
import { MASCOT_AGENT_ID } from './mascot-agent';
import { createMascotRequestContext } from './request-context';
import { getMastraRuntime } from './runtime';
import { buildMastraChatInstructions, buildMastraChatMessages } from './chat-input';
import type { MastraChatAttachment, MastraChatHistoryItem } from './chat-input';
import type { ToolStatusCallback } from './tool-observation';

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
    }
    return value;
}

export interface MastraChatRequest {
    message: string;
    systemPrompt: string;
    resolvedModel: unknown;
    engine: string;
    modelId: string;
    temperature?: number;
    frequencyPenalty?: number;
    maxOutputTokens?: number;
    history?: readonly MastraChatHistoryItem[];
    attachments?: readonly MastraChatAttachment[];
    weatherEnabled?: boolean;
    webSearchEnabled?: boolean;
    locationEnabled?: boolean;
    volumeEnabled?: boolean;
    appLauncherEnabled?: boolean;
    enableThinking?: boolean;
    executeDataTool?: (name: 'manageTasks' | 'manageMemos', input: Record<string, unknown>) => Promise<string>;
    onDataToolResult?: (name: 'manageTasks' | 'manageMemos', input: Record<string, unknown>, output: string) => void;
    onToolStatus?: ToolStatusCallback;
    authorizeSideEffect?: (name: string, input: Record<string, unknown>) => Promise<string | null>;
    abortSignal?: AbortSignal;
}

/**
 * 既存ChatAiServiceと並行して導入するMastraチャット境界。
 */
export class MastraChatService {
    public static async generateResponse(params: MastraChatRequest): Promise<string> {
        if (!isMastraChatEnabled()) {
            throw new Error('Mastraチャット経路は無効です。');
        }

        const executedMutations = new Set<string>();
        const executeDataTool = params.executeDataTool && (async (
            name: 'manageTasks' | 'manageMemos', input: Record<string, unknown>
        ): Promise<string> => {
            if (input.action !== 'search') {
                const key = JSON.stringify([name, stableValue(input)]);
                if (executedMutations.has(key)) {
                    return JSON.stringify({ success: false, error: 'この発話では同じ変更を既に試行したため再実行できません。操作結果を確認してください。' });
                }
                executedMutations.add(key);
            }
            return params.executeDataTool!(name, input);
        });
        const requestContext = createMascotRequestContext({
            resolvedModel: params.resolvedModel,
            engine: params.engine,
            modelId: params.modelId,
            weatherEnabled: params.weatherEnabled,
            webSearchEnabled: params.webSearchEnabled,
            locationEnabled: params.locationEnabled,
            volumeEnabled: params.volumeEnabled,
            appLauncherEnabled: params.appLauncherEnabled,
            executeDataTool,
            onDataToolResult: params.onDataToolResult,
            onToolStatus: params.onToolStatus,
            authorizeSideEffect: params.authorizeSideEffect
        });
        const agent = getMastraRuntime().getAgentById(MASCOT_AGENT_ID);
        const modelSettings = {
            temperature: params.temperature ?? 0.7,
            frequencyPenalty: params.frequencyPenalty ?? 0,
            maxOutputTokens: params.maxOutputTokens ?? 2048
        };
        const timeoutSignal = AbortSignal.timeout(60000);
        const abortSignal = params.abortSignal
            ? AbortSignal.any([params.abortSignal, timeoutSignal])
            : timeoutSignal;
        const startedAt = Date.now();
        console.info(`[MastraChatService] ${params.engine}との通信を開始`);
        try {
            const response = await agent.generate(buildMastraChatMessages(
                params.message,
                params.history,
                params.attachments,
                { isLmStudio: params.engine === 'lmstudio', enableThinking: params.enableThinking }
            ), {
                requestContext,
                instructions: buildMastraChatInstructions(params.systemPrompt, {
                    weatherEnabled: params.weatherEnabled,
                    webSearchEnabled: params.webSearchEnabled,
                    locationEnabled: params.locationEnabled,
                    volumeEnabled: params.volumeEnabled,
                    appLauncherEnabled: params.appLauncherEnabled,
                    dataToolsEnabled: !!executeDataTool
                }),
                modelSettings,
                maxSteps: params.weatherEnabled || params.webSearchEnabled || params.locationEnabled
                    || params.volumeEnabled || params.appLauncherEnabled || executeDataTool ? 6 : undefined,
                abortSignal
            });
            console.info(`[MastraChatService] ${params.engine}との通信が完了 (${Date.now() - startedAt} ms)`);

            return response.text?.trim()
                || 'ごめんね、うまく応答を作れなかったみたい…。もう一度話しかけてくれる？';
        } catch (error) {
            console.warn(`[MastraChatService] ${params.engine}との接続エラー`);
            throw error;
        }
    }
}

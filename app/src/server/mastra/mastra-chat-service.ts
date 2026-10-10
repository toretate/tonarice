import { isMastraChatEnabled } from './feature-flag';
import { MASCOT_AGENT_ID } from './mascot-agent';
import { createMascotRequestContext } from './request-context';
import { getMastraRuntime } from './runtime';
import { buildMastraChatInstructions, buildMastraChatMessages } from './chat-input';
import type { MastraChatAttachment, MastraChatHistoryItem } from './chat-input';

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

        const requestContext = createMascotRequestContext({
            resolvedModel: params.resolvedModel,
            engine: params.engine,
            modelId: params.modelId
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
                params.attachments
            ), {
                requestContext,
                instructions: buildMastraChatInstructions(params.systemPrompt),
                modelSettings,
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

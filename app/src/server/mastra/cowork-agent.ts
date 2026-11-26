import { Agent } from '@mastra/core/agent';
import { resolveMastraChatModel } from './model-resolver';
import { executionTimeout } from '../cowork/schedule';

export const COWORK_AGENT_ID = 'cowork-agent';

export class CoWorkAgentConfigError extends Error {
    constructor() {
        super('CoWork AI の設定がありません。');
        this.name = 'CoWorkAgentConfigError';
    }
}

/**
 * CoWork 定期実行専用Agentを生成する。各回のモデルを環境設定から解決し、会話用ツールは公開しない。
 */
export function createCoWorkAgent(shutdownSignal: AbortSignal) {
    return new Agent({
        id: COWORK_AGENT_ID,
        name: 'Tonarice CoWork Agent',
        instructions: () => {
            const now = new Date().toLocaleString('ja-JP', {
                year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit'
            });
            return [
                'あなたはデスクトップマスコットの CoWork アシスタントです。',
                '定期実行された依頼に対し、実行結果が後から読んでも分かる形で簡潔に報告してください。',
                `[現在のシステム日時]\n${now}`
            ].join('\n');
        },
        model: () => {
            const engine = process.env.COWORK_AI_ENGINE?.trim();
            const model = process.env.COWORK_AI_MODEL?.trim();
            const apiKey = process.env.COWORK_AI_API_KEY?.trim() || '';
            const lmstudioEndpoint = process.env.COWORK_LMSTUDIO_ENDPOINT?.trim() || 'http://127.0.0.1:1234/v1';
            if (!model || (engine !== 'gemini' && engine !== 'openai' && engine !== 'lmstudio')
                || (engine !== 'lmstudio' && !apiKey)) {
                throw new CoWorkAgentConfigError();
            }

            try {
                return resolveMastraChatModel({ engine, model, apiKey, lmstudioEndpoint }).resolvedModel as never;
            } catch {
                throw new CoWorkAgentConfigError();
            }
        },
        defaultOptions: {
            abortSignal: shutdownSignal,
            modelSettings: {
                timeout: { totalMs: executionTimeout, stepMs: executionTimeout },
                maxRetries: 0
            }
        },
        maxRetries: 0
    });
}

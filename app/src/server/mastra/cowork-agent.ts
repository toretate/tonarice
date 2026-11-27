import { Agent, type AgentExecutionOptionsBase } from '@mastra/core/agent';
import { resolveCoWorkAiSettings } from '../cowork/ai-settings';
import type { CoWorkRepository } from '../cowork/repository';
import { resolveMastraChatModel } from './model-resolver';
import { executionTimeout } from '../cowork/schedule';

export const COWORK_AGENT_ID = 'cowork-agent';
const runOption = 'tonariceCowork';

export class CoWorkAgentConfigError extends Error {
    constructor() {
        super('CoWork AI の設定がありません。');
        this.name = 'CoWorkAgentConfigError';
    }
}

export function prepareCoWorkAgentInput(prompt: string, runId: string) {
    return { prompt, providerOptions: { [runOption]: { runId } } };
}

function resolveCoWorkModel(owner: string) {
    try {
        const { engine, model, apiKey, lmstudioEndpoint } = resolveCoWorkAiSettings(owner);
        if (engine && model && (engine === 'lmstudio' || apiKey)) {
            return resolveMastraChatModel({ engine, model, apiKey, lmstudioEndpoint }).resolvedModel as never;
        }
    } catch {
        // モデルの初期化エラーに資格情報が含まれないよう、固定のエラーに置き換える。
    }
    throw new CoWorkAgentConfigError();
}

function getCoWorkAgentConfig(shutdownSignal: AbortSignal) {
    return {
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
            throw new CoWorkAgentConfigError();
        },
        defaultOptions: {
            abortSignal: shutdownSignal,
            modelSettings: {
                timeout: { totalMs: executionTimeout, stepMs: executionTimeout },
                maxRetries: 0
            }
        },
        maxRetries: 0
    };
}

class CoWorkAgent extends Agent {
    constructor(shutdownSignal: AbortSignal, private readonly repository: Pick<CoWorkRepository, 'activeRunLease'>) {
        super(getCoWorkAgentConfig(shutdownSignal));
    }

    // Mastra のスケジュール worker は providerOptions を渡す。実行 ID を照合してから、
    // この呼び出し専用のモデルを選び、内部用の値を providerOptions から取り除く。
    override generate = (async (messages: Parameters<Agent['generate']>[0], options: AgentExecutionOptionsBase<unknown> = {}) => {
        const { [runOption]: dispatch, ...providerOptions } = options.providerOptions ?? {};
        const activeRun = this.repository.activeRunLease();
        if (!dispatch || typeof dispatch !== 'object' || !('runId' in dispatch)
            || !activeRun || dispatch.runId !== activeRun.id || Date.parse(activeRun.lease_until) <= Date.now()) {
            throw new Error('CoWork の実行を確認できませんでした。');
        }

        return super.generate(messages, {
            ...options,
            providerOptions,
            model: () => resolveCoWorkModel(activeRun.owner)
        });
    }) as Agent['generate'];
}

/** CoWork 定期実行専用 Agent を生成する。 */
export function createCoWorkAgent(shutdownSignal: AbortSignal, repository: Pick<CoWorkRepository, 'activeRunLease'>) {
    return new CoWorkAgent(shutdownSignal, repository);
}

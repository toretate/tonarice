import { ChatAiService } from '../utils/chat-ai-service';
import { getDB } from '../utils/db';
import type { ScheduledPromptTask } from '../../types/scheduled-prompt-task';
import { CoWorkRepository } from './repository';
import { executionTimeout } from './schedule';

let repository: CoWorkRepository | undefined;
export function getCoWorkRepository() {
    return repository ??= new CoWorkRepository(getDB());
}

export class CoWorkConfigError extends Error {}

export async function executeCoWorkTask(task: ScheduledPromptTask, signal: AbortSignal) {
    const engine = process.env.COWORK_AI_ENGINE?.trim();
    const model = process.env.COWORK_AI_MODEL?.trim();
    const apiKey = process.env.COWORK_AI_API_KEY?.trim() || '';
    const lmstudioEndpoint = process.env.COWORK_LMSTUDIO_ENDPOINT?.trim() || 'http://127.0.0.1:1234/v1';
    if (!model || (engine !== 'gemini' && engine !== 'openai' && engine !== 'lmstudio')
        || (engine !== 'lmstudio' && !apiKey)) {
        throw new CoWorkConfigError();
    }

    return ChatAiService.generateResponse({
        message: task.prompt,
        engine,
        model,
        apiKey,
        lmstudioEndpoint,
        toolUseEnabled: false,
        systemPrompt: [
            'あなたはデスクトップマスコットの CoWork アシスタントです。',
            '定期実行された依頼に対し、実行結果が後から読んでも分かる形で簡潔に報告してください。'
        ].join('\n'),
        signal,
        logContent: false,
        maxRetries: 0
    });
}

export async function runCoWorkOnce(
    repo: CoWorkRepository,
    stopping: AbortSignal,
    execute: (task: ScheduledPromptTask, signal: AbortSignal) => Promise<string> = executeCoWorkTask
) {
    if (stopping.aborted) return;
    const claimed = repo.claim();
    if (!claimed) return;
    const { owner, task, run } = claimed;
    const deadline = new AbortController();
    const timeout = setTimeout(() => deadline.abort(), executionTimeout);
    const signal = AbortSignal.any([deadline.signal, stopping]);

    // 実行側がキャンセルに応答しない場合も、履歴を期限内に確定する。
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
    });
    let outcome: Parameters<CoWorkRepository['complete']>[2];
    try {
        signal.throwIfAborted();
        console.info('[CoWork] AI 実行開始', { runId: run.id, trigger: run.trigger });
        const resultText = await Promise.race([Promise.resolve().then(() => execute(task, signal)), cancelled]);
        console.info('[CoWork] AI 実行完了', { runId: run.id });
        outcome = { status: 'success', resultText };
    } catch (error) {
        const failure = stopping.aborted
            ? { errorCode: 'INTERRUPTED', errorMessage: 'サーバーの停止により実行が中断されました。' }
            : deadline.signal.aborted || (error instanceof Error && error.name === 'AbortError')
                ? { errorCode: 'TIMEOUT', errorMessage: 'AI の応答が制限時間を超えました。' }
                : error instanceof CoWorkConfigError
                    ? { errorCode: 'AI_NOT_CONFIGURED', errorMessage: 'サーバーの CoWork 用 AI 設定を確認してください。' }
                    : { errorCode: 'EXECUTION_FAILED', errorMessage: 'AI の接続または応答の取得に失敗しました。' };
        console.warn('[CoWork] AI 実行失敗', { runId: run.id, code: failure.errorCode });
        outcome = { status: 'failed', ...failure };
    } finally {
        clearTimeout(timeout);
        if (onAbort) signal.removeEventListener('abort', onAbort);
    }
    repo.complete(owner, run.id, outcome);
}

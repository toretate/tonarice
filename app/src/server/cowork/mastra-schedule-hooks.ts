import type { Mastra } from '@mastra/core/mastra';
import type { ScheduleHooks, ScheduleTriggerInfo } from '@mastra/core/schedules';
import type { ScheduledPromptRun } from '../../types/scheduled-prompt-task';
import { COWORK_AGENT_ID } from '../mastra/cowork-agent';
import {
    acceptCoWorkDispatch, type ClaimedRun, dispatchNextCoWorkRun, ensureQueueRecoverySchedule,
    queueRecoveryScheduleId, recoverCoWorkQueueLease, recoverCoWorkSchedulePublication
} from './mastra-queue';
import { ensureCoWorkSchedule, isCoWorkStopping, metadataOf, resolveTaskIdentity } from './mastra-schedules';
import type { CoWorkRepository } from './repository';
import { cleanCoWorkResult } from './result';

type RunOutcome = Parameters<CoWorkRepository['finishRunning']>[2];

function logRunStart(trigger: ScheduledPromptRun['trigger']) {
    console.info('[CoWork] AI 実行を開始します。', {
        engine: process.env.COWORK_AI_ENGINE?.trim() || 'unknown',
        model: process.env.COWORK_AI_MODEL?.trim() || 'unknown',
        trigger
    });
}

async function completeRun(mastra: Mastra, repo: CoWorkRepository, claim: ClaimedRun, outcome: RunOutcome, signal: AbortSignal) {
    const finished = repo.finishRunning(claim.owner, claim.run.id, outcome);
    if (finished && outcome.status === 'success') {
        console.info('[CoWork] AI 実行が完了しました。');
    }
    if (isCoWorkStopping(mastra, signal)) return;
    const task = repo.get(claim.owner, claim.task.id);
    if (task) {
        try {
            await ensureCoWorkSchedule(mastra, repo, claim.owner, task, signal);
        } catch {
            console.error('[CoWork] 次回 schedule を同期できませんでした。');
        }
    }
    await dispatchNextCoWorkRun(mastra, repo, signal);
    try {
        await ensureQueueRecoverySchedule(mastra, repo, signal);
    } catch {
        console.error('[CoWork] 実行期限の recovery schedule を同期できませんでした。');
    }
}

function hasErrorName(error: unknown, names: string[]) {
    const seen = new Set<unknown>();
    let current: unknown = error;
    while (current instanceof Error && !seen.has(current)) {
        if (names.includes(current.name)) return true;
        seen.add(current);
        current = current.cause;
    }
    return false;
}

/** Mastra の agent schedule lifecycle hook。 */
export function createCoWorkScheduleHooks(repo: CoWorkRepository, signal: AbortSignal) {
    // 同じ発火の完了で、その発火が取得した run だけを更新する。
    const runsByTrigger = new WeakMap<ScheduleTriggerInfo, ClaimedRun>();
    const hooks: ScheduleHooks<Mastra> = {
        prepare: async ({ mastra, agentId, schedule, trigger }) => {
            if (agentId !== COWORK_AGENT_ID) return undefined;
            if (isCoWorkStopping(mastra, signal)) return null;
            const metadata = metadataOf(schedule);
            if (schedule.id === queueRecoveryScheduleId) {
                recoverCoWorkQueueLease(repo, metadata, trigger.firedAt);
                return null;
            }
            if (trigger.kind === 'manual') {
                const accepted = acceptCoWorkDispatch(mastra, repo, schedule.id);
                if (!accepted) return null;
                runsByTrigger.set(trigger, accepted.claim);
                logRunStart(accepted.claim.run.trigger);
                return { prompt: accepted.prompt };
            }
            const identity = resolveTaskIdentity(schedule, repo);
            if (!identity) return null;
            const owner = repo.ownerForScope(identity.ownerScope);
            if (!owner) return null;

            // 重複 publish が再到着した場合、前回の hook が次の one-off に更新済みなら実行しない。
            const runAt = schedule['runAt'];
            const expectedAt = typeof runAt === 'number' ? runAt : Date.parse(String(metadata.scheduledAt ?? ''));
            if (Number.isFinite(expectedAt) && expectedAt > trigger.firedAt.getTime()) return null;

            const scheduledAt = typeof metadata.scheduledAt === 'string' ? metadata.scheduledAt : undefined;
            const prepared = repo.prepareScheduled(owner, identity.taskId, scheduledAt, trigger.firedAt);
            if (!prepared) return null;
            const run = prepared.execute && prepared.run?.status === 'running' ? prepared.run : undefined;
            if (run) runsByTrigger.set(trigger, { owner, task: prepared.task, run });
            const next = await ensureCoWorkSchedule(mastra, repo, owner, prepared.task, signal);
            await ensureQueueRecoverySchedule(mastra, repo, signal);
            if (!run) return null;
            if (repo.getRun(owner, run.id)?.status !== 'running') return null;
            if (!next || isCoWorkStopping(mastra, signal)) {
                repo.requeueUnstartedRun(owner, run.id);
                runsByTrigger.delete(trigger);
                return null;
            }
            logRunStart('scheduled');
            return { prompt: prepared.task.prompt };
        },
        onFinish: async ({ mastra, agentId, schedule, trigger, outcome, result }) => {
            if (agentId !== COWORK_AGENT_ID) return;
            if (outcome === 'skipped') {
                await dispatchNextCoWorkRun(mastra, repo, signal);
                if (schedule.id === queueRecoveryScheduleId) await ensureQueueRecoverySchedule(mastra, repo, signal);
                return;
            }
            const claim = runsByTrigger.get(trigger);
            if (claim && outcome === 'succeeded') {
                await completeRun(mastra, repo, claim, {
                    status: 'success',
                    resultText: cleanCoWorkResult(result?.text ?? '')
                }, signal);
            }
        },
        onError: async ({ mastra, agentId, schedule, trigger, error }) => {
            if (agentId !== COWORK_AGENT_ID) return;
            const claim = runsByTrigger.get(trigger);
            if (!claim) {
                await recoverCoWorkSchedulePublication(mastra, repo, schedule.id, signal);
                await dispatchNextCoWorkRun(mastra, repo, signal);
                return;
            }
            const configFailure = hasErrorName(error, ['CoWorkAgentConfigError']);
            const timeoutFailure = hasErrorName(error, ['MastraTimeoutError', 'TimeoutError']);
            await completeRun(mastra, repo, claim, {
                status: 'failed',
                errorCode: configFailure ? 'AI_NOT_CONFIGURED' : timeoutFailure ? 'TIMEOUT' : 'EXECUTION_FAILED',
                errorMessage: configFailure
                    ? 'サーバーの CoWork 用 AI 設定を確認してください。'
                    : timeoutFailure
                        ? 'AI の応答が制限時間を超えました。'
                        : 'AI の接続または応答の取得に失敗しました。'
            }, signal);
            console.warn('[CoWork] AI 実行に失敗しました。', { code: configFailure ? 'AI_NOT_CONFIGURED' : timeoutFailure ? 'TIMEOUT' : 'EXECUTION_FAILED' });
        },
        onAbort: async ({ mastra, agentId, trigger }) => {
            if (agentId !== COWORK_AGENT_ID) return;
            const claim = runsByTrigger.get(trigger);
            if (!claim) return;
            await completeRun(mastra, repo, claim, {
                status: 'failed',
                errorCode: 'INTERRUPTED',
                errorMessage: 'サーバーの停止により実行が中断されました。'
            }, signal);
        }
    };
    return hooks;
}

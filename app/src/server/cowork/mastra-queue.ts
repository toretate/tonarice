import type { Mastra } from '@mastra/core/mastra';
import type { ScheduledPromptRun, ScheduledPromptTask } from '../../types/scheduled-prompt-task';
import { COWORK_AGENT_ID } from '../mastra/cowork-agent';
import {
    ensureCoWorkSchedule, isCoWorkStopping, metadataOf, recoveryFireDelay,
    retryCoWorkTaskSchedule, scheduleRetryDelay
} from './mastra-schedules';
import type { CoWorkRepository } from './repository';

const queueRecoveryTag = 'tonarice-cowork-queue-recovery';
export const queueRecoveryScheduleId = 'agent_cowork-queue-recovery';

export type ClaimedRun = { owner: string; task: ScheduledPromptTask; run: ScheduledPromptRun };
type ManualDispatch = { scheduleId: string; claim: ClaimedRun; accepted: boolean };
const pendingDispatch = new WeakMap<Mastra, ManualDispatch>();

export function requeueUndeliveredCoWorkRun(mastra: Mastra, repo: CoWorkRepository) {
    const pending = pendingDispatch.get(mastra);
    if (!pending) return;
    pendingDispatch.delete(mastra);
    repo.requeueUnstartedRun(pending.claim.owner, pending.claim.run.id);
}

export function acceptCoWorkDispatch(mastra: Mastra, repo: CoWorkRepository, scheduleId: string) {
    const pending = pendingDispatch.get(mastra);
    if (!pending || pending.scheduleId !== scheduleId) return undefined;
    const { claim } = pending;
    pendingDispatch.delete(mastra);
    const current = repo.getRun(claim.owner, claim.run.id);
    if (current?.status !== 'running') return undefined;
    const task = repo.get(claim.owner, claim.task.id);
    if (!task || (current.trigger === 'scheduled' && !task.enabled)) {
        repo.requeueUnstartedRun(claim.owner, claim.run.id);
        return undefined;
    }
    pending.accepted = true;
    return { claim, prompt: task.prompt };
}

export async function ensureQueueRecoverySchedule(mastra: Mastra, repo: CoWorkRepository, signal: AbortSignal) {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (isCoWorkStopping(mastra, signal)) return;
        const activeRun = repo.activeRunLease();
        const schedule = await mastra.schedules.get(queueRecoveryScheduleId);
        if (isCoWorkStopping(mastra, signal)) return;
        const hasQueued = repo.hasQueuedRuns();
        if (!activeRun && !hasQueued) return;

        const runAt = activeRun
            ? Math.max(Date.parse(activeRun.lease_until), Date.now() + recoveryFireDelay)
            : Date.now() + scheduleRetryDelay;
        const metadata = {
            kind: queueRecoveryTag,
            mode: activeRun ? 'lease' : 'queue',
            ...(activeRun ? { runId: activeRun.id } : {})
        };
        const currentMetadata = metadataOf(schedule);
        const keepQueueRetry = !activeRun && hasQueued && schedule?.status === 'active'
            && currentMetadata.mode === 'queue';
        if (!schedule) {
            try {
                await mastra.schedules.create({
                    id: queueRecoveryScheduleId,
                    agentId: COWORK_AGENT_ID,
                    runAt: new Date(runAt),
                    prompt: 'CoWork の実行期限を確認してください。',
                    name: 'CoWork queue recovery',
                    timezone: 'UTC',
                    metadata
                });
            } catch (error) {
                if (!await mastra.schedules.get(queueRecoveryScheduleId)) throw error;
                continue;
            }
        } else if (!keepQueueRetry && (schedule.status !== 'active' || schedule.runAt !== runAt
            || currentMetadata.mode !== metadata.mode
            || currentMetadata.runId !== activeRun?.id)) {
            await mastra.schedules.update(schedule.id, {
                runAt: new Date(runAt),
                metadata,
                status: 'active'
            });
        }

        if (repo.activeRunLease()?.id === activeRun?.id && repo.hasQueuedRuns() === hasQueued) return;
    }
    throw new Error('CoWork queue recovery schedule が更新中に変わりました。');
}

export function recoverCoWorkQueueLease(repo: CoWorkRepository, metadata: Record<string, unknown>, firedAt: Date) {
    if (metadata.mode !== 'lease') return;
    const activeRun = repo.activeRunLease();
    if (activeRun && activeRun.id === metadata.runId
        && Date.parse(activeRun.lease_until) <= firedAt.getTime()) {
        const recovered = repo.recoverExpiredRuns(firedAt);
        if (recovered) console.warn('[CoWork] 期限切れの実行を中断として確定しました。', { recovered });
    }
}

export async function recoverCoWorkSchedulePublication(mastra: Mastra, repo: CoWorkRepository, scheduleId: string, signal: AbortSignal) {
    if (scheduleId === queueRecoveryScheduleId) {
        await ensureQueueRecoverySchedule(mastra, repo, signal);
        return;
    }
    await retryCoWorkTaskSchedule(mastra, repo, scheduleId, signal);
}

async function dispatchClaimedRun(
    mastra: Mastra,
    repo: CoWorkRepository,
    claim: ClaimedRun,
    signal: AbortSignal
) {
    let dispatch: ManualDispatch | undefined;
    try {
        const schedule = await ensureCoWorkSchedule(mastra, repo, claim.owner, claim.task, signal);
        await ensureQueueRecoverySchedule(mastra, repo, signal);
        if (isCoWorkStopping(mastra, signal) || !repo.get(claim.owner, claim.task.id)) {
            repo.requeueUnstartedRun(claim.owner, claim.run.id);
            return false;
        }
        if (!schedule) throw new Error('CoWork schedule が見つかりません。');
        if (repo.getRun(claim.owner, claim.run.id)?.status !== 'running') return false;
        dispatch = { scheduleId: schedule.id, claim, accepted: false };
        pendingDispatch.set(mastra, dispatch);
        await mastra.schedules.run(schedule.id);
        return true;
    } catch {
        if (dispatch?.accepted) return true;
        if (dispatch && pendingDispatch.get(mastra) === dispatch) pendingDispatch.delete(mastra);
        if (isCoWorkStopping(mastra, signal) || !repo.get(claim.owner, claim.task.id)) {
            repo.requeueUnstartedRun(claim.owner, claim.run.id);
            return false;
        }
        repo.finishRunning(claim.owner, claim.run.id, {
            status: 'failed',
            errorCode: 'SCHEDULE_FAILED',
            errorMessage: 'スケジュールを開始できませんでした。'
        });
        console.error('[CoWork] Mastra schedule の実行を開始できませんでした。');
        return false;
    }
}

/** CoWork の queued run を Mastra schedule 経由で1件だけ開始する。 */
export async function dispatchNextCoWorkRun(mastra: Mastra, repo: CoWorkRepository, signal: AbortSignal) {
    while (!isCoWorkStopping(mastra, signal)) {
        const claim = repo.claimNextQueuedRun();
        if (!claim || await dispatchClaimedRun(mastra, repo, claim, signal)) return;
    }
}

export async function runCoWorkTaskNow(mastra: Mastra, repo: CoWorkRepository, owner: string, taskId: string, signal: AbortSignal) {
    const run = repo.enqueue(owner, taskId);
    if (!run) return undefined;
    if (run.status === 'queued' && !isCoWorkStopping(mastra, signal)) {
        const claimed = repo.claimQueuedRun(owner, run.id);
        if (claimed && !await dispatchClaimedRun(mastra, repo, claimed, signal)) {
            await dispatchNextCoWorkRun(mastra, repo, signal);
        }
    }
    return repo.getRun(owner, run.id) ?? run;
}

import { createHash } from 'node:crypto';
import type { Mastra } from '@mastra/core/mastra';
import type {
    AgentSchedule,
    AnySchedule,
    ScheduleAbortContext,
    ScheduleErrorContext,
    ScheduleFinishContext,
    ScheduleHooks,
    SchedulePrepareContext
} from '@mastra/core/schedules';
import type { ScheduledPromptRun, ScheduledPromptTask } from '../../types/scheduled-prompt-task';
import { getCoWorkScope } from './http';
import { CoWorkRepository } from './repository';
import { cleanCoWorkResult } from './result';
import { COWORK_AGENT_ID } from '../mastra/cowork-agent';

const recoveryFireDelay = 1_000;
const publicationRetryDelay = 60_000;
const scheduleTag = 'tonarice-cowork';
const queueRecoveryTag = 'tonarice-cowork-queue-recovery';
const queueRecoveryScheduleId = 'agent_cowork-queue-recovery';

type HookSchedule = { id: string; [key: string]: unknown };
type ClaimedRun = { owner: string; task: ScheduledPromptTask; run: ScheduledPromptRun };
type RunOutcome = Parameters<CoWorkRepository['finishRunning']>[2];
type ManualDispatch = { scheduleId: string; claim: ClaimedRun; accepted: boolean };
const pendingDispatch = new WeakMap<Mastra, ManualDispatch>();

function isStopping(mastra: Mastra, signal: AbortSignal) {
    return signal.aborted || mastra.__shuttingDown;
}

function logRunStart(trigger: ScheduledPromptRun['trigger']) {
    console.info('[CoWork] AI 実行を開始します。', {
        engine: process.env.COWORK_AI_ENGINE?.trim() || 'unknown',
        model: process.env.COWORK_AI_MODEL?.trim() || 'unknown',
        trigger
    });
}

export function requeueUndeliveredCoWorkRun(mastra: Mastra, repo: CoWorkRepository) {
    const pending = pendingDispatch.get(mastra);
    if (!pending) return;
    pendingDispatch.delete(mastra);
    repo.requeueUnstartedRun(pending.claim.owner, pending.claim.run.id);
}

function metadataOf(schedule: AnySchedule | AgentSchedule | HookSchedule): Record<string, unknown> {
    const metadata = 'metadata' in schedule ? schedule.metadata : undefined;
    return metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
}

function isCoWorkSchedule(schedule: AnySchedule | AgentSchedule | HookSchedule) {
    const agentId = 'agentId' in schedule ? schedule.agentId : undefined;
    return agentId === COWORK_AGENT_ID && metadataOf(schedule).kind === scheduleTag;
}

function taskIdentity(schedule: AnySchedule | AgentSchedule | HookSchedule) {
    const metadata = metadataOf(schedule);
    const ownerScope = metadata.ownerScope;
    const taskId = metadata.taskId;
    return typeof ownerScope === 'string' && typeof taskId === 'string' ? { ownerScope, taskId } : undefined;
}

function resolveTaskIdentity(schedule: AnySchedule | AgentSchedule | HookSchedule, repo: CoWorkRepository) {
    const identity = taskIdentity(schedule);
    if (identity) return identity;
    const link = repo.taskForScheduleId(schedule.id);
    if (!link) return undefined;
    return { ownerScope: getCoWorkScope(link.owner), taskId: link.task_id };
}

function makeScheduleId(owner: string, taskId: string) {
    const digest = createHash('sha256').update(JSON.stringify(['cowork-schedule', owner, taskId])).digest('hex').slice(0, 32);
    return `cowork-${digest}`;
}

function makeScheduleMetadata(ownerScope: string, taskId: string, scheduledAt: string) {
    return { kind: scheduleTag, ownerScope, taskId, scheduledAt };
}

async function findSchedule(mastra: Mastra, repo: CoWorkRepository, owner: string, taskId: string) {
    const linkedId = repo.getScheduleId(owner, taskId);
    if (linkedId) {
        const linked = await mastra.schedules.get(linkedId);
        if (linked && isCoWorkSchedule(linked)) return linked;
    }

    const [active, paused, completed] = await Promise.all([
        mastra.schedules.list({ agentId: COWORK_AGENT_ID, status: 'active' }),
        mastra.schedules.list({ agentId: COWORK_AGENT_ID, status: 'paused' }),
        mastra.schedules.list({ agentId: COWORK_AGENT_ID, status: 'completed' })
    ]);
    const scope = getCoWorkScope(owner);
    const found = [...active, ...paused, ...completed].find(schedule => {
        const identity = taskIdentity(schedule);
        return isCoWorkSchedule(schedule) && identity?.ownerScope === scope && identity.taskId === taskId;
    });
    if (found) repo.setScheduleId(owner, taskId, found.id);
    return found;
}

function scheduledFireAt(task: ScheduledPromptTask, now: Date) {
    const expected = Date.parse(task.nextRunAt);
    return Number.isFinite(expected) && expected > now.getTime()
        ? expected
        : now.getTime() + recoveryFireDelay;
}

/** Mastra schedule row を現在の CoWork task に合わせる。 */
export async function ensureCoWorkSchedule(
    mastra: Mastra, repo: CoWorkRepository, owner: string, taskInput: ScheduledPromptTask, signal?: AbortSignal
) {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (signal && isStopping(mastra, signal)) return undefined;
        const task = repo.get(owner, taskInput.id);
        if (!task) return undefined;
        const ownerScope = getCoWorkScope(owner);
        repo.registerOwnerScope(owner, ownerScope);
        let schedule = await findSchedule(mastra, repo, owner, task.id);
        if (signal && isStopping(mastra, signal)) return undefined;
        const metadata = makeScheduleMetadata(ownerScope, task.id, task.nextRunAt);

        if (!schedule) {
            try {
                schedule = await mastra.schedules.create({
                    id: makeScheduleId(owner, task.id),
                    agentId: COWORK_AGENT_ID,
                    runAt: new Date(scheduledFireAt(task, new Date())),
                    prompt: task.prompt,
                    name: task.name,
                    timezone: task.timeZone,
                    status: task.enabled ? 'active' : 'paused',
                    metadata
                });
            } catch (error) {
                schedule = await findSchedule(mastra, repo, owner, task.id);
                if (!schedule) throw error;
            }
        }
        if (signal && isStopping(mastra, signal)) return undefined;
        repo.setScheduleId(owner, task.id, schedule.id);
        if (!task.enabled) {
            if (schedule.status === 'active') {
                try {
                    schedule = await mastra.schedules.pause(schedule.id);
                } catch {
                    schedule = await mastra.schedules.get(schedule.id) ?? schedule;
                }
            }
        } else {
            const runAt = scheduledFireAt(task, new Date());
            schedule = await mastra.schedules.update(schedule.id, {
                runAt: new Date(runAt),
                prompt: task.prompt,
                name: task.name,
                timezone: task.timeZone,
                metadata,
                status: 'active'
            }) as AgentSchedule;
        }

        const latest = repo.get(owner, task.id);
        if (!latest) {
            await mastra.schedules.delete(schedule.id);
            repo.setScheduleId(owner, task.id, undefined);
            return undefined;
        }
        if (latest.enabled === task.enabled && latest.nextRunAt === task.nextRunAt
            && latest.prompt === task.prompt && latest.name === task.name && latest.timeZone === task.timeZone) {
            return schedule;
        }
    }
    throw new Error('CoWork task の schedule が更新中に変わりました。');
}

async function ensureQueueRecoverySchedule(mastra: Mastra, repo: CoWorkRepository, signal: AbortSignal) {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (isStopping(mastra, signal)) return;
        const activeRun = repo.activeRunLease();
        let schedule = await mastra.schedules.get(queueRecoveryScheduleId);
        if (isStopping(mastra, signal)) return;
        const hasQueued = repo.hasQueuedRuns();
        if (!activeRun && !hasQueued) return;

        const runAt = activeRun
            ? Math.max(Date.parse(activeRun.lease_until), Date.now() + recoveryFireDelay)
            : Date.now() + publicationRetryDelay;
        const metadata = {
            kind: queueRecoveryTag,
            mode: activeRun ? 'lease' : 'queue',
            ...(activeRun ? { runId: activeRun.id } : {})
        };
        const currentMetadata = metadataOf(schedule ?? { id: queueRecoveryScheduleId });
        const keepQueueRetry = !activeRun && hasQueued && schedule?.status === 'active'
            && currentMetadata.mode === 'queue';
        if (!schedule) {
            try {
                schedule = await mastra.schedules.create({
                    id: queueRecoveryScheduleId,
                    agentId: COWORK_AGENT_ID,
                    runAt: new Date(runAt),
                    prompt: 'CoWork の実行期限を確認してください。',
                    name: 'CoWork queue recovery',
                    timezone: 'UTC',
                    metadata
                }) as AgentSchedule;
            } catch (error) {
                schedule = await mastra.schedules.get(queueRecoveryScheduleId);
                if (!schedule) throw error;
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

async function completeRun(mastra: Mastra, repo: CoWorkRepository, claim: ClaimedRun, outcome: RunOutcome, signal: AbortSignal) {
    const finished = repo.finishRunning(claim.owner, claim.run.id, outcome);
    if (finished && outcome.status === 'success') {
        console.info('[CoWork] AI 実行が完了しました。');
    }
    if (isStopping(mastra, signal)) return;
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
        if (isStopping(mastra, signal) || !repo.get(claim.owner, claim.task.id)) {
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
        if (isStopping(mastra, signal) || !repo.get(claim.owner, claim.task.id)) {
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
    while (!isStopping(mastra, signal)) {
        const claim = repo.claimNextQueuedRun();
        if (!claim || await dispatchClaimedRun(mastra, repo, claim, signal)) return;
    }
}

/** Mastra の agent schedule lifecycle hook。 */
export function createCoWorkScheduleHooks(repo: CoWorkRepository, signal: AbortSignal) {
    // 同じ発火の完了で、その発火が取得した run だけを更新する。
    const runsByTrigger = new WeakMap<SchedulePrepareContext<Mastra>['trigger'], ClaimedRun>();
    const hooks: ScheduleHooks<Mastra> = {
        prepare: async ({ mastra, agentId, schedule, trigger }: SchedulePrepareContext<Mastra>) => {
            if (agentId !== COWORK_AGENT_ID) return undefined;
            if (isStopping(mastra, signal)) return null;
            const metadata = metadataOf(schedule);
            if (schedule.id === queueRecoveryScheduleId) {
                if (metadata.mode === 'lease') {
                    const activeRun = repo.activeRunLease();
                    if (activeRun && activeRun.id === metadata.runId
                        && Date.parse(activeRun.lease_until) <= trigger.firedAt.getTime()) {
                        const recovered = repo.recoverExpiredRuns(trigger.firedAt);
                        if (recovered) console.warn('[CoWork] 期限切れの実行を中断として確定しました。', { recovered });
                    }
                }
                return null;
            }
            if (trigger.kind === 'manual') {
                const pending = pendingDispatch.get(mastra);
                if (!pending || pending.scheduleId !== schedule.id) return null;
                const { claim } = pending;
                pendingDispatch.delete(mastra);
                const current = repo.getRun(claim.owner, claim.run.id);
                if (current?.status !== 'running') return null;
                const task = repo.get(claim.owner, claim.task.id);
                if (!task || (current.trigger === 'scheduled' && !task.enabled)) {
                    repo.requeueUnstartedRun(claim.owner, claim.run.id);
                    return null;
                }
                pending.accepted = true;
                runsByTrigger.set(trigger, claim);
                logRunStart(current.trigger);
                return { prompt: task.prompt };
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
            if (!next || isStopping(mastra, signal)) {
                repo.requeueUnstartedRun(owner, run.id);
                runsByTrigger.delete(trigger);
                return null;
            }
            logRunStart('scheduled');
            return { prompt: prepared.task.prompt };
        },
        onFinish: async ({ mastra, agentId, schedule, trigger, outcome, result }: ScheduleFinishContext<Mastra>) => {
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
        onError: async ({ mastra, agentId, schedule, trigger, error }: ScheduleErrorContext<Mastra>) => {
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
        onAbort: async ({ mastra, agentId, trigger }: ScheduleAbortContext<Mastra>) => {
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

/** サーバー起動時に DB と Mastra schedule row の不整合を修復する。 */
export async function reconcileCoWorkSchedules(mastra: Mastra, repo: CoWorkRepository, signal: AbortSignal) {
    repo.recoverExpiredRuns();
    const tasks = repo.listAllTasks();
    for (const { owner, task } of tasks) {
        await ensureCoWorkSchedule(mastra, repo, owner, task, signal);
    }

    const schedules = (await Promise.all([
        mastra.schedules.list({ agentId: COWORK_AGENT_ID, status: 'active' }),
        mastra.schedules.list({ agentId: COWORK_AGENT_ID, status: 'paused' }),
        mastra.schedules.list({ agentId: COWORK_AGENT_ID, status: 'completed' })
    ])).flat();
    for (const schedule of schedules) {
        if (isStopping(mastra, signal)) return;
        if (!isCoWorkSchedule(schedule)) continue;
        const identity = taskIdentity(schedule);
        const owner = identity && repo.ownerForScope(identity.ownerScope);
        const task = owner && identity ? repo.get(owner, identity.taskId) : undefined;
        if (!task || !owner || repo.getScheduleId(owner, identity.taskId) !== schedule.id) {
            await mastra.schedules.delete(schedule.id);
        }
    }
    await ensureQueueRecoverySchedule(mastra, repo, signal);
}

/** Mastra の publish 失敗 callback から期限切れ one-off fire を再登録する。 */
export async function recoverCoWorkSchedulePublication(mastra: Mastra, repo: CoWorkRepository, scheduleId: string, signal: AbortSignal) {
    if (isStopping(mastra, signal)) return;
    if (scheduleId === queueRecoveryScheduleId) {
        await ensureQueueRecoverySchedule(mastra, repo, signal);
        return;
    }
    const link = repo.taskForScheduleId(scheduleId);
    if (!link) return;
    const task = repo.get(link.owner, link.task_id);
    if (!task?.enabled) return;
    const schedule = await mastra.schedules.get(scheduleId);
    if (isStopping(mastra, signal)) return;
    if (!schedule || schedule.agentId !== COWORK_AGENT_ID || schedule.status !== 'completed') return;

    const ownerScope = getCoWorkScope(link.owner);
    await mastra.schedules.update(scheduleId, {
        runAt: new Date(Date.now() + publicationRetryDelay),
        prompt: task.prompt,
        name: task.name,
        timezone: task.timeZone,
        metadata: makeScheduleMetadata(ownerScope, task.id, task.nextRunAt),
        status: 'active'
    });
    console.warn('[CoWork] Mastra schedule の発火を1分後に再試行します。', { scheduleId });
}

export async function removeCoWorkTaskSchedule(mastra: Mastra, repo: CoWorkRepository, owner: string, taskId: string) {
    const scheduleId = repo.getScheduleId(owner, taskId);
    repo.setScheduleId(owner, taskId, undefined);
    if (scheduleId) await mastra.schedules.delete(scheduleId);
}

export async function runCoWorkTaskNow(mastra: Mastra, repo: CoWorkRepository, owner: string, taskId: string, signal: AbortSignal) {
    const run = repo.enqueue(owner, taskId);
    if (!run) return undefined;
    if (run.status === 'queued' && !isStopping(mastra, signal)) {
        const claimed = repo.claimQueuedRun(owner, run.id);
        if (claimed && !await dispatchClaimedRun(mastra, repo, claimed, signal)) {
            await dispatchNextCoWorkRun(mastra, repo, signal);
        }
    }
    return repo.getRun(owner, run.id) ?? run;
}

export async function importCoWorkTasks(mastra: Mastra, repo: CoWorkRepository, owner: string, source: Parameters<CoWorkRepository['importLegacy']>[1]) {
    const imported = repo.importLegacy(owner, source);
    const { tasks } = repo.list(owner);
    for (const task of tasks) {
        await ensureCoWorkSchedule(mastra, repo, owner, task);
    }
    return imported;
}

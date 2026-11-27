import { createHash } from 'node:crypto';
import type { Mastra } from '@mastra/core/mastra';
import type { AgentSchedule, AnySchedule } from '@mastra/core/schedules';
import type { ScheduledPromptTask } from '../../types/scheduled-prompt-task';
import { COWORK_AGENT_ID } from '../mastra/cowork-agent';
import { getCoWorkScope } from './http';
import type { CoWorkRepository } from './repository';

export const recoveryFireDelay = 1_000;
export const scheduleRetryDelay = 60_000;
const scheduleTag = 'tonarice-cowork';

type ScheduleReference = { id: string; metadata?: unknown };

export function isCoWorkStopping(mastra: Mastra, signal: AbortSignal) {
    return signal.aborted || mastra.__shuttingDown;
}

async function listCoWorkSchedules(mastra: Mastra) {
    const rows = await Promise.all([
        mastra.schedules.list({ agentId: COWORK_AGENT_ID, status: 'active' }),
        mastra.schedules.list({ agentId: COWORK_AGENT_ID, status: 'paused' }),
        mastra.schedules.list({ agentId: COWORK_AGENT_ID, status: 'completed' })
    ]);
    return rows.flat();
}

export function metadataOf(schedule: ScheduleReference | null): Record<string, unknown> {
    const metadata = schedule?.metadata;
    return metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
}

function isCoWorkSchedule(schedule: AnySchedule) {
    return schedule.agentId === COWORK_AGENT_ID && metadataOf(schedule).kind === scheduleTag;
}

function taskIdentity(schedule: ScheduleReference) {
    const metadata = metadataOf(schedule);
    const ownerScope = metadata.ownerScope;
    const taskId = metadata.taskId;
    return typeof ownerScope === 'string' && typeof taskId === 'string' ? { ownerScope, taskId } : undefined;
}

export function resolveTaskIdentity(schedule: ScheduleReference, repo: CoWorkRepository) {
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

    const scope = getCoWorkScope(owner);
    const found = (await listCoWorkSchedules(mastra)).find(schedule => {
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
        if (signal && isCoWorkStopping(mastra, signal)) return undefined;
        const task = repo.get(owner, taskInput.id);
        if (!task) return undefined;
        const ownerScope = getCoWorkScope(owner);
        repo.registerOwnerScope(owner, ownerScope);
        let schedule = await findSchedule(mastra, repo, owner, task.id);
        if (signal && isCoWorkStopping(mastra, signal)) return undefined;
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
        if (signal && isCoWorkStopping(mastra, signal)) return undefined;
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

/** サーバー起動時に DB と Mastra schedule row の不整合を修復する。 */
export async function reconcileCoWorkSchedules(mastra: Mastra, repo: CoWorkRepository, signal: AbortSignal) {
    const tasks = repo.listAllTasks();
    for (const { owner, task } of tasks) {
        await ensureCoWorkSchedule(mastra, repo, owner, task, signal);
    }

    for (const schedule of await listCoWorkSchedules(mastra)) {
        if (isCoWorkStopping(mastra, signal)) return;
        if (!isCoWorkSchedule(schedule)) continue;
        const identity = taskIdentity(schedule);
        const owner = identity && repo.ownerForScope(identity.ownerScope);
        const task = owner && identity ? repo.get(owner, identity.taskId) : undefined;
        if (!task || !owner || repo.getScheduleId(owner, identity.taskId) !== schedule.id) {
            await mastra.schedules.delete(schedule.id);
        }
    }
}

/** Mastra の publish 失敗 callback から期限切れ one-off fire を再登録する。 */
export async function retryCoWorkTaskSchedule(mastra: Mastra, repo: CoWorkRepository, scheduleId: string, signal: AbortSignal) {
    if (isCoWorkStopping(mastra, signal)) return;
    const link = repo.taskForScheduleId(scheduleId);
    if (!link) return;
    const task = repo.get(link.owner, link.task_id);
    if (!task?.enabled) return;
    const schedule = await mastra.schedules.get(scheduleId);
    if (isCoWorkStopping(mastra, signal)) return;
    if (!schedule || schedule.agentId !== COWORK_AGENT_ID || schedule.status !== 'completed') return;

    const ownerScope = getCoWorkScope(link.owner);
    await mastra.schedules.update(scheduleId, {
        runAt: new Date(Date.now() + scheduleRetryDelay),
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

export async function importCoWorkTasks(mastra: Mastra, repo: CoWorkRepository, owner: string, source: Parameters<CoWorkRepository['importLegacy']>[1]) {
    const imported = repo.importLegacy(owner, source);
    const { tasks } = repo.list(owner);
    for (const task of tasks) {
        await ensureCoWorkSchedule(mastra, repo, owner, task);
    }
    return imported;
}

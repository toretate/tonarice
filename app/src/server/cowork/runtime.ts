import type { ScheduledPromptTaskInput } from '../../types/scheduled-prompt-task';
import { getMastraRuntime } from '../mastra/runtime';
import { getDB } from '../utils/db';
import { ensureCoWorkSchedule, importCoWorkTasks, removeCoWorkTaskSchedule, runCoWorkTaskNow } from './mastra-schedules';
import { CoWorkRepository } from './repository';

let repository: CoWorkRepository | undefined;

export function getCoWorkRepository() {
    return repository ??= new CoWorkRepository(getDB());
}

export async function createCoWorkTask(owner: string, input: ScheduledPromptTaskInput) {
    const repo = getCoWorkRepository();
    const task = repo.create(owner, input);
    try {
        await ensureCoWorkSchedule(getMastraRuntime(), repo, owner, task);
        return task;
    } catch (error) {
        repo.delete(owner, task.id);
        throw error;
    }
}

export async function updateCoWorkTask(
    owner: string,
    id: string,
    input: ScheduledPromptTaskInput | { enabled: boolean }
) {
    const repo = getCoWorkRepository();
    const previous = repo.get(owner, id);
    const task = repo.update(owner, id, input);
    if (!task) return undefined;
    try {
        await ensureCoWorkSchedule(getMastraRuntime(), repo, owner, task);
        return task;
    } catch (error) {
        if (previous) {
            const restored = repo.restoreTask(owner, task, previous);
            if (restored) {
                await ensureCoWorkSchedule(getMastraRuntime(), repo, owner, previous).catch(() => {});
            }
        }
        throw error;
    }
}

export async function deleteCoWorkTask(owner: string, id: string) {
    const repo = getCoWorkRepository();
    const deleted = repo.delete(owner, id);
    if (!deleted) return false;
    try {
        await removeCoWorkTaskSchedule(getMastraRuntime(), repo, owner, id);
    } catch {
        console.warn('[CoWork] 削除済みタスクの schedule を後で整理します。');
    }
    return true;
}

export async function runCoWorkTask(owner: string, id: string) {
    return runCoWorkTaskNow(getMastraRuntime(), getCoWorkRepository(), owner, id);
}

export async function importLegacyCoWorkTasks(
    owner: string,
    source: Parameters<CoWorkRepository['importLegacy']>[1]
) {
    return importCoWorkTasks(getMastraRuntime(), getCoWorkRepository(), owner, source);
}

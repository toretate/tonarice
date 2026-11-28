import { reserveCompanionContext } from './companion-memory';
import { loadTasksStateFromDb } from '../utils/tasks-service';

export function buildCompanionContext(owner: string, mascot: string, mayNudge: boolean) {
    const now = Date.now();
    const tasks = loadTasksStateFromDb(owner).tasks.flatMap(task => {
        if (task.completed || task.status === 'done' || typeof task.title !== 'string') return [];
        const date = typeof task.scheduledAt === 'string' ? Date.parse(task.scheduledAt) : NaN;
        const overdue = Number.isFinite(date) && date < now;
        const priority = task.priority === 'thunder' ? 2 : task.priority === 'star' ? 1 : 0;
        return [{ title: task.title.slice(0, 100), scheduledAt: Number.isFinite(date) ? new Date(date).toISOString() : undefined,
            overdue, priority }];
    }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.priority - a.priority
        || (a.scheduledAt ?? '~').localeCompare(b.scheduledAt ?? '~')).slice(0, 4);
    const pulse = reserveCompanionContext(owner, mascot, mayNudge);
    if (!pulse) return;
    if (!pulse.concern && !pulse.condition && !tasks.length) return;
    return { input: JSON.stringify({ condition: pulse.condition, concern: pulse.concern, tasks }), token: pulse.token };
}
export function canOfferCompanionNudge(lastActivityAt: number | undefined, now = Date.now()) {
    return lastActivityAt === undefined || now - lastActivityAt >= 6 * 60 * 60000;
}


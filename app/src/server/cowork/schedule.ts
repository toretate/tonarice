import type { ScheduledPromptTask } from '../../types/scheduled-prompt-task';
import { calculateNextRunAt } from '../../utils/schedule-calculator';

export const catchUpAge = 7 * 86_400_000;
export const historyAge = 90 * 86_400_000;
export const historyLimit = 1_000;
export const executionTimeout = 60_000;
export const executionLease = 90_000;

export function nextRunAt(task: ScheduledPromptTask, after: Date) {
    return calculateNextRunAt(task.schedule, task.timeZone, {
        after,
        anchor: new Date(task.createdAt)
    }).toISOString();
}

export function advanceSchedule(task: ScheduledPromptTask, now: Date) {
    const firstDue = Date.parse(task.nextRunAt);
    if (task.schedule.type === 'interval') {
        const interval = task.schedule.intervalMinutes * 60_000;
        const latest = firstDue + Math.floor((now.getTime() - firstDue) / interval) * interval;
        return {
            dueAt: new Date(latest).toISOString(),
            nextAt: new Date(latest + interval).toISOString()
        };
    }

    // 補完の対象期間だけを調べ、長期停止後も過去の全予定を走査しない。
    const cutoff = now.getTime() - catchUpAge;
    let dueAt = task.nextRunAt;
    let nextAt = nextRunAt(task, new Date(Math.max(firstDue, cutoff - 1)));
    if (nextAt > now.toISOString() && firstDue < cutoff) {
        const rule = task.schedule;
        const periodDays = rule.type === 'hourly' ? rule.intervalHours / 24
            : rule.type === 'daily' ? rule.intervalDays : rule.intervalWeeks * 7;
        const searchFrom = now.getTime() - (periodDays + 2) * 86_400_000;
        nextAt = nextRunAt(task, new Date(Math.max(firstDue, searchFrom)));
    }
    while (nextAt <= now.toISOString()) {
        dueAt = nextAt;
        nextAt = nextRunAt(task, new Date(dueAt));
    }
    return { dueAt, nextAt };
}

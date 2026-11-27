import type { Mastra } from '@mastra/core/mastra';
import type { AgentSchedule } from '@mastra/core/schedules';
import { vi } from 'vitest';

export function createMastraScheduleFixture() {
    const rows = new Map<string, AgentSchedule>();
    const schedules = {
        get: vi.fn(async (id: string) => rows.get(id) ?? null),
        list: vi.fn(async ({ status }: { status: string }) => [...rows.values()].filter(row => row.status === status)),
        create: vi.fn(async (input: AgentSchedule & { runAt: Date }) => {
            const row = { ...input, id: input.id.startsWith('agent_') ? input.id : 'agent_' + input.id, runAt: +input.runAt };
            rows.set(row.id, row);
            return row;
        }),
        update: vi.fn(async (id: string, patch: Partial<AgentSchedule> & { runAt?: Date }) => {
            const row = rows.get(id);
            if (!row) throw new Error('スケジュールが見つかりません。');
            const updated = { ...row, ...patch, runAt: patch.runAt === undefined ? row.runAt : +patch.runAt };
            rows.set(id, updated);
            return updated;
        }),
        pause: vi.fn(async (id: string) => {
            const row = rows.get(id);
            if (!row) throw new Error('スケジュールが見つかりません。');
            const paused = { ...row, status: 'paused' as const };
            rows.set(id, paused);
            return paused;
        }),
        delete: vi.fn(async (id: string) => { rows.delete(id); }),
        run: vi.fn(async (_id: string) => {})
    };
    const mastra = { schedules, __shuttingDown: false } as unknown as Mastra;
    return { rows, schedules, mastra };
}

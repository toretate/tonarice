import { z } from 'zod';
import { scheduledPromptTaskInputSchema } from '../../types/scheduled-prompt-task';

const id = z.uuid();
const date = z.iso.datetime({ precision: 3 });
const finishedStatuses = ['success', 'failed', 'skipped'] as const;

export const legacyStoreSchema = z.object({
    tasks: z.array(scheduledPromptTaskInputSchema.extend({
        id,
        createdAt: date,
        updatedAt: date,
        nextRunAt: date,
        lastRunAt: date.optional(),
        lastStatus: z.enum(finishedStatuses).optional()
    })).max(10_000),
    runs: z.array(z.object({
        id,
        taskId: id,
        taskName: z.string().min(1).max(100),
        trigger: z.enum(['scheduled', 'manual']),
        scheduledAt: date,
        startedAt: date,
        finishedAt: date.optional(),
        status: z.enum(['running', ...finishedStatuses]),
        resultText: z.string().optional(),
        errorCode: z.string().max(100).optional(),
        errorMessage: z.string().optional()
    })).max(1_000)
});

export type LegacyStore = z.infer<typeof legacyStoreSchema>;

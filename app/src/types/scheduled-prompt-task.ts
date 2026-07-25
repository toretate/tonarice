import { z } from 'zod';

export type ConversationKind = 'chat' | 'cowork';

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const scheduleRuleSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('interval'),
        intervalMinutes: z.number().int().min(15).max(525_600)
    }),
    z.object({
        type: z.literal('hourly'),
        intervalHours: z.number().int().min(1).max(8_760),
        minute: z.number().int().min(0).max(59)
    }),
    z.object({
        type: z.literal('daily'),
        intervalDays: z.number().int().min(1).max(365),
        time: z.string().regex(timePattern)
    }),
    z.object({
        type: z.literal('weekly'),
        intervalWeeks: z.number().int().min(1).max(52),
        weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
            .refine((weekdays) => new Set(weekdays).size === weekdays.length, {
                message: '曜日を重複して指定することはできません。'
            }),
        time: z.string().regex(timePattern)
    })
]);

export type ScheduleRule = z.infer<typeof scheduleRuleSchema>;

export const scheduledPromptTaskInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(1).max(20_000),
    schedule: scheduleRuleSchema,
    timeZone: z.string().min(1).refine((timeZone) => {
        try {
            new Intl.DateTimeFormat('ja-JP', { timeZone }).format();
            return true;
        } catch {
            return false;
        }
    }, {
        message: '有効な IANA タイムゾーンを指定してください。'
    }),
    enabled: z.boolean()
});

export type ScheduledPromptTaskInput = z.infer<typeof scheduledPromptTaskInputSchema>;

export interface ScheduledPromptTask extends ScheduledPromptTaskInput {
    id: string;
    nextRunAt: string;
    lastRunAt?: string;
    lastStatus?: 'success' | 'failed' | 'skipped';
    createdAt: string;
    updatedAt: string;
}

export interface ScheduledPromptRun {
    id: string;
    taskId: string;
    taskName: string;
    trigger: 'scheduled' | 'manual';
    scheduledAt: string;
    startedAt: string;
    finishedAt?: string;
    status: 'running' | 'success' | 'failed' | 'skipped';
    resultText?: string;
    errorCode?: string;
    errorMessage?: string;
}

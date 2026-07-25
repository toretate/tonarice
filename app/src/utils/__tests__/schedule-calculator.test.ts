import { describe, expect, it } from 'vitest';
import {
    calculateNextRunAt
} from '../schedule-calculator';
import {
    scheduleRuleSchema,
    scheduledPromptTaskInputSchema
} from '../../types/scheduled-prompt-task';

describe('calculateNextRunAt', () => {
    it('calculateNextRunAt_指定間隔後の日時を返す', () => {
        const next = calculateNextRunAt(
            { type: 'interval', intervalMinutes: 15 },
            'Asia/Tokyo',
            { after: new Date('2026-07-24T00:00:00.000Z') }
        );

        expect(next.toISOString()).toBe('2026-07-24T00:15:00.000Z');
    });

    it('calculateNextRunAt_日本時間の次の日次時刻を返す', () => {
        const next = calculateNextRunAt(
            { type: 'daily', intervalDays: 1, time: '09:30' },
            'Asia/Tokyo',
            { after: new Date('2026-07-24T00:29:00.000Z') }
        );

        expect(next.toISOString()).toBe('2026-07-24T00:30:00.000Z');
    });

    it('calculateNextRunAt_当日の時刻を過ぎた場合は翌日を返す', () => {
        const next = calculateNextRunAt(
            { type: 'daily', intervalDays: 1, time: '09:30' },
            'Asia/Tokyo',
            { after: new Date('2026-07-24T00:31:00.000Z') }
        );

        expect(next.toISOString()).toBe('2026-07-25T00:30:00.000Z');
    });

    it('calculateNextRunAt_週次の指定曜日を返す', () => {
        const next = calculateNextRunAt(
            { type: 'weekly', intervalWeeks: 1, weekdays: [1, 3, 5], time: '08:00' },
            'Asia/Tokyo',
            { after: new Date('2026-07-23T23:30:00.000Z') }
        );

        expect(next.toISOString()).toBe('2026-07-26T23:00:00.000Z');
    });

    it('calculateNextRunAt_隔週の基準週を維持する', () => {
        const next = calculateNextRunAt(
            { type: 'weekly', intervalWeeks: 2, weekdays: [1], time: '09:00' },
            'Asia/Tokyo',
            {
                anchor: new Date('2026-07-20T00:00:00.000Z'),
                after: new Date('2026-07-20T01:00:00.000Z')
            }
        );

        expect(next.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    });

    it('calculateNextRunAt_毎時の分指定と間隔を維持する', () => {
        const next = calculateNextRunAt(
            { type: 'hourly', intervalHours: 2, minute: 15 },
            'Asia/Tokyo',
            {
                anchor: new Date('2026-07-24T00:00:00.000Z'),
                after: new Date('2026-07-24T01:30:00.000Z')
            }
        );

        expect(next.toISOString()).toBe('2026-07-24T02:15:00.000Z');
    });

    it('calculateNextRunAt_夏時間開始後も指定した現地時刻を維持する', () => {
        const next = calculateNextRunAt(
            { type: 'daily', intervalDays: 1, time: '09:00' },
            'America/New_York',
            { after: new Date('2026-03-08T12:00:00.000Z') }
        );

        expect(next.toISOString()).toBe('2026-03-08T13:00:00.000Z');
    });
});

describe('scheduleRuleSchema', () => {
    it('scheduleRuleSchema_15分未満の指定間隔を拒否する', () => {
        const result = scheduleRuleSchema.safeParse({
            type: 'interval',
            intervalMinutes: 14
        });

        expect(result.success).toBe(false);
    });

    it('scheduleRuleSchema_重複した曜日を拒否する', () => {
        const result = scheduleRuleSchema.safeParse({
            type: 'weekly',
            intervalWeeks: 1,
            weekdays: [1, 1],
            time: '09:00'
        });

        expect(result.success).toBe(false);
    });
});

describe('scheduledPromptTaskInputSchema', () => {
    it('scheduledPromptTaskInputSchema_不正なタイムゾーンを拒否する', () => {
        const result = scheduledPromptTaskInputSchema.safeParse({
            name: '朝の確認',
            prompt: '今日の予定を確認してください。',
            schedule: {
                type: 'daily',
                intervalDays: 1,
                time: '09:00'
            },
            timeZone: 'Invalid/TimeZone',
            enabled: true
        });

        expect(result.success).toBe(false);
    });
});

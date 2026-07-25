import type { ScheduleRule } from '../types/scheduled-prompt-task';

interface LocalDateTime {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const DAY_MILLISECONDS = 86_400_000;
const HOUR_MILLISECONDS = 3_600_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (timeZone: string) => {
    const cached = formatterCache.get(timeZone);
    if (cached) return cached;

    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });
    formatterCache.set(timeZone, formatter);
    return formatter;
};

const toLocalDateTime = (instant: Date, timeZone: string): LocalDateTime => {
    const parts = getFormatter(timeZone).formatToParts(instant);
    const values = Object.fromEntries(
        parts
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, Number(part.value)])
    );

    return {
        year: values.year,
        month: values.month,
        day: values.day,
        hour: values.hour,
        minute: values.minute,
        second: values.second
    };
};

const localDateTimeToNumber = (local: LocalDateTime) => Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second
);

const fromLocalDateTime = (local: LocalDateTime, timeZone: string) => {
    const intendedTime = localDateTimeToNumber(local);
    let candidate = new Date(intendedTime);

    // タイムゾーンのオフセットを反復補正し、現地時刻に対応する UTC 時刻を求める。
    for (let attempt = 0; attempt < 4; attempt++) {
        const actualLocal = toLocalDateTime(candidate, timeZone);
        const difference = intendedTime - localDateTimeToNumber(actualLocal);
        if (difference === 0) return candidate;
        candidate = new Date(candidate.getTime() + difference);
    }

    return candidate;
};

const addLocalDays = (local: LocalDateTime, days: number): LocalDateTime => {
    const shifted = new Date(localDateTimeToNumber(local) + days * DAY_MILLISECONDS);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        second: shifted.getUTCSeconds()
    };
};

const parseTime = (time: string) => {
    const [hour, minute] = time.split(':').map(Number);
    return { hour, minute };
};

const localDateSerial = (local: LocalDateTime) => Date.UTC(
    local.year,
    local.month - 1,
    local.day
);

const localDayDifference = (from: LocalDateTime, to: LocalDateTime) =>
    Math.floor((localDateSerial(to) - localDateSerial(from)) / DAY_MILLISECONDS);

const localHourDifference = (from: LocalDateTime, to: LocalDateTime) => {
    const fromHour = localDateSerial(from) + from.hour * HOUR_MILLISECONDS;
    const toHour = localDateSerial(to) + to.hour * HOUR_MILLISECONDS;
    return Math.floor((toHour - fromHour) / HOUR_MILLISECONDS);
};

const getWeekday = (local: LocalDateTime) =>
    new Date(localDateSerial(local)).getUTCDay();

const createLocalCandidate = (
    local: LocalDateTime,
    hour: number,
    minute: number
): LocalDateTime => ({
    year: local.year,
    month: local.month,
    day: local.day,
    hour,
    minute,
    second: 0
});

const calculateHourlyRun = (
    schedule: Extract<ScheduleRule, { type: 'hourly' }>,
    timeZone: string,
    after: Date,
    anchor: Date
) => {
    const anchorLocal = toLocalDateTime(anchor, timeZone);
    let candidateLocal = toLocalDateTime(after, timeZone);
    candidateLocal = createLocalCandidate(candidateLocal, candidateLocal.hour, schedule.minute);

    for (let offset = 0; offset <= schedule.intervalHours + 24; offset++) {
        if (offset > 0) {
            const shifted = new Date(localDateTimeToNumber(candidateLocal) + HOUR_MILLISECONDS);
            candidateLocal = {
                year: shifted.getUTCFullYear(),
                month: shifted.getUTCMonth() + 1,
                day: shifted.getUTCDate(),
                hour: shifted.getUTCHours(),
                minute: schedule.minute,
                second: 0
            };
        }

        const elapsedHours = localHourDifference(anchorLocal, candidateLocal);
        if (elapsedHours < 0 || elapsedHours % schedule.intervalHours !== 0) continue;

        const candidate = fromLocalDateTime(candidateLocal, timeZone);
        if (candidate.getTime() > after.getTime()) return candidate;
    }

    throw new Error('次回の毎時スケジュールを計算できませんでした。');
};

const calculateDailyRun = (
    schedule: Extract<ScheduleRule, { type: 'daily' }>,
    timeZone: string,
    after: Date,
    anchor: Date
) => {
    const anchorLocal = toLocalDateTime(anchor, timeZone);
    const afterLocal = toLocalDateTime(after, timeZone);
    const { hour, minute } = parseTime(schedule.time);

    for (let offset = 0; offset <= schedule.intervalDays + 366; offset++) {
        const date = addLocalDays(afterLocal, offset);
        const elapsedDays = localDayDifference(anchorLocal, date);
        if (elapsedDays < 0 || elapsedDays % schedule.intervalDays !== 0) continue;

        const candidate = fromLocalDateTime(
            createLocalCandidate(date, hour, minute),
            timeZone
        );
        if (candidate.getTime() > after.getTime()) return candidate;
    }

    throw new Error('次回の日次スケジュールを計算できませんでした。');
};

const calculateWeeklyRun = (
    schedule: Extract<ScheduleRule, { type: 'weekly' }>,
    timeZone: string,
    after: Date,
    anchor: Date
) => {
    const anchorLocal = toLocalDateTime(anchor, timeZone);
    const afterLocal = toLocalDateTime(after, timeZone);
    const { hour, minute } = parseTime(schedule.time);
    const maximumDays = schedule.intervalWeeks * 7 + 14;

    for (let offset = 0; offset <= maximumDays; offset++) {
        const date = addLocalDays(afterLocal, offset);
        const elapsedDays = localDayDifference(anchorLocal, date);
        const elapsedWeeks = Math.floor(elapsedDays / 7);
        if (elapsedWeeks < 0 || elapsedWeeks % schedule.intervalWeeks !== 0) continue;
        if (!schedule.weekdays.includes(getWeekday(date))) continue;

        const candidate = fromLocalDateTime(
            createLocalCandidate(date, hour, minute),
            timeZone
        );
        if (candidate.getTime() > after.getTime()) return candidate;
    }

    throw new Error('次回の週次スケジュールを計算できませんでした。');
};

export interface CalculateNextRunOptions {
    after: Date;
    anchor?: Date;
}

export const calculateNextRunAt = (
    schedule: ScheduleRule,
    timeZone: string,
    options: CalculateNextRunOptions
) => {
    const { after } = options;
    const anchor = options.anchor ?? after;

    if (!Number.isFinite(after.getTime()) || !Number.isFinite(anchor.getTime())) {
        throw new TypeError('有効な基準日時を指定してください。');
    }

    // 不正なタイムゾーンは Intl から RangeError を発生させる。
    getFormatter(timeZone).format(after);

    switch (schedule.type) {
        case 'interval':
            return new Date(after.getTime() + schedule.intervalMinutes * 60_000);
        case 'hourly':
            return calculateHourlyRun(schedule, timeZone, after, anchor);
        case 'daily':
            return calculateDailyRun(schedule, timeZone, after, anchor);
        case 'weekly':
            return calculateWeeklyRun(schedule, timeZone, after, anchor);
    }
};

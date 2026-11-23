import cronstrue from 'cronstrue';
import { t } from '../i18n.ts';

/**
 * Client-side helpers for the EventBridge-style schedule strings stored on
 * Layer Incoming configs - `rate(<frequency> <unit>)` or `cron(<expression>)`.
 * Mirrors the validation rules of the API's common/schedule.ts
 */

export type ScheduleUnit = 'second' | 'minute' | 'hour' | 'day';

export const SCHEDULE_UNITS: ScheduleUnit[] = ['second', 'minute', 'hour', 'day'];

export interface ScheduleRate {
    freq: number;
    unit: ScheduleUnit;
}

export function isRate(schedule: string): boolean {
    return schedule.trim().startsWith('rate(');
}

export function isCron(schedule: string): boolean {
    return schedule.trim().startsWith('cron(');
}

export function parseRate(schedule: string): ScheduleRate | null {
    if (!isRate(schedule)) return null;

    const parts = schedule
        .trim()
        .replace(/^rate\(/, '')
        .replace(/\)$/, '')
        .trim()
        .split(' ');

    if (parts.length !== 2) return null;

    const freq = parseInt(parts[0]);
    if (isNaN(freq) || freq < 1) return null;

    // AWS rejects mismatched pluralization - rate(1 minutes) and rate(5 minute)
    if (freq === 1 && parts[1].endsWith('s')) return null;
    if (freq > 1 && !parts[1].endsWith('s')) return null;

    const unit = parts[1].replace(/s$/, '') as ScheduleUnit;
    if (!SCHEDULE_UNITS.includes(unit)) return null;

    return { freq, unit };
}

/**
 * AWS went to grammar school - rate(1 minutes) and rate(5 minute) are both
 * rejected, so pluralization is derived from the frequency
 */
export function serializeRate(rate: ScheduleRate): string {
    return `rate(${rate.freq} ${rate.unit}${rate.freq === 1 ? '' : 's'})`;
}

/** Extract the inner expression from a cron(...) schedule */
export function cronExpression(schedule: string): string {
    return schedule
        .trim()
        .replace(/^cron\(/, '')
        .replace(/\)$/, '')
        .trim();
}

export function serializeCron(expression: string): string {
    return `cron(${expression.trim()})`;
}

/** Return an error message for an invalid 6-field EventBridge cron expression or null if valid */
export function validateCronExpression(expression: string): string | null {
    const fields = expression.trim().split(/\s+/).filter((field) => field.length);

    if (fields.length !== 6) {
        return t('messages.schedule.cronFields');
    }

    // EventBridge cannot resolve both day fields - one of the two must defer with ?
    if (fields[2] !== '?' && fields[4] !== '?') {
        return t('messages.schedule.cronDayField');
    }

    try {
        cronstrue.toString(expression);
    } catch (err) {
        // cronstrue throws plain strings
        return String(err).replace(/^Error: /, '');
    }

    return null;
}

/** Return an error message for an invalid schedule or null if valid */
export function validateSchedule(schedule?: string | null): string | null {
    if (!schedule || !schedule.trim().length) {
        return t('messages.schedule.empty');
    } else if (isCron(schedule)) {
        return validateCronExpression(cronExpression(schedule));
    } else if (isRate(schedule)) {
        if (!parseRate(schedule)) {
            return t('messages.schedule.rateFormat');
        }
        return null;
    } else {
        return t('messages.schedule.unknownType');
    }
}

/** Translated unit name in the grammatical form that fits the given count (one / few / many) */
export function scheduleUnitLabel(unit: ScheduleUnit, count: number): string {
    const lastDigit = count % 10;
    const lastTwo = count % 100;
    let form = 'many';
    if (count === 1) form = 'one';
    else if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) form = 'few';
    return t(`messages.schedule.unit_${unit}_${form}`);
}

/** Human readable description of a schedule - empty string if the schedule is invalid */
export function describeSchedule(schedule?: string | null): string {
    if (!schedule || validateSchedule(schedule)) return '';

    if (isRate(schedule)) {
        const rate = parseRate(schedule);
        if (!rate) return '';
        return rate.freq === 1
            ? t('messages.schedule.runsEveryOne', { unit: scheduleUnitLabel(rate.unit, rate.freq) })
            : t('messages.schedule.runsEvery', { count: rate.freq, unit: scheduleUnitLabel(rate.unit, rate.freq) });
    } else {
        try {
            return cronstrue.toString(cronExpression(schedule));
        } catch {
            return '';
        }
    }
}

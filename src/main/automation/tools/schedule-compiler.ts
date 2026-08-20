import type { AutomationTrigger } from '../../../shared/automation/types';
import { computeNextAutomationRunAt, normalizeAutomationTrigger } from '../automation-trigger';
import type { AutomationToolScheduleInput, AutomationWeekdayName } from './contract';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339_WITH_ZONE_PATTERN = /T.+(?:Z|[+-]\d{2}:\d{2})$/i;

const WEEKDAY_NUMBER: Record<AutomationWeekdayName, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const WEEKDAY_LABEL: Record<number, string> = {
  0: '周日',
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
};

export interface CompiledAutomationSchedule {
  trigger: AutomationTrigger;
  timezone: string;
  summary: string;
  nextRuns: Array<{ at: number; text: string }>;
}

export interface AutomationScheduleCompilerOptions {
  now?: number;
  systemTimezone?: string;
  nextRunCount?: number;
}

export function compileAutomationSchedule(
  input: AutomationToolScheduleInput,
  options: AutomationScheduleCompilerOptions = {}
): CompiledAutomationSchedule {
  const now = options.now ?? Date.now();
  const systemTimezone = canonicalizeTimezone(
    options.systemTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  );
  const timezone = resolveSupportedTimezone(input.timezone, systemTimezone);
  const trigger = normalizeAutomationTrigger(buildTrigger(input, timezone));
  const nextRuns = computeNextRuns(trigger, now, options.nextRunCount ?? 3).map((at) => ({
    at,
    text: formatTimestamp(at, timezone),
  }));
  if (nextRuns.length === 0) {
    throw new Error('The schedule has no future execution time.');
  }
  return {
    trigger,
    timezone,
    summary: formatAutomationTrigger(trigger),
    nextRuns,
  };
}

export function formatAutomationTrigger(trigger: AutomationTrigger): string {
  if (trigger.kind === 'manual') return `手动执行（${trigger.timezone}）`;
  if (trigger.kind === 'file_change') return `文件变更时执行（${trigger.timezone}）`;
  if (trigger.kind === 'once') {
    return `单次：${formatTimestamp(trigger.runAt, trigger.timezone)}（${trigger.timezone}）`;
  }
  if (trigger.kind === 'interval') {
    const unit = trigger.unit === 'minute' ? '分钟' : trigger.unit === 'hour' ? '小时' : '天';
    return `每 ${trigger.every} ${unit}执行，从 ${formatTimestamp(trigger.startAt, trigger.timezone)} 开始（${trigger.timezone}）`;
  }
  if (trigger.kind === 'daily') {
    return `每天 ${trigger.times.join('、')}（${trigger.timezone}）`;
  }
  if (trigger.kind === 'weekly') {
    return `每${trigger.weekdays.map((day) => WEEKDAY_LABEL[day]).join('、')} ${trigger.times.join('、')}（${trigger.timezone}）`;
  }
  if (trigger.kind === 'monthly') {
    const days = [
      ...trigger.daysOfMonth.map((day) => `${day} 日`),
      ...(trigger.includeLastDay ? ['最后一天'] : []),
    ];
    return `每月 ${days.join('、')} ${trigger.times.join('、')}（${trigger.timezone}）`;
  }
  return `Cron ${trigger.expression}（${trigger.timezone}）`;
}

export function formatTimestamp(value: number, timezone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function buildTrigger(input: AutomationToolScheduleInput, timezone: string): AutomationTrigger {
  if (input.kind === 'once') {
    return { kind: 'once', runAt: parseInstant(input.runAt, 'runAt'), timezone };
  }
  if (input.kind === 'interval') {
    if (!Number.isInteger(input.every) || input.every < 1) {
      throw new Error('Interval every must be a positive integer.');
    }
    return {
      kind: 'interval',
      every: input.every,
      unit: input.unit,
      startAt: parseInstant(input.startAt, 'startAt'),
      endAt: input.endAt ? parseInstant(input.endAt, 'endAt') : null,
      timezone,
    };
  }

  const times = validateTimes(input.times);
  const { startAt, endAt } = parseDateRange(input.startDate, input.endDate);
  if (input.kind === 'daily') {
    return { kind: 'daily', times, startAt, endAt, timezone };
  }
  if (input.kind === 'weekly') {
    if (!Array.isArray(input.weekdays) || input.weekdays.length === 0) {
      throw new Error('Weekly schedule requires at least one weekday.');
    }
    const weekdays = Array.from(
      new Set(
        input.weekdays.map((weekday) => {
          const value = WEEKDAY_NUMBER[weekday];
          if (value === undefined) throw new Error(`Unsupported weekday: ${weekday}`);
          return value;
        })
      )
    ).sort((left, right) => left - right);
    return { kind: 'weekly', weekdays, times, startAt, endAt, timezone };
  }
  if (!Array.isArray(input.daysOfMonth)) {
    throw new Error('Monthly schedule requires daysOfMonth.');
  }
  const daysOfMonth = Array.from(new Set(input.daysOfMonth));
  if (daysOfMonth.some((day) => !Number.isInteger(day) || day < 1 || day > 31)) {
    throw new Error('Monthly daysOfMonth must contain integers from 1 to 31.');
  }
  if (daysOfMonth.length === 0 && input.includeLastDay !== true) {
    throw new Error('Monthly schedule requires a day of month or includeLastDay=true.');
  }
  return {
    kind: 'monthly',
    daysOfMonth: daysOfMonth.sort((left, right) => left - right),
    includeLastDay: input.includeLastDay === true,
    times,
    startAt,
    endAt,
    timezone,
  };
}

function validateTimes(times: string[]): string[] {
  if (!Array.isArray(times) || times.length === 0) {
    throw new Error('A recurring schedule requires at least one execution time.');
  }
  const normalized = Array.from(new Set(times.map((time) => time.trim()))).sort();
  const invalid = normalized.find((time) => !TIME_PATTERN.test(time));
  if (invalid) throw new Error(`Invalid execution time: ${invalid}. Use HH:mm.`);
  return normalized;
}

function parseDateRange(
  startDate: string | undefined,
  endDate: string | undefined
): { startAt: number | null; endAt: number | null } {
  const startAt = startDate ? parseLocalDate(startDate, false) : null;
  const endAt = endDate ? parseLocalDate(endDate, true) : null;
  if (startAt !== null && endAt !== null && endAt <= startAt) {
    throw new Error('Schedule endDate must be later than startDate.');
  }
  return { startAt, endAt };
}

function parseLocalDate(value: string, endOfDay: boolean): number {
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) throw new Error(`Invalid date: ${value}. Use YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`Invalid calendar date: ${value}.`);
  }
  return date.getTime();
}

function parseInstant(value: string, field: string): number {
  const normalized = value.trim();
  if (!RFC3339_WITH_ZONE_PATTERN.test(normalized)) {
    throw new Error(`${field} must be RFC3339 with an explicit timezone offset.`);
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ${field}: ${value}`);
  return timestamp;
}

function resolveSupportedTimezone(value: string | undefined, systemTimezone: string): string {
  const requested = canonicalizeTimezone(value?.trim() || systemTimezone);
  if (requested !== systemTimezone) {
    throw new Error(
      `This version can only schedule in the system timezone ${systemTimezone}; received ${requested}.`
    );
  }
  return requested;
}

function canonicalizeTimezone(value: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`Invalid IANA timezone: ${value}`);
  }
}

function computeNextRuns(trigger: AutomationTrigger, now: number, count: number): number[] {
  const results: number[] = [];
  let cursor = now;
  const limit = Math.max(1, Math.min(10, Math.floor(count)));
  for (let index = 0; index < limit; index += 1) {
    const next = computeNextAutomationRunAt(trigger, cursor);
    if (next === null || results.includes(next)) break;
    results.push(next);
    cursor = next + 1;
  }
  return results;
}

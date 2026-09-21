import type {
  AutomationTrigger,
  AutomationTriggerCron,
  AutomationTriggerDaily,
  AutomationTriggerFileChange,
  AutomationTriggerInterval,
  AutomationTriggerManual,
  AutomationTriggerMonthly,
  AutomationTriggerOnce,
  AutomationTriggerWeekly,
} from '../../shared/automation/types';

import { Cron } from 'croner';
import { calendarCronPatterns } from '../schedule/calendar-schedule';

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeAutomationTrigger(trigger: AutomationTrigger): AutomationTrigger {
  if (trigger.kind === 'manual') {
    return normalizeManualTrigger(trigger);
  }
  if (trigger.kind === 'interval') {
    return normalizeIntervalTrigger(trigger);
  }
  if (trigger.kind === 'daily') {
    return normalizeDailyTrigger(trigger);
  }
  if (trigger.kind === 'weekly') {
    return normalizeWeeklyTrigger(trigger);
  }
  if (trigger.kind === 'monthly') {
    return normalizeMonthlyTrigger(trigger);
  }
  if (trigger.kind === 'cron') {
    return normalizeCronTrigger(trigger);
  }
  if (trigger.kind === 'file_change') {
    return normalizeFileChangeTrigger(trigger);
  }
  return normalizeOnceTrigger(trigger);
}

export function computeNextAutomationRunAt(
  trigger: AutomationTrigger,
  now: number = Date.now()
): number | null {
  if (trigger.kind === 'manual') {
    return null;
  }
  if (trigger.kind === 'once') {
    return trigger.runAt > now ? trigger.runAt : null;
  }
  if (trigger.kind === 'interval') {
    return computeNextIntervalRunAt(trigger, now);
  }
  if (trigger.kind === 'daily') {
    return nextCalendarRun(trigger, now);
  }
  if (trigger.kind === 'weekly') {
    return nextCalendarRun(trigger, now);
  }
  if (trigger.kind === 'monthly') {
    return nextCalendarRun(trigger, now);
  }
  if (trigger.kind === 'file_change') {
    return null;
  }
  return nextCalendarRun(trigger, now);
}

function normalizeManualTrigger(trigger: AutomationTriggerManual): AutomationTriggerManual {
  return {
    kind: 'manual',
    timezone: normalizeTimezone(trigger.timezone),
  };
}

function normalizeOnceTrigger(trigger: AutomationTriggerOnce): AutomationTriggerOnce {
  return {
    kind: 'once',
    runAt: normalizeTimestamp(trigger.runAt, Date.now() + 5 * 60 * 1000),
    timezone: normalizeTimezone(trigger.timezone),
  };
}

function normalizeIntervalTrigger(trigger: AutomationTriggerInterval): AutomationTriggerInterval {
  const every = Number.isFinite(trigger.every) ? Math.max(1, Math.floor(trigger.every)) : 1;
  const unit =
    trigger.unit === 'minute' || trigger.unit === 'hour' || trigger.unit === 'day'
      ? trigger.unit
      : 'day';
  const startAt = normalizeTimestamp(trigger.startAt, Date.now());
  const endAt =
    trigger.endAt === null || trigger.endAt === undefined
      ? null
      : normalizeTimestamp(trigger.endAt, 0);
  if (endAt !== null && endAt <= startAt) {
    throw new Error('Interval schedule end time must be later than start time.');
  }
  return {
    kind: 'interval',
    every,
    unit,
    startAt,
    endAt,
    timezone: normalizeTimezone(trigger.timezone),
  };
}

function normalizeDailyTrigger(trigger: AutomationTriggerDaily): AutomationTriggerDaily {
  return {
    kind: 'daily',
    times: normalizeTimes(trigger.times),
    startAt: normalizeOptionalTimestamp(trigger.startAt),
    endAt: normalizeOptionalTimestamp(trigger.endAt),
    timezone: normalizeTimezone(trigger.timezone),
  };
}

function normalizeWeeklyTrigger(trigger: AutomationTriggerWeekly): AutomationTriggerWeekly {
  return {
    kind: 'weekly',
    weekdays: normalizeWeekdays(trigger.weekdays),
    times: normalizeTimes(trigger.times),
    startAt: normalizeOptionalTimestamp(trigger.startAt),
    endAt: normalizeOptionalTimestamp(trigger.endAt),
    timezone: normalizeTimezone(trigger.timezone),
  };
}

function normalizeMonthlyTrigger(trigger: AutomationTriggerMonthly): AutomationTriggerMonthly {
  return {
    kind: 'monthly',
    daysOfMonth: normalizeDaysOfMonth(trigger.daysOfMonth),
    includeLastDay: trigger.includeLastDay === true,
    times: normalizeTimes(trigger.times),
    startAt: normalizeOptionalTimestamp(trigger.startAt),
    endAt: normalizeOptionalTimestamp(trigger.endAt),
    timezone: normalizeTimezone(trigger.timezone),
  };
}

function normalizeCronTrigger(trigger: AutomationTriggerCron): AutomationTriggerCron {
  const job = new Cron(trigger.expression.trim(), {
    paused: true,
    timezone: normalizeTimezone(trigger.timezone),
  });
  job.stop();
  return {
    kind: 'cron',
    expression: trigger.expression.trim(),
    startAt: normalizeOptionalTimestamp(trigger.startAt),
    endAt: normalizeOptionalTimestamp(trigger.endAt),
    timezone: normalizeTimezone(trigger.timezone),
  };
}

function normalizeFileChangeTrigger(
  trigger: AutomationTriggerFileChange
): AutomationTriggerFileChange {
  return {
    kind: 'file_change',
    projectId:
      typeof trigger.projectId === 'string' && trigger.projectId.trim()
        ? trigger.projectId.trim()
        : null,
    patterns: normalizeFilePatterns(trigger.patterns),
    debounceMs:
      Number.isFinite(trigger.debounceMs) && trigger.debounceMs > 0
        ? Math.max(500, Math.floor(trigger.debounceMs))
        : 30_000,
    timezone: normalizeTimezone(trigger.timezone),
  };
}

function computeNextIntervalRunAt(trigger: AutomationTriggerInterval, now: number): number | null {
  if (trigger.endAt && now >= trigger.endAt) return null;
  const intervalMs = getIntervalMs(trigger.every, trigger.unit);
  const base = Math.max(trigger.startAt, trigger.startAt || now);
  if (base > now) {
    return withinEnd(base, trigger.endAt);
  }
  const skipped = Math.floor((now - base) / intervalMs) + 1;
  return withinEnd(base + skipped * intervalMs, trigger.endAt);
}

function getIntervalMs(every: number, unit: AutomationTriggerInterval['unit']): number {
  if (unit === 'minute') return every * 60 * 1000;
  if (unit === 'hour') return every * 60 * 60 * 1000;
  return every * DAY_MS;
}

function nextCalendarRun(
  trigger:
    | AutomationTriggerDaily
    | AutomationTriggerWeekly
    | AutomationTriggerMonthly
    | AutomationTriggerCron,
  now: number
): number | null {
  const patterns = trigger.kind === 'cron' ? [trigger.expression] : calendarCronPatterns(trigger);
  const after = new Date(Math.max(now, (trigger.startAt ?? now) - 1));
  const candidates = patterns.flatMap((pattern) => {
    const job = new Cron(pattern, { paused: true, timezone: trigger.timezone });
    try {
      const next = job.nextRun(after)?.getTime();
      return next === undefined ? [] : [next];
    } finally {
      job.stop();
    }
  });
  return candidates.length ? withinEnd(Math.min(...candidates), trigger.endAt) : null;
}

function withinEnd(value: number, endAt?: number | null): number | null {
  if (endAt && value > endAt) return null;
  return value;
}

function normalizeTimes(times: string[]): string[] {
  if (!Array.isArray(times)) return [];
  return Array.from(
    new Set(times.filter((time) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(time)))
  ).sort();
}

function normalizeWeekdays(days: number[]): Array<0 | 1 | 2 | 3 | 4 | 5 | 6> {
  if (!Array.isArray(days)) return [];
  return Array.from(
    new Set(
      days.filter(
        (day): day is 0 | 1 | 2 | 3 | 4 | 5 | 6 => Number.isInteger(day) && day >= 0 && day <= 6
      )
    )
  ).sort((left, right) => left - right);
}

function normalizeDaysOfMonth(days: number[]): number[] {
  if (!Array.isArray(days)) return [];
  return Array.from(
    new Set(days.filter((day) => Number.isInteger(day) && day >= 1 && day <= 31))
  ).sort((left, right) => left - right);
}

function normalizeFilePatterns(patterns: string[]): string[] {
  if (!Array.isArray(patterns)) return ['**/*'];
  const normalized = patterns.map((pattern) => pattern.trim()).filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ['**/*'];
}

function normalizeTimestamp(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function normalizeOptionalTimestamp(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return normalizeTimestamp(value, 0);
}

function normalizeTimezone(value: string): string {
  return value?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

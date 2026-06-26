import type {
  AutomationTrigger,
  AutomationTriggerCron,
  AutomationTriggerDaily,
  AutomationTriggerFileChange,
  AutomationTriggerInterval,
  AutomationTriggerManual,
  AutomationTriggerOnce,
  AutomationTriggerWeekly,
} from '../../shared/automation/types';

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
    return findNextScheduledSlot(now, trigger.times, undefined, trigger.startAt, trigger.endAt);
  }
  if (trigger.kind === 'weekly') {
    return findNextScheduledSlot(
      now,
      trigger.times,
      trigger.weekdays,
      trigger.startAt,
      trigger.endAt
    );
  }
  if (trigger.kind === 'file_change') {
    return null;
  }
  return computeNextCronRunAt(trigger, now);
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
  return {
    kind: 'interval',
    every,
    unit,
    startAt: normalizeTimestamp(trigger.startAt, Date.now()),
    endAt:
      trigger.endAt === null || trigger.endAt === undefined
        ? null
        : normalizeTimestamp(trigger.endAt, 0),
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

function normalizeCronTrigger(trigger: AutomationTriggerCron): AutomationTriggerCron {
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

function findNextScheduledSlot(
  now: number,
  times: string[],
  weekdays?: number[],
  startAt?: number | null,
  endAt?: number | null
): number | null {
  const normalizedTimes = normalizeTimes(times);
  if (normalizedTimes.length === 0) return null;
  const allowedWeekdays = weekdays ? new Set(normalizeWeekdays(weekdays)) : null;
  const nowDate = new Date(Math.max(now, startAt ?? now));

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const candidateDate = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + dayOffset,
      0,
      0,
      0,
      0
    );
    if (
      allowedWeekdays &&
      !allowedWeekdays.has(candidateDate.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6)
    ) {
      continue;
    }
    for (const time of normalizedTimes) {
      const [hour, minute] = time.split(':').map(Number);
      const candidate = new Date(
        candidateDate.getFullYear(),
        candidateDate.getMonth(),
        candidateDate.getDate(),
        hour,
        minute,
        0,
        0
      ).getTime();
      if (candidate > now && candidate >= (startAt ?? 0)) {
        return withinEnd(candidate, endAt);
      }
    }
  }
  return null;
}

function computeNextCronRunAt(trigger: AutomationTriggerCron, now: number): number | null {
  // Minimal cron support for the first implementation: five fields with minute/hour
  // lists or wildcards. More expressive cron can be swapped in without changing storage.
  const parsed = parseSimpleCron(trigger.expression);
  if (!parsed) return null;
  const start = Math.max(now + 60 * 1000, trigger.startAt ?? now);
  for (let cursor = start; cursor <= start + 366 * DAY_MS; cursor += 60 * 1000) {
    const date = new Date(cursor);
    if (
      parsed.minutes.has(date.getMinutes()) &&
      parsed.hours.has(date.getHours()) &&
      parsed.daysOfMonth.has(date.getDate()) &&
      parsed.months.has(date.getMonth() + 1) &&
      parsed.weekdays.has(date.getDay())
    ) {
      return withinEnd(
        new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          date.getHours(),
          date.getMinutes(),
          0,
          0
        ).getTime(),
        trigger.endAt
      );
    }
  }
  return null;
}

function parseSimpleCron(expression: string): {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
} | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minutes = parseCronField(fields[0], 0, 59);
  const hours = parseCronField(fields[1], 0, 23);
  const daysOfMonth = parseCronField(fields[2], 1, 31);
  const months = parseCronField(fields[3], 1, 12);
  const weekdays = parseCronField(fields[4], 0, 6);
  if (!minutes || !hours || !daysOfMonth || !months || !weekdays) return null;
  return { minutes, hours, daysOfMonth, months, weekdays };
}

function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  if (field === '*') {
    for (let value = min; value <= max; value += 1) values.add(value);
    return values;
  }
  for (const part of field.split(',')) {
    const value = Number(part);
    if (!Number.isInteger(value) || value < min || value > max) return null;
    values.add(value);
  }
  return values;
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

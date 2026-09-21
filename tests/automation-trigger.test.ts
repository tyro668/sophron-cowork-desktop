import { describe, expect, it } from 'vitest';
import {
  computeNextAutomationRunAt,
  normalizeAutomationTrigger,
} from '../src/main/automation/automation-trigger';

function localTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute);
}

describe('automation trigger calculation', () => {
  it('honors timezone and the next minute rather than skipping a near-future slot', () => {
    const now = Date.parse('2026-06-06T00:59:30Z');
    expect(
      computeNextAutomationRunAt(
        { kind: 'daily', times: ['09:00'], timezone: 'Asia/Shanghai' },
        now
      )
    ).toBe(Date.parse('2026-06-06T01:00:00Z'));
    expect(
      computeNextAutomationRunAt({ kind: 'cron', expression: '0 9 * * *', timezone: 'UTC' }, now)
    ).toBe(Date.parse('2026-06-06T09:00:00Z'));
  });

  it('supports cron steps, ranges, last day and end boundaries', () => {
    const now = Date.parse('2026-06-06T09:14:30Z');
    expect(
      computeNextAutomationRunAt(
        { kind: 'cron', expression: '*/15 9-17 * * *', timezone: 'UTC' },
        now
      )
    ).toBe(Date.parse('2026-06-06T09:15:00Z'));
    expect(
      computeNextAutomationRunAt({ kind: 'cron', expression: '0 9 L * *', timezone: 'UTC' }, now)
    ).toBe(Date.parse('2026-06-30T09:00:00Z'));
    expect(
      computeNextAutomationRunAt(
        { kind: 'daily', times: ['09:15'], timezone: 'UTC', endAt: now },
        now
      )
    ).toBeNull();
    expect(() =>
      normalizeAutomationTrigger({ kind: 'cron', expression: 'invalid', timezone: 'UTC' })
    ).toThrow();
  });

  it('returns a future one-time run and disables overdue one-time runs', () => {
    const now = localTimestamp(2026, 6, 6, 9, 0);
    expect(
      computeNextAutomationRunAt(
        { kind: 'once', runAt: now + 60_000, timezone: 'Asia/Shanghai' },
        now
      )
    ).toBe(now + 60_000);
    expect(
      computeNextAutomationRunAt(
        { kind: 'once', runAt: now - 60_000, timezone: 'Asia/Shanghai' },
        now
      )
    ).toBeNull();
  });

  it('skips missed interval slots from the configured start time', () => {
    const startAt = localTimestamp(2026, 6, 6, 8, 0);
    const now = localTimestamp(2026, 6, 6, 9, 12);
    expect(
      computeNextAutomationRunAt(
        { kind: 'interval', every: 30, unit: 'minute', startAt, timezone: 'Asia/Shanghai' },
        now
      )
    ).toBe(localTimestamp(2026, 6, 6, 9, 30));
  });

  it('rejects interval schedules whose end time is not later than the start time', () => {
    const startAt = localTimestamp(2026, 6, 6, 8, 0);

    expect(() =>
      normalizeAutomationTrigger({
        kind: 'interval',
        every: 1,
        unit: 'day',
        startAt,
        endAt: startAt,
        timezone: 'Asia/Shanghai',
      })
    ).toThrow('Interval schedule end time must be later than start time.');
  });

  it('finds the next daily slot', () => {
    const now = localTimestamp(2026, 6, 6, 9, 12);
    expect(
      computeNextAutomationRunAt(
        { kind: 'daily', times: ['08:00', '10:00'], timezone: 'Asia/Shanghai' },
        now
      )
    ).toBe(localTimestamp(2026, 6, 6, 10, 0));
  });

  it('finds the next weekly slot', () => {
    const saturday = localTimestamp(2026, 6, 6, 9, 12);
    expect(
      computeNextAutomationRunAt(
        { kind: 'weekly', weekdays: [1], times: ['09:00'], timezone: 'Asia/Shanghai' },
        saturday
      )
    ).toBe(localTimestamp(2026, 6, 8, 9, 0));
  });

  it('finds the next monthly slot', () => {
    const now = localTimestamp(2026, 6, 6, 9, 12);
    expect(
      computeNextAutomationRunAt(
        {
          kind: 'monthly',
          daysOfMonth: [6, 15],
          times: ['09:00', '10:00'],
          timezone: 'Asia/Shanghai',
        },
        now
      )
    ).toBe(localTimestamp(2026, 6, 6, 10, 0));
  });

  it('skips monthly dates that do not exist in a month', () => {
    const now = localTimestamp(2026, 2, 1, 0, 0);
    expect(
      computeNextAutomationRunAt(
        {
          kind: 'monthly',
          daysOfMonth: [31],
          times: ['09:00'],
          timezone: 'Asia/Shanghai',
        },
        now
      )
    ).toBe(localTimestamp(2026, 3, 31, 9, 0));
  });

  it('supports monthly last-day schedules', () => {
    const now = localTimestamp(2026, 2, 1, 0, 0);
    expect(
      computeNextAutomationRunAt(
        {
          kind: 'monthly',
          daysOfMonth: [],
          includeLastDay: true,
          times: ['09:00'],
          timezone: 'Asia/Shanghai',
        },
        now
      )
    ).toBe(localTimestamp(2026, 2, 28, 9, 0));
  });

  it('supports simple five-field cron expressions', () => {
    const now = localTimestamp(2026, 6, 6, 9, 12);
    expect(
      computeNextAutomationRunAt(
        { kind: 'cron', expression: '30 9 * * *', timezone: 'Asia/Shanghai' },
        now
      )
    ).toBe(localTimestamp(2026, 6, 6, 9, 30));
  });

  it('normalizes file-change triggers without scheduling a timer slot', () => {
    const trigger = normalizeAutomationTrigger({
      kind: 'file_change',
      projectId: ' project-1 ',
      patterns: [],
      debounceMs: 0,
      timezone: 'Asia/Shanghai',
    });

    expect(trigger).toEqual({
      kind: 'file_change',
      projectId: 'project-1',
      patterns: ['**/*'],
      debounceMs: 30_000,
      timezone: 'Asia/Shanghai',
    });
    expect(computeNextAutomationRunAt(trigger, localTimestamp(2026, 6, 6, 9, 0))).toBeNull();
  });
});

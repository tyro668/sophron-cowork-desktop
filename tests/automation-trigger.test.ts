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
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

describe('automation trigger calculation', () => {
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

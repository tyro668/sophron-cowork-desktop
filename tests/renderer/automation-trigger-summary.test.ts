import { describe, expect, it } from 'vitest';
import i18n from './i18n-test';
import { formatAutomationTriggerSummary } from '../../src/renderer/components/settings/schedule/trigger-summary';

const tz = 'Asia/Shanghai';
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

describe('formatAutomationTriggerSummary', () => {
  it('derives the summary from the saved trigger in zh and en', async () => {
    await i18n.changeLanguage('zh');
    expect(
      formatAutomationTriggerSummary(
        { kind: 'weekly', weekdays: [0, 1], times: ['09:00'], timezone: tz },
        t
      )
    ).toBe('每周一、周日 09:00');
    expect(
      formatAutomationTriggerSummary({ kind: 'daily', times: ['08:00', '20:00'], timezone: tz }, t)
    ).toBe('每天 08:00、20:00');
    expect(
      formatAutomationTriggerSummary(
        {
          kind: 'monthly',
          daysOfMonth: [15, 1],
          includeLastDay: true,
          times: ['07:30'],
          timezone: tz,
        },
        t
      )
    ).toBe('每月 1 日、15 日、最后一天 07:30');
    expect(
      formatAutomationTriggerSummary(
        { kind: 'interval', every: 2, unit: 'hour', startAt: 0, timezone: tz },
        t
      )
    ).toBe('每 2 小时');
    expect(formatAutomationTriggerSummary({ kind: 'manual', timezone: tz }, t)).toBe('手动执行');

    await i18n.changeLanguage('en');
    expect(
      formatAutomationTriggerSummary(
        { kind: 'weekly', weekdays: [1], times: ['09:00'], timezone: tz },
        t
      )
    ).toBe('Every Mon at 09:00');
    await i18n.changeLanguage('zh');
  });
});

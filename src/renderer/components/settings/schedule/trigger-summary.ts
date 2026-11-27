import type { Automation } from '../../../types';
import { formatAppDateTime } from '../../../utils/i18n-format';

type Translate = (key: string, options?: Record<string, unknown>) => string;

const WEEKDAY_KEYS = [
  'schedule.weekdaySunday',
  'schedule.weekdayMonday',
  'schedule.weekdayTuesday',
  'schedule.weekdayWednesday',
  'schedule.weekdayThursday',
  'schedule.weekdayFriday',
  'schedule.weekdaySaturday',
] as const;

const INTERVAL_UNIT_KEYS = {
  minute: 'schedule.triggerSummary.unitMinute',
  hour: 'schedule.triggerSummary.unitHour',
  day: 'schedule.triggerSummary.unitDay',
} as const;

/** Monday-first order, matching the weekday picker. */
function weekdayOrder(day: number): number {
  return day === 0 ? 7 : day;
}

/**
 * Human-readable schedule derived from the saved trigger, so the list never
 * shows a stale schedule from a free-text description.
 */
export function formatAutomationTriggerSummary(
  trigger: Automation['trigger'],
  t: Translate
): string {
  const separator = t('schedule.triggerSummary.listSeparator');
  const join = (items: string[]) => items.join(separator);
  switch (trigger.kind) {
    case 'manual':
      return t('schedule.triggerSummary.manual');
    case 'file_change':
      return t('schedule.triggerSummary.fileChange');
    case 'once':
      return t('schedule.triggerSummary.once', { time: formatAppDateTime(trigger.runAt) });
    case 'interval':
      return t('schedule.triggerSummary.interval', {
        every: trigger.every,
        unit: t(INTERVAL_UNIT_KEYS[trigger.unit]),
      });
    case 'daily':
      return t('schedule.triggerSummary.daily', { times: join(trigger.times) });
    case 'weekly':
      return t('schedule.triggerSummary.weekly', {
        weekdays: join(
          [...trigger.weekdays]
            .sort((a, b) => weekdayOrder(a) - weekdayOrder(b))
            .map((day) => t(WEEKDAY_KEYS[day]))
        ),
        times: join(trigger.times),
      });
    case 'monthly':
      return t('schedule.triggerSummary.monthly', {
        days: join([
          ...[...trigger.daysOfMonth]
            .sort((a, b) => a - b)
            .map((day) => t('schedule.triggerSummary.dayOfMonth', { day })),
          ...(trigger.includeLastDay ? [t('schedule.triggerSummary.lastDay')] : []),
        ]),
        times: join(trigger.times),
      });
    case 'cron':
      return t('schedule.triggerSummary.cron', { expression: trigger.expression });
  }
}

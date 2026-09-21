import { describe, expect, it } from 'vitest';
import { Cron } from 'croner';
import { calendarCronPatterns } from '../src/main/schedule/calendar-schedule';

describe('calendarCronPatterns', () => {
  it('converts a daily schedule into one cron pattern per time', () => {
    expect(calendarCronPatterns({ kind: 'daily', times: ['09:30', '21:05'] })).toEqual([
      '30 9 * * *',
      '5 21 * * *',
    ]);
  });

  it('converts a weekly schedule into a day-of-week list', () => {
    expect(calendarCronPatterns({ kind: 'weekly', weekdays: [1, 3, 5], times: ['08:00'] })).toEqual(
      ['0 8 * * 1,3,5']
    );
  });

  it('converts a monthly schedule into a day-of-month list', () => {
    expect(
      calendarCronPatterns({ kind: 'monthly', daysOfMonth: [1, 15], times: ['08:00'] })
    ).toEqual(['0 8 1,15 * *']);
  });

  it('appends L when the schedule includes the last day of the month', () => {
    expect(
      calendarCronPatterns({
        kind: 'monthly',
        daysOfMonth: [15],
        includeLastDay: true,
        times: ['08:00'],
      })
    ).toEqual(['0 8 15,L * *']);
    expect(
      calendarCronPatterns({
        kind: 'monthly',
        daysOfMonth: [],
        includeLastDay: true,
        times: ['08:00'],
      })
    ).toEqual(['0 8 L * *']);
  });

  it('drops invalid times and yields no pattern when none remain', () => {
    expect(calendarCronPatterns({ kind: 'daily', times: ['25:00', 'bad', '07:15'] })).toEqual([
      '15 7 * * *',
    ]);
    expect(calendarCronPatterns({ kind: 'daily', times: ['25:00'] })).toEqual([]);
    expect(calendarCronPatterns({ kind: 'daily', times: [] })).toEqual([]);
  });

  it('returns no pattern for weekly/monthly schedules without days', () => {
    expect(calendarCronPatterns({ kind: 'weekly', weekdays: [], times: ['08:00'] })).toEqual([]);
    expect(calendarCronPatterns({ kind: 'monthly', daysOfMonth: [], times: ['08:00'] })).toEqual(
      []
    );
  });

  it('produces patterns croner accepts and schedules correctly', () => {
    const weekly = new Cron('0 8 * * 1', { paused: true });
    const weeklyNext = weekly.nextRun();
    expect(weeklyNext?.getDay()).toBe(1);
    expect(weeklyNext?.getHours()).toBe(8);
    weekly.stop();

    const lastDay = new Cron('0 8 L * *', { paused: true });
    const lastDayNext = lastDay.nextRun();
    expect(lastDayNext).not.toBeNull();
    const dayAfter = new Date(lastDayNext!.getTime() + 24 * 60 * 60 * 1000);
    expect(dayAfter.getDate()).toBe(1);
    lastDay.stop();
  });
});

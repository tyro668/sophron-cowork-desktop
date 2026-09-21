import type { ScheduleConfig } from '../../shared/contracts/schedule';

export function calendarCronPatterns(schedule: ScheduleConfig): string[] {
  const times = schedule.times.filter((time) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(time));
  const dayOfMonth =
    schedule.kind === 'monthly'
      ? [...schedule.daysOfMonth.map(String), ...(schedule.includeLastDay ? ['L'] : [])].join(',')
      : '*';
  const dayOfWeek = schedule.kind === 'weekly' ? schedule.weekdays.join(',') : '*';
  if (!dayOfMonth || !dayOfWeek) return [];
  return times.map((time) => {
    const [hour, minute] = time.split(':').map(Number);
    return `${minute} ${hour} ${dayOfMonth} * ${dayOfWeek}`;
  });
}

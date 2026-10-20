import i18n from '../i18n/config';

function getAppLocale(language = i18n.resolvedLanguage || i18n.language): string {
  if (language.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en-US';
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 24-hour clock time, e.g. 13:31. */
export function formatClockTime(value: number | string | Date): string {
  const date = new Date(value);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Canonical app date-time format: YYYY-MM-DD HH:mm (24-hour, locale independent). */
export function formatAppDateTime(value: number | string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${formatClockTime(date)}`;
}

export function formatAppDate(
  value: number | string | Date,
  options?: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat(
    getAppLocale(),
    options || {
      month: 'short',
      day: 'numeric',
    }
  ).format(new Date(value));
}

export function joinAppList(values: string[]): string {
  return values.join(getAppLocale().startsWith('zh') ? '、' : ', ');
}

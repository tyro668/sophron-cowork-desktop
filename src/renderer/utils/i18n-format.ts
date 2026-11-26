import i18n from '../i18n/config';

function getAppLocale(language = i18n.resolvedLanguage || i18n.language): string {
  if (language.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en-US';
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Localized human-readable duration from milliseconds (e.g. "120 ms", "3 s", "2m 5s"). */
export function formatDurationMs(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || Number.isNaN(durationMs)) return '—';
  if (durationMs < 1000) return i18n.t('common.durationMs', { value: durationMs });
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return i18n.t('common.durationSec', { value: seconds });
  return i18n.t('common.durationMinSec', { minutes, seconds });
}

/** Human-readable byte size (B / KB / MB / GB). */
export function formatByteSize(bytes: number | null | undefined, emptyFallback = '—'): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes) || bytes < 0) {
    return emptyFallback;
  }
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
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

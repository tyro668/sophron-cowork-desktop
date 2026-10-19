import type { TFunction } from 'i18next';

const CSV_DECODE_ERROR_PATTERN =
  /DATA_CSV_ENCODING_ERROR|not utf-8 encoded|Invalid unicode \(byte sequence mismatch\)/i;

/** Maps known low-level data errors (DuckDB / IPC) to short localized messages. */
export function formatDataErrorMessage(err: unknown, t: TFunction): string {
  const message = err instanceof Error ? err.message : String(err);
  if (CSV_DECODE_ERROR_PATTERN.test(message)) {
    return t('data.rawTables.errors.csvEncoding');
  }
  return message;
}

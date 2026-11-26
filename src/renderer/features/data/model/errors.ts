import type { TFunction } from 'i18next';
import { ipcErrorMessage } from '../../../utils/ipc-error';

const CSV_DECODE_ERROR_PATTERN =
  /DATA_CSV_ENCODING_ERROR|not utf-8 encoded|Invalid unicode \(byte sequence mismatch\)/i;

/** Maps known low-level data errors (DuckDB / IPC) to short localized messages. */
export function formatDataErrorMessage(err: unknown, t: TFunction): string {
  const message = ipcErrorMessage(err);
  if (CSV_DECODE_ERROR_PATTERN.test(message)) {
    return t('data.rawTables.errors.csvEncoding');
  }
  const abnormal = /E_RAW_TABLE_ABNORMAL:\s*([^。]+)/.exec(message);
  if (abnormal) return t('data.rawTables.errors.abnormal', { reason: abnormal[1].trim() });
  return message;
}

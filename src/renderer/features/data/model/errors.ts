import { isRawTableIssue } from '../../../../shared/contracts/data/issues';
import type { TFunction } from 'i18next';
import { ipcErrorMessage } from '../../../utils/ipc-error';

export function formatDataErrorMessage(error: unknown, t: TFunction): string {
  if (!isRawTableIssue(error)) return ipcErrorMessage(error);
  if (error.code === 'DATA_CSV_ENCODING_ERROR') return t('data.rawTables.errors.csvEncoding');
  return t('data.rawTables.errors.abnormal', { reason: error.message });
}

import { useTranslation } from 'react-i18next';

import type {
  CloudConnectionStatus,
  CloudConnectionTablePreview,
  DataRawTablePreview,
} from '../../../shared/contracts';
import type { DataFieldType } from '../../../shared/data-field-types';
import { type BadgeTone } from '../ui';
import { RawTablePreviewDialog } from './raw-table-preview-dialog';

export const CLOUD_CONNECTION_STATUS_TONE: Record<CloudConnectionStatus, BadgeTone> = {
  idle: 'default',
  connecting: 'warning',
  connected: 'success',
  reconnecting: 'warning',
  disconnected: 'default',
  offline: 'error',
  stopped: 'default',
};

/** Java `ExcelMeta.speType`：NUMBER→5，STRING→6，DATE→9，其它按文本。 */
const SPE_TYPE_TO_FIELD: Record<number, DataFieldType> = {
  5: 'float',
  6: 'text',
  9: 'date',
};

/** 把云连接预览结果转成原始表 / 结果表 `GlassDataGridPreview` 使用的 `DataRawTablePreview`。 */
export function toDataRawTablePreview(preview: CloudConnectionTablePreview): DataRawTablePreview {
  const columnTypes = preview.columns.map((name, index) => {
    const type = SPE_TYPE_TO_FIELD[preview.columnTypes[index]] ?? 'text';
    return { name, type, storageType: type };
  });
  const rows = preview.rows.map((row) => {
    const record: Record<string, string | number | boolean | null> = {};
    preview.columns.forEach((name, index) => {
      record[name] = row[index] ?? null;
    });
    return record;
  });
  return {
    columns: preview.columns,
    columnTypes,
    rows,
    fileCount: 1,
    // 云连接一次返回样本行，不分页；limit=行数让页码停在第 1 页。
    limit: Math.max(preview.rows.length, 1),
    offset: 0,
    totalRows: preview.rows.length,
  };
}

/** 云连接表预览：复用原始表 / 结果表的 `RawTablePreviewDialog` + `GlassDataGridPreview`。 */
export function CloudConnectionPreviewDialog({
  open,
  title,
  preview,
  isLoading,
  error,
  onClose,
}: {
  open: boolean;
  title?: string;
  preview: DataRawTablePreview | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  const heading = title?.trim() || t('cloudConnection.previewTitle');
  return (
    <div data-testid="cloud-connection-preview">
      <RawTablePreviewDialog
        tableKind="raw"
        title={heading}
        preview={preview}
        isLoading={isLoading}
        error={error}
        currentPage={1}
        onPageChange={() => undefined}
        onClose={onClose}
      />
    </div>
  );
}

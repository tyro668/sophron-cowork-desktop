import { useTranslation } from 'react-i18next';

import type { CloudConnectionStatus, CloudConnectionTablePreview } from '../../../shared/contracts';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type BadgeTone,
} from '../ui';

export const CLOUD_CONNECTION_STATUS_TONE: Record<CloudConnectionStatus, BadgeTone> = {
  idle: 'default',
  connecting: 'warning',
  connected: 'success',
  reconnecting: 'warning',
  disconnected: 'default',
  offline: 'error',
  stopped: 'default',
};

/** 云连接表预览（列、类型、行数与前几行），数据页与设置页共用。 */
export function CloudConnectionPreviewDialog({
  preview,
  onClose,
}: {
  preview: CloudConnectionTablePreview | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={preview !== null}
      onOpenChange={(open) => !open && onClose()}
      className="w-[min(960px,92vw)]"
      ariaLabel={t('cloudConnection.previewTitle')}
    >
      {preview && (
        <>
          <DialogHeader>
            <DialogTitle>
              {t('cloudConnection.previewTitle')} · {preview.tableName}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="max-h-[70vh] overflow-auto">
            <div
              className="overflow-hidden rounded-md border border-border-subtle"
              data-testid="cloud-connection-preview"
            >
              <div className="flex h-8 items-center gap-3 border-b border-border-subtle bg-surface-muted px-3 text-xs text-text-secondary">
                <span>{t('cloudConnection.rowCount', { count: preview.rowCount })}</span>
                <span>{t('cloudConnection.previewRows', { count: preview.rows.length })}</span>
              </div>
              <div className="overflow-auto">
                <table className="min-w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border-subtle bg-surface-muted text-left">
                      {preview.columns.map((c, i) => (
                        <th key={`${c}-${i}`} className="whitespace-nowrap px-2 py-1 font-medium">
                          <div className="text-text-primary">{c}</div>
                          <div className="text-[11px] font-normal text-text-muted">
                            {t(`cloudConnection.columnTypes.${preview.columnTypes[i]}`, {
                              defaultValue: String(preview.columnTypes[i]),
                            })}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border-subtle last:border-b-0">
                        {row.map((v, c) => (
                          <td
                            key={c}
                            className="max-w-[240px] truncate whitespace-nowrap px-2 py-1"
                          >
                            {v ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose}>{t('cloudConnection.actions.close')}</Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

/** 处理脚本: every raw-table normalizer with the tables using it; unused ones can be deleted. */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X } from 'lucide-react';
import type { DataRawTableNormalizerUsage } from '../../../shared/contracts';
import { dataClient } from '../../features/data/api/data-client';
import { useOptionalConfirmDialog } from '../ConfirmDialog';
import { Dialog } from '../ui/dialog';
import { showToast } from '../../utils/toast';
import { formatDateTime } from './shared';

export function NormalizerManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`data.rawTables.normalizers.${key}`, options);
  const confirm = useOptionalConfirmDialog();
  const [items, setItems] = useState<DataRawTableNormalizerUsage[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await dataClient.listRawTableNormalizers());
    } catch (error) {
      setItems([]);
      showToast('error', error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (open) void load();
    else setItems(null);
  }, [load, open]);

  const remove = async (item: DataRawTableNormalizerUsage) => {
    const ok = confirm
      ? await confirm.confirmDelete({
          title: tr('deleteTitle'),
          message: tr('deleteTitle'),
          name: item.artifact.name,
          impact: tr('deleteImpact'),
        })
      : true;
    if (!ok) return;
    setBusyId(item.artifact.id);
    try {
      await dataClient.deleteRawTableNormalizer(item.artifact.id);
      showToast('success', tr('deleted', { name: item.artifact.name }));
      await load();
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  const unused = items?.filter((item) => item.usedBy.length === 0).length ?? 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      ariaLabel={tr('title')}
      className="w-full max-w-2xl p-0"
    >
      <div data-testid="normalizer-manager">
        <div className="flex h-11 items-center gap-2 border-b border-border-subtle px-4">
          <span className="text-[14px] font-medium text-text-primary">{tr('title')}</span>
          {items ? (
            <span className="text-[12px] text-text-muted">
              {tr('summary', { count: items.length, unused })}
            </span>
          ) : null}
          <button
            type="button"
            className="ml-auto text-text-muted hover:text-text-primary"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full table-fixed border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="h-8 border-b border-border-subtle bg-[var(--data-grid-header-surface)] text-text-muted">
                <th className="px-4 font-medium">{tr('colName')}</th>
                <th className="w-[38%] px-2 font-medium">{tr('colUsedBy')}</th>
                <th className="w-[130px] px-2 font-medium">{tr('colUpdated')}</th>
                <th className="w-[72px] px-2" />
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((item) => (
                <tr
                  key={item.artifact.id}
                  className="h-9 border-b border-dashed border-border-muted"
                  data-testid="normalizer-row"
                >
                  <td className="truncate px-4 text-text-primary" title={item.artifact.name}>
                    {item.artifact.name}
                  </td>
                  <td
                    className="truncate px-2 text-text-secondary"
                    title={item.usedBy.map((table) => table.name).join('、')}
                  >
                    {item.usedBy.length > 0 ? (
                      item.usedBy.map((table) => table.name).join('、')
                    ) : (
                      <span className="text-warning">{tr('unused')}</span>
                    )}
                  </td>
                  <td className="px-2 text-text-muted">
                    {formatDateTime(item.artifact.updatedAt)}
                  </td>
                  <td className="px-2 text-right">
                    <button
                      type="button"
                      disabled={item.usedBy.length > 0 || busyId !== null}
                      title={item.usedBy.length > 0 ? tr('inUseHint') : undefined}
                      onClick={() => void remove(item)}
                      data-testid="normalizer-delete"
                      className="inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] text-error hover:bg-error/5 disabled:cursor-not-allowed disabled:text-text-muted disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))}
              {items && items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    {tr('empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </Dialog>
  );
}

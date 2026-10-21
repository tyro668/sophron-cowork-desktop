import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, X } from 'lucide-react';
import type { DataRawTableCloudSource } from '../../types';
import { Dialog } from '../ui/dialog';
import {
  CloudConnectionRow,
  CloudResourceSelector,
  useCloudConnected,
} from '../settings/schedule/cloud-resource-selector';
import { FlushSelect, FormRow } from '../settings/schedule/editor-controls';

/** c20–c23: flush 104 | 1fr | 40 grid dialog. Reuses the automation cloud catalog selector. */
export function RawTableCloudSourceDialog({
  initialSource,
  onSelect,
  onClose,
}: {
  initialSource?: DataRawTableCloudSource;
  onSelect: (source: DataRawTableCloudSource) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const connected = useCloudConnected();
  const [source, setSource] = useState<DataRawTableCloudSource>(
    initialSource ?? { tableId: '', contentHash: '' }
  );
  const tableKind = source.tableKind ?? 'analysis';
  const canBind = connected && !!source.spaceId && !!source.projectId && !!source.tableId;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      ariaLabel={t('data.rawTables.editor.cloudSource.choose')}
      className="w-[520px] max-w-[calc(100vw-2rem)] !gap-0 overflow-hidden !p-0"
    >
      <div
        className="grid h-10 flex-shrink-0 grid-cols-[minmax(0,1fr)_40px] border-b border-border-subtle"
        data-testid="cloud-source-dialog-title"
      >
        <h2 className="flex items-center px-3 text-[14px] font-semibold text-text-primary">
          {t('data.rawTables.editor.cloudSource.choose')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          title={t('common.close')}
          className="inline-flex items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-accent-muted hover:text-accent"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div
        className="ui-form-flush min-h-0 flex-1 overflow-y-auto"
        data-testid="cloud-source-dialog-form"
      >
        <CloudConnectionRow compact />
        <FormRow label={t('schedule.cloudInput.sourceKind')}>
          <FlushSelect
            ariaLabel={t('schedule.cloudInput.sourceKind')}
            disabled={!connected}
            value={tableKind}
            placeholder={t('schedule.cloudInput.sourceKind')}
            options={[
              { value: 'analysis', label: t('cloudData.kindAnalysis') },
              { value: 'base', label: t('cloudData.kindBase') },
            ]}
            onChange={(value) =>
              setSource((current) => ({
                ...current,
                tableKind: value as 'analysis' | 'base',
                tableId: '',
                tableName: undefined,
              }))
            }
          />
        </FormRow>
        <div className="ui-group-title">{t('data.rawTables.editor.cloudSource.tableLabel')}</div>
        <CloudResourceSelector
          config={{ ...source }}
          resource={tableKind}
          onChange={(patch) => setSource((current) => ({ ...current, ...patch }))}
        />
      </div>
      <div
        className="grid h-10 flex-shrink-0 grid-cols-2 border-t border-border-subtle"
        data-testid="cloud-source-dialog-actions"
      >
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          disabled={!canBind}
          data-testid="cloud-source-bind"
          onClick={() => {
            onSelect({ ...source, tableKind });
            onClose();
          }}
          className="ui-accent-cell border-l border-border-subtle"
        >
          <Link2 className="h-3.5 w-3.5" />
          {t('data.rawTables.editor.cloudSource.bind')}
        </button>
      </div>
    </Dialog>
  );
}

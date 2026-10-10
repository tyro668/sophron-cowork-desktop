import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataRawTableCloudSource } from '../../types';
import { Button } from '../ui/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '../ui/dialog';
import { GlassSelect } from '../GlassSelect';
import { CloudResourceSelector } from '../settings/schedule/cloud-resource-selector';

/** Reuses the same cloud catalog selector as automation. Selection never exposes cache files. */
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
  const [source, setSource] = useState<DataRawTableCloudSource>(
    initialSource ?? { tableId: '', contentHash: '' }
  );
  const tableKind = source.tableKind ?? 'analysis';
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      ariaLabel={t('data.rawTables.editor.cloudSource.choose')}
    >
      <DialogTitle>{t('data.rawTables.editor.cloudSource.choose')}</DialogTitle>
      <DialogBody className="space-y-3">
        <GlassSelect
          ariaLabel={t('schedule.cloudInput.sourceKind')}
          value={tableKind}
          options={[
            { value: 'analysis', label: t('cloudData.kindAnalysis') },
            { value: 'base', label: t('cloudData.kindBase') },
          ]}
          onValueChange={(value) =>
            setSource((current) => ({
              ...current,
              tableKind: value as 'analysis' | 'base',
              tableId: '',
              tableName: undefined,
            }))
          }
        />
        <CloudResourceSelector
          config={{ ...source }}
          resource={tableKind}
          onChange={(patch) => setSource((current) => ({ ...current, ...patch }))}
        />
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="primary"
          disabled={!source.spaceId || !source.projectId || !source.tableId}
          onClick={() => {
            onSelect({ ...source, tableKind });
            onClose();
          }}
        >
          {t('data.rawTables.editor.cloudSource.bind')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

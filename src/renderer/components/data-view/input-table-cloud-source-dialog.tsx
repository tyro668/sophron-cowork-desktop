import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataInputTableCloudSource } from '../../types';
import { Button } from '../ui/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '../ui/dialog';
import { GlassSelect } from '../GlassSelect';
import { CloudResourceSelector } from '../settings/schedule/cloud-resource-selector';

/** Reuses the same cloud catalog selector as automation. Selection never exposes cache files. */
export function InputTableCloudSourceDialog({
  initialSource,
  onSelect,
  onClose,
}: {
  initialSource?: DataInputTableCloudSource;
  onSelect: (source: DataInputTableCloudSource) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState<DataInputTableCloudSource>(
    initialSource ?? { tableId: '', contentHash: '' }
  );
  const tableKind = source.tableKind ?? 'analysis';
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      ariaLabel={t('data.inputTables.editor.cloudSource.choose')}
    >
      <DialogTitle>{t('data.inputTables.editor.cloudSource.choose')}</DialogTitle>
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
          {t('data.inputTables.editor.cloudSource.bind')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

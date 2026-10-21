import { useTranslation } from 'react-i18next';
import { CircleAlert, CloudDownload, CloudUpload, Database } from 'lucide-react';
import type { AutomationActionNode, DataRawTable, DataResultTable } from '../../../types';
import { FlushSelect, FormRow, RequiredLabel, SubGroupRow } from './editor-controls';
import {
  CloudConnectionRow,
  CloudResourceSelector,
  withSavedOption,
} from './cloud-resource-selector';

export function CloudSyncEditor({
  node,
  rawTables,
  resultTables,
  onChange,
}: {
  node: AutomationActionNode;
  rawTables: DataRawTable[];
  resultTables: DataResultTable[];
  onChange: (node: AutomationActionNode) => void;
}) {
  const { t } = useTranslation();
  const config = node.config;
  const update = (patch: Record<string, unknown>) =>
    onChange({ ...node, config: { ...config, ...patch } });
  const direction =
    config.direction === 'input' || config.direction === 'output' ? config.direction : '';
  const kind = config.tableKind === 'base' ? 'base' : 'analysis';
  const legacy = direction === 'output' && config.type === 'cloud_table';
  const writeMode = legacy ? '' : String(config.writeMode ?? (config.fileId ? 'replace' : ''));
  const setDirection = (next: string) => {
    if (next === direction) return;
    update(
      next === 'input'
        ? {
            direction: 'input',
            tableKind: 'analysis',
            resultTableId: undefined,
            type: undefined,
            writeMode: undefined,
            fileId: undefined,
            fileName: undefined,
            version: undefined,
          }
        : {
            direction: 'output',
            type: 'drive_file',
            writeMode: undefined,
            tableId: undefined,
            tableName: undefined,
            tableKind: undefined,
            rawTableId: undefined,
            rawTableName: undefined,
          }
    );
  };
  return (
    <div data-testid="cloud-sync-editor">
      <FormRow label={t('schedule.cloudSync.direction')}>
        <FlushSelect
          ariaLabel={t('schedule.cloudSync.direction')}
          value={direction}
          placeholder={t('schedule.cloudSync.selectDirection')}
          triggerIcon={
            direction === 'input' ? (
              <CloudDownload className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
            ) : direction === 'output' ? (
              <CloudUpload className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
            ) : undefined
          }
          options={[
            { value: 'input', label: t('schedule.cloudInput.title') },
            { value: 'output', label: t('schedule.cloudSync.title') },
          ]}
          onChange={setDirection}
        />
      </FormRow>
      {legacy && (
        <FormRow label={t('schedule.cloudSync.cloudLabel')}>
          <p
            role="alert"
            className="flex min-h-[35px] items-center gap-1.5 bg-warning/10 px-[10px] py-2 text-[12.5px] text-warning"
          >
            <CircleAlert className="h-3.5 w-3.5 flex-shrink-0" />
            {t('schedule.cloudSync.legacyTarget')}
          </p>
        </FormRow>
      )}
      {direction && <CloudConnectionRow />}
      {direction === 'input' && (
        <>
          <SubGroupRow>{t('schedule.cloudInput.sourceSection')}</SubGroupRow>
          <FormRow label={t('schedule.cloudInput.sourceKind')}>
            <FlushSelect
              ariaLabel={t('schedule.cloudInput.sourceKind')}
              value={kind}
              placeholder={t('schedule.cloudInput.sourceKind')}
              options={['analysis', 'base'].map((value) => ({
                value,
                label: t(`schedule.cloudInput.${value}`),
              }))}
              onChange={(tableKind) =>
                update({ tableKind, tableId: undefined, tableName: undefined })
              }
            />
          </FormRow>
          <CloudResourceSelector config={config} resource={kind} onChange={update} />
          <SubGroupRow>{t('schedule.cloudInput.targetSection')}</SubGroupRow>
          <FormRow label={<RequiredLabel>{t('schedule.cloudInput.target')}</RequiredLabel>}>
            <FlushSelect
              ariaLabel={t('schedule.cloudInput.target')}
              value={String(config.rawTableId ?? '')}
              options={[
                { value: '__create__', label: t('schedule.cloudInput.create') },
                ...withSavedOption(
                  rawTables.map((table) => ({ value: table.id, label: table.name })),
                  String(config.rawTableId ?? ''),
                  String(config.rawTableName ?? '')
                ),
              ]}
              placeholder={t('schedule.rawTablePlaceholder')}
              onChange={(value) => {
                const table = rawTables.find((table) => table.id === value);
                update({
                  rawTableId: value === '__create__' ? undefined : value,
                  rawTableName: table?.name,
                  ...(value === '__create__' ? { syncKey: crypto.randomUUID() } : {}),
                });
              }}
            />
          </FormRow>
          {!config.rawTableId && (
            <FormRow label={t('schedule.cloudInput.name')}>
              <input
                aria-label={t('schedule.cloudInput.name')}
                value={String(config.rawTableName ?? '')}
                onChange={(event) => update({ rawTableName: event.target.value })}
                className="outline-none placeholder:text-text-muted hover:bg-surface-hover focus:bg-surface-hover"
              />
            </FormRow>
          )}
        </>
      )}
      {direction === 'output' && (
        <>
          <SubGroupRow>{t('schedule.cloudSync.outputSection')}</SubGroupRow>
          <FormRow label={<RequiredLabel>{t('schedule.outputDataLabel')}</RequiredLabel>}>
            <FlushSelect
              ariaLabel={t('schedule.outputDataLabel')}
              value={String(config.resultTableId ?? '')}
              options={withSavedOption(
                resultTables.map((table) => ({ value: table.id, label: table.name })),
                String(config.resultTableId ?? '')
              )}
              placeholder={t('schedule.resultTablePlaceholder')}
              triggerIcon={<Database className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />}
              onChange={(resultTableId) => update({ resultTableId })}
            />
          </FormRow>
          <FormRow label={<RequiredLabel>{t('schedule.cloudSync.writeMode')}</RequiredLabel>}>
            <FlushSelect
              ariaLabel={t('schedule.cloudSync.writeMode')}
              value={writeMode}
              placeholder={t('schedule.cloudSync.selectMode')}
              options={['create', 'replace', 'append'].map((value) => ({
                value,
                label: t(`schedule.cloudSync.${value}`),
              }))}
              onChange={(writeMode) =>
                update({
                  type: 'drive_file',
                  writeMode,
                  tableId: undefined,
                  tableName: undefined,
                  ...(writeMode === 'create' || legacy
                    ? {
                        fileId: undefined,
                        fileName: undefined,
                        version: undefined,
                        syncKey: crypto.randomUUID(),
                      }
                    : {}),
                })
              }
            />
          </FormRow>
          <SubGroupRow>{t('schedule.cloudSync.targetSection')}</SubGroupRow>
          <CloudResourceSelector
            config={config}
            resource="drive"
            create={writeMode === 'create'}
            onChange={update}
          />
          {writeMode === 'create' && (
            <FormRow label={t('schedule.cloudSync.name')}>
              <input
                aria-label={t('schedule.cloudSync.name')}
                value={String(config.fileName ?? '')}
                onChange={(event) => update({ fileName: event.target.value || undefined })}
                placeholder={resultTables.find((table) => table.id === config.resultTableId)?.name}
                className="outline-none placeholder:text-text-muted hover:bg-surface-hover focus:bg-surface-hover"
              />
            </FormRow>
          )}
        </>
      )}
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { CloudDownload, Database, FileUp } from 'lucide-react';
import type { AutomationActionNode, DataRawTable, DataResultTable } from '../../../types';
import { Input } from '../../ui/input';
import { ConfigSection, FieldStack, SelectLine } from './editor-controls';
import { CloudResourceSelector, withSavedOption } from './cloud-resource-selector';

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
    <div className="space-y-3">
      <FieldStack label={t('schedule.cloudSync.direction')}>
        <SelectLine
          value={direction}
          placeholder={t('schedule.cloudSync.selectDirection')}
          options={[
            { value: 'input', label: t('schedule.cloudInput.title') },
            { value: 'output', label: t('schedule.cloudSync.title') },
          ]}
          onChange={setDirection}
        />
      </FieldStack>
      {direction === 'input' && (
        <div className="grid gap-3 md:grid-cols-2">
          <ConfigSection
            icon={<CloudDownload className="h-3.5 w-3.5 text-accent" />}
            title={t('schedule.cloudInput.sourceSection')}
          >
            <FieldStack label={t('schedule.cloudInput.sourceKind')}>
              <SelectLine
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
            </FieldStack>
            <CloudResourceSelector config={config} resource={kind} onChange={update} />
          </ConfigSection>
          <ConfigSection
            icon={<Database className="h-3.5 w-3.5 text-accent" />}
            title={t('schedule.cloudInput.targetSection')}
          >
            <FieldStack label={t('schedule.cloudInput.target')}>
              <SelectLine
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
            </FieldStack>
            {!config.rawTableId && (
              <FieldStack label={t('schedule.cloudInput.name')}>
                <Input
                  value={String(config.rawTableName ?? '')}
                  onChange={(event) => update({ rawTableName: event.target.value })}
                />
              </FieldStack>
            )}
          </ConfigSection>
        </div>
      )}
      {direction === 'output' && (
        <>
          {legacy && (
            <p role="alert" className="text-xs text-warning">
              {t('schedule.cloudSync.legacyTarget')}
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <ConfigSection
              icon={<Database className="h-3.5 w-3.5 text-accent" />}
              title={t('schedule.cloudSync.outputSection')}
            >
              <FieldStack label={t('schedule.outputDataLabel')}>
                <SelectLine
                  value={String(config.resultTableId ?? '')}
                  options={withSavedOption(
                    resultTables.map((table) => ({ value: table.id, label: table.name })),
                    String(config.resultTableId ?? '')
                  )}
                  placeholder={t('schedule.resultTablePlaceholder')}
                  onChange={(resultTableId) => update({ resultTableId })}
                />
              </FieldStack>
              <FieldStack label={t('schedule.cloudSync.writeMode')}>
                <SelectLine
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
              </FieldStack>
            </ConfigSection>
            <ConfigSection
              icon={<FileUp className="h-3.5 w-3.5 text-accent" />}
              title={t('schedule.cloudSync.targetSection')}
            >
              <CloudResourceSelector
                config={config}
                resource="drive"
                create={writeMode === 'create'}
                onChange={update}
              />
              {writeMode === 'create' && (
                <FieldStack label={t('schedule.cloudSync.name')}>
                  <Input
                    value={String(config.fileName ?? '')}
                    onChange={(event) => update({ fileName: event.target.value || undefined })}
                    placeholder={
                      resultTables.find((table) => table.id === config.resultTableId)?.name
                    }
                  />
                </FieldStack>
              )}
            </ConfigSection>
          </div>
        </>
      )}
    </div>
  );
}

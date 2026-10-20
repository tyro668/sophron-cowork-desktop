import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Database, FileSpreadsheet, FileText, Folder, type LucideIcon } from 'lucide-react';
import { Cell, FormGrid, FormScroll, LabelCell } from '../../../workflow-forms/shared/FormGrid';
import { INPUT_GRID_COLUMNS } from '../../../workflow-forms/shared/gridColumns';
import type { DataRawTable, DataRawTableSourceKind, DataWorkflowNode } from '../../../../types';
import { GlassSelect } from '../../../GlassSelect';
import { stringValue } from './workflow-summary';

const SOURCE_KIND_ICONS: Record<DataRawTableSourceKind, LucideIcon> = {
  cloud: Cloud,
  excel: FileSpreadsheet,
  csv: FileText,
  folder: Folder,
};

export function WorkflowInputSourceConfig({
  node,
  rawTables,
  isLoading,
  onNodeChange,
}: {
  node: DataWorkflowNode;
  rawTables: DataRawTable[];
  isLoading: boolean;
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}) {
  const { t } = useTranslation();
  const selectedRawTableId = stringValue(node.config.rawTableId);
  const selectedRawTableName =
    stringValue(node.config.rawTableName) || stringValue(node.config.name);
  const selectedRawTableById =
    rawTables.find((rawTable) => rawTable.id === selectedRawTableId) ?? null;
  const hasSelectedRawTableInChoices = selectedRawTableById !== null;
  // DSL-authored inputs bind by table name (`input source rawTable "销售订单"`).
  const selectedRawTable =
    selectedRawTableById ??
    rawTables.find((rawTable) => rawTable.name === selectedRawTableId) ??
    null;
  const SelectedSourceIcon = selectedRawTable
    ? SOURCE_KIND_ICONS[selectedRawTable.sourceKind]
    : null;
  const handleRawTableChange = useCallback(
    (rawTableId: string) => {
      const selectedRawTable = rawTables.find((rawTable) => rawTable.id === rawTableId);
      onNodeChange((current) => {
        const nextConfig: Record<string, unknown> = { ...current.config };
        if (selectedRawTable) {
          nextConfig.source = 'rawTable';
          nextConfig.rawTableId = selectedRawTable.id;
          nextConfig.rawTableName = selectedRawTable.name;
          nextConfig.name = selectedRawTable.name;
        } else {
          delete nextConfig.source;
          delete nextConfig.rawTableId;
          delete nextConfig.rawTableName;
          delete nextConfig.name;
        }
        delete nextConfig.filePath;
        delete nextConfig.sheet;
        delete nextConfig.encoding;
        delete nextConfig.incrementalBy;
        return {
          ...current,
          config: nextConfig,
          updatedAt: Date.now(),
        };
      });
    },
    [rawTables, onNodeChange]
  );

  const alias = stringValue(node.config.alias);
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const formatUpdated = (ms: number) => {
    const d = new Date(ms);
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  return (
    <FormScroll>
      <FormGrid columns={INPUT_GRID_COLUMNS} testId="input-form-grid">
        <LabelCell required>{t('data.workflow.rawTable')}</LabelCell>
        <Cell v={['ctl', !selectedRawTableId && !isLoading && 'err']}>
          <GlassSelect
            ariaLabel={t('data.workflow.rawTable')}
            value={selectedRawTableId || undefined}
            onValueChange={handleRawTableChange}
            options={[
              ...(selectedRawTableId && !hasSelectedRawTableInChoices
                ? [
                    {
                      value: selectedRawTableId,
                      label: selectedRawTableName || selectedRawTableId,
                    },
                  ]
                : []),
              ...rawTables.map((rawTable) => ({ value: rawTable.id, label: rawTable.name })),
            ]}
            placeholder={
              isLoading
                ? t('data.workflow.loadingRawTables')
                : rawTables.length > 0
                  ? t('data.workflow.selectRawTable')
                  : t('data.workflow.noAvailableRawTables')
            }
            disabled={isLoading || (!selectedRawTableId && rawTables.length === 0)}
            triggerIcon={<Database className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />}
            triggerClassName="w-full justify-between text-[13px] text-text-primary"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </Cell>
        <Cell v={['muted']}>
          {selectedRawTable && SelectedSourceIcon ? (
            <span
              className="truncate"
              title={t(`data.rawTables.sources.${selectedRawTable.sourceKind}`)}
            >
              {t('data.workflow.inputTableInfo', {
                columns: selectedRawTable.columnCount.toLocaleString(),
                rows: selectedRawTable.rowCount.toLocaleString(),
                updated: formatUpdated(selectedRawTable.updatedAt),
              })}
            </span>
          ) : null}
        </Cell>

        <LabelCell>{t('data.workflow.inputAlias')}</LabelCell>
        <Cell v={['mono']}>{alias || '—'}</Cell>
        <Cell v={['muted']}>
          <span className="truncate">
            {alias
              ? t('data.workflow.inputAliasHint', { alias })
              : t('data.workflow.inputAliasNone')}
          </span>
        </Cell>
      </FormGrid>
    </FormScroll>
  );
}

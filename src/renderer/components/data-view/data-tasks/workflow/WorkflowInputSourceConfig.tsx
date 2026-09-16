import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Columns3,
  Database,
  FileSpreadsheet,
  FileText,
  Folder,
  Rows3,
  type LucideIcon,
} from 'lucide-react';
import type { DataDataset, DataInputTableSourceKind, DataWorkflowNode } from '../../../../types';
import { GlassSelect } from '../../../GlassSelect';
import { stringValue } from './workflow-summary';

const SOURCE_KIND_ICONS: Record<DataInputTableSourceKind, LucideIcon> = {
  excel: FileSpreadsheet,
  csv: FileText,
  folder: Folder,
};

export function WorkflowInputSourceConfig({
  node,
  inputTables,
  isLoading,
  onNodeChange,
}: {
  node: DataWorkflowNode;
  inputTables: DataDataset[];
  isLoading: boolean;
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}) {
  const { t } = useTranslation();
  const selectedInputTableId = stringValue(node.config.datasetId);
  const selectedInputTableName =
    stringValue(node.config.inputTableName) || stringValue(node.config.name);
  const selectedDataset =
    inputTables.find((inputTable) => inputTable.id === selectedInputTableId) ?? null;
  const hasSelectedInputTableInChoices = selectedDataset !== null;
  const SelectedSourceIcon = selectedDataset ? SOURCE_KIND_ICONS[selectedDataset.sourceKind] : null;
  const incrementalBy = stringValue(node.config.incrementalBy);

  const handleIncrementalChange = useCallback(
    (raw: string) => {
      onNodeChange((current) => {
        const nextConfig: Record<string, unknown> = { ...current.config };
        const cleaned = raw
          .trim()
          .replace(/^\[|\]$/g, '')
          .replace(/^`|`$/g, '');
        if (cleaned) {
          nextConfig.incrementalBy = cleaned;
        } else {
          delete nextConfig.incrementalBy;
        }
        return { ...current, config: nextConfig, updatedAt: Date.now() };
      });
    },
    [onNodeChange]
  );

  const handleInputTableChange = useCallback(
    (inputTableId: string) => {
      const selectedInputTable = inputTables.find((inputTable) => inputTable.id === inputTableId);
      onNodeChange((current) => {
        const nextConfig: Record<string, unknown> = { ...current.config };
        if (selectedInputTable) {
          nextConfig.source = 'dataset';
          nextConfig.datasetId = selectedInputTable.id;
          nextConfig.inputTableName = selectedInputTable.name;
          nextConfig.name = selectedInputTable.name;
        } else {
          delete nextConfig.source;
          delete nextConfig.datasetId;
          delete nextConfig.inputTableName;
          delete nextConfig.name;
        }
        delete nextConfig.filePath;
        delete nextConfig.sheet;
        delete nextConfig.encoding;
        return {
          ...current,
          config: nextConfig,
          updatedAt: Date.now(),
        };
      });
    },
    [inputTables, onNodeChange]
  );

  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <div className="w-full max-w-sm">
        <span className="mb-1.5 block text-xs font-medium text-text-secondary">
          {t('data.workflow.inputTable')}
        </span>
        <GlassSelect
          ariaLabel={t('data.workflow.inputTable')}
          value={selectedInputTableId || undefined}
          onValueChange={handleInputTableChange}
          options={[
            ...(selectedInputTableId && !hasSelectedInputTableInChoices
              ? [
                  {
                    value: selectedInputTableId,
                    label: selectedInputTableName || selectedInputTableId,
                  },
                ]
              : []),
            ...inputTables.map((inputTable) => ({ value: inputTable.id, label: inputTable.name })),
          ]}
          placeholder={
            isLoading
              ? t('data.workflow.loadingInputTables')
              : t('data.workflow.noAvailableInputTables')
          }
          disabled={isLoading || (!selectedInputTableId && inputTables.length === 0)}
          triggerIcon={<Database className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />}
          triggerClassName="h-8 w-full justify-between rounded-lg bg-surface px-2 text-xs font-medium text-text-secondary"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
      </div>
      <div className="w-56">
        <span className="mb-1.5 block text-xs font-medium text-text-secondary">
          {t('data.workflow.incrementalBy')}
        </span>
        <input
          value={incrementalBy}
          onChange={(event) => handleIncrementalChange(event.target.value)}
          placeholder={t('data.workflow.incrementalByPlaceholder')}
          className="h-8 w-full rounded-lg border border-border-muted bg-surface px-2 text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>
      {selectedDataset && SelectedSourceIcon && (
        <div className="flex items-center gap-5 pb-2 text-xs text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Rows3 className="h-3.5 w-3.5" />
            {t('data.columns.rows')} {selectedDataset.rowCount}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Columns3 className="h-3.5 w-3.5" />
            {t('data.columns.columns')} {selectedDataset.columnCount}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <SelectedSourceIcon className="h-3.5 w-3.5" />
            {t(`data.inputTables.sources.${selectedDataset.sourceKind}`)}
          </span>
        </div>
      )}
    </div>
  );
}

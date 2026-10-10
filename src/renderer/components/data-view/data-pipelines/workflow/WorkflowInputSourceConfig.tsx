import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cloud,
  Columns3,
  Database,
  FileSpreadsheet,
  FileText,
  Folder,
  Rows3,
  type LucideIcon,
} from 'lucide-react';
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
  const selectedRawTable = rawTables.find((rawTable) => rawTable.id === selectedRawTableId) ?? null;
  const hasSelectedRawTableInChoices = selectedRawTable !== null;
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

  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <div className="w-full max-w-sm">
        <span className="mb-1.5 block text-xs font-medium text-text-secondary">
          {t('data.workflow.rawTable')}
        </span>
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
              : t('data.workflow.noAvailableRawTables')
          }
          disabled={isLoading || (!selectedRawTableId && rawTables.length === 0)}
          triggerIcon={<Database className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />}
          triggerClassName="h-8 w-full justify-between rounded-lg bg-surface px-2 text-xs font-medium text-text-secondary"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
      </div>
      {selectedRawTable && SelectedSourceIcon && (
        <div className="flex items-center gap-5 pb-2 text-xs text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Rows3 className="h-3.5 w-3.5" />
            {t('data.columns.rows')} {selectedRawTable.rowCount}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Columns3 className="h-3.5 w-3.5" />
            {t('data.columns.columns')} {selectedRawTable.columnCount}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <SelectedSourceIcon className="h-3.5 w-3.5" />
            {t(`data.rawTables.sources.${selectedRawTable.sourceKind}`)}
          </span>
        </div>
      )}
    </div>
  );
}

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataDataset, DataWorkflowNode } from '../../../../types';
import { GlassSelect } from '../../../GlassSelect';
import { stringValue } from './workflow-summary';

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
  const hasSelectedInputTableInChoices = inputTables.some(
    (inputTable) => inputTable.id === selectedInputTableId
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
    <div className="block sm:col-span-2">
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
        triggerClassName="h-8 w-full justify-between rounded-lg bg-surface px-2 text-xs font-medium text-text-secondary"
        contentClassName="w-[var(--radix-select-trigger-width)]"
      />
    </div>
  );
}

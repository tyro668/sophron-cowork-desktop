import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataOutputTable, DataWorkflowNode } from '../../../../types';
import { GlassSelect } from '../../../GlassSelect';
import { stringValue } from './workflow-summary';

export function WorkflowOutputConfig({
  node,
  outputTables,
  onNodeChange,
}: {
  node: DataWorkflowNode;
  outputTables: DataOutputTable[];
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}) {
  const { t } = useTranslation();
  const selectedOutputDatasetId =
    stringValue(node.config.outputDatasetId) || stringValue(node.config.outputTableId);
  const configuredStrategy = stringValue(node.config.outputStrategy);
  const strategy =
    configuredStrategy === 'auto' || configuredStrategy === 'existing'
      ? configuredStrategy
      : selectedOutputDatasetId
        ? 'existing'
        : 'auto';
  const autoOutputTableName =
    stringValue(node.config.outputTableName) || stringValue(node.config.table);
  const availableOutputTables = outputTables.filter(
    (outputTable) =>
      outputTable.relatedTaskNames.length === 0 || outputTable.id === selectedOutputDatasetId
  );

  const updateOutputConfig = useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => ({
        ...current,
        config: updater(current.config),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );

  const handleStrategyChange = useCallback(
    (nextStrategy: string) => {
      updateOutputConfig((config) => {
        const nextConfig: Record<string, unknown> = {
          ...config,
          outputStrategy: nextStrategy,
          destination: 'duckdb_table',
          mode: stringValue(config.mode, 'replace'),
        };
        if (nextStrategy === 'auto') {
          delete nextConfig.outputDatasetId;
          delete nextConfig.outputTableId;
          delete nextConfig.table;
          return nextConfig;
        }

        const selected =
          availableOutputTables.find((outputTable) => outputTable.id === selectedOutputDatasetId) ??
          availableOutputTables[0];
        if (selected) {
          nextConfig.outputDatasetId = selected.id;
          nextConfig.table = selected.tableName;
        } else {
          delete nextConfig.outputDatasetId;
          delete nextConfig.outputTableId;
        }
        return nextConfig;
      });
    },
    [availableOutputTables, selectedOutputDatasetId, updateOutputConfig]
  );

  const handleAutoTableNameChange = useCallback(
    (tableName: string) => {
      updateOutputConfig((config) => {
        const nextConfig: Record<string, unknown> = {
          ...config,
          outputStrategy: 'auto',
          destination: 'duckdb_table',
          mode: stringValue(config.mode, 'replace'),
          outputTableName: tableName,
        };
        delete nextConfig.outputDatasetId;
        delete nextConfig.outputTableId;
        delete nextConfig.table;
        return nextConfig;
      });
    },
    [updateOutputConfig]
  );

  const handleOutputTableChange = useCallback(
    (outputDatasetId: string) => {
      updateOutputConfig((config) => {
        const selectedOutputTable = outputTables.find(
          (outputTable) => outputTable.id === outputDatasetId
        );
        const nextConfig: Record<string, unknown> = {
          ...config,
          outputStrategy: 'existing',
          destination: 'duckdb_table',
          mode: stringValue(config.mode, 'replace'),
        };
        if (selectedOutputTable) {
          nextConfig.outputDatasetId = selectedOutputTable.id;
          nextConfig.table = selectedOutputTable.tableName;
          nextConfig.outputTableName = selectedOutputTable.name;
        } else {
          delete nextConfig.outputDatasetId;
          delete nextConfig.outputTableId;
        }
        return nextConfig;
      });
    },
    [outputTables, updateOutputConfig]
  );

  return (
    <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-text-secondary">
          {t('data.workflow.outputStrategy')}
        </span>
        <GlassSelect
          value={strategy}
          onValueChange={handleStrategyChange}
          options={[
            { value: 'auto', label: t('data.workflow.values.outputStrategies.auto') },
            { value: 'existing', label: t('data.workflow.values.outputStrategies.existing') },
          ]}
          triggerClassName="h-8 w-full justify-between rounded-lg bg-surface px-2 text-xs font-medium text-text-secondary"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
      </label>

      {strategy === 'auto' ? (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-text-secondary">
            {t('data.workflow.outputTableName')}
          </span>
          <input
            value={autoOutputTableName}
            onChange={(event) => handleAutoTableNameChange(event.target.value)}
            placeholder={t('data.workflow.autoOutputTable')}
            className="h-8 w-full rounded-lg border border-border-muted bg-surface px-2 text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
      ) : (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-text-secondary">
            {t('data.workflow.outputTable')}
          </span>
          <GlassSelect
            value={selectedOutputDatasetId || undefined}
            onValueChange={handleOutputTableChange}
            options={[
              ...(selectedOutputDatasetId &&
              !availableOutputTables.some(
                (outputTable) => outputTable.id === selectedOutputDatasetId
              )
                ? [{ value: selectedOutputDatasetId, label: selectedOutputDatasetId }]
                : []),
              ...availableOutputTables.map((outputTable) => ({
                value: outputTable.id,
                label: outputTable.name,
              })),
            ]}
            placeholder={t('data.workflow.noAvailableOutputTables')}
            disabled={!selectedOutputDatasetId && availableOutputTables.length === 0}
            triggerClassName="h-8 w-full justify-between rounded-lg bg-surface px-2 text-xs font-medium text-text-secondary"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </label>
      )}
    </div>
  );
}

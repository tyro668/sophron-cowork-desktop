import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataOutputTable, DataWorkflowNode } from '../../../../types';
import { GlassSelect } from '../../../GlassSelect';
import { GlassSegmentedControl } from '../../../workflow-forms/shared/GlassSegmentedControl';
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
  const mode = stringValue(node.config.mode, 'replace');
  const schemaPolicy = stringValue(node.config.schemaPolicy, 'extend');
  const mergeKeysText = Array.isArray(node.config.mergeKeys)
    ? node.config.mergeKeys.map((key) => String(key)).join(', ')
    : '';
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
        delete nextConfig.outputTableId;
        delete nextConfig.table;
        return nextConfig;
      });
    },
    [updateOutputConfig]
  );

  const handleModeChange = useCallback(
    (nextMode: string) => {
      updateOutputConfig((config) => {
        const nextConfig: Record<string, unknown> = { ...config, mode: nextMode };
        if (nextMode !== 'merge') delete nextConfig.mergeKeys;
        return nextConfig;
      });
    },
    [updateOutputConfig]
  );

  const handleMergeKeysChange = useCallback(
    (raw: string) => {
      updateOutputConfig((config) => ({
        ...config,
        mergeKeys: raw
          .split(',')
          .map((key) =>
            key
              .trim()
              .replace(/^\[|\]$/g, '')
              .replace(/^`|`$/g, '')
          )
          .filter((key) => key.length > 0),
      }));
    },
    [updateOutputConfig]
  );

  const handleSchemaPolicyChange = useCallback(
    (nextPolicy: string) => {
      updateOutputConfig((config) => ({
        ...config,
        schemaPolicy: nextPolicy === 'extend' ? undefined : nextPolicy,
      }));
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
    <div className="grid gap-x-3 gap-y-2.5 sm:col-span-2 sm:grid-cols-2">
      <div>
        <span className="mb-1.5 block text-xs font-medium text-text-secondary">
          {t('data.workflow.outputStrategy')}
        </span>
        <GlassSegmentedControl
          value={strategy}
          onChange={handleStrategyChange}
          options={[
            { value: 'auto', label: t('data.workflow.values.outputStrategies.auto') },
            { value: 'existing', label: t('data.workflow.values.outputStrategies.existing') },
          ]}
          ariaLabel={t('data.workflow.outputStrategy')}
        />
      </div>

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
              // Bound table missing from choices (still loading or beyond the
              // fetch cap): keep the option selectable but display its saved
              // display name instead of the raw id.
              ...(selectedOutputDatasetId &&
              !availableOutputTables.some(
                (outputTable) => outputTable.id === selectedOutputDatasetId
              )
                ? [
                    {
                      value: selectedOutputDatasetId,
                      label: stringValue(node.config.outputTableName) || selectedOutputDatasetId,
                    },
                  ]
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

      <div className="sm:col-span-2">
        <span className="mb-1.5 block text-xs font-medium text-text-secondary">
          {t('data.workflow.outputMode')}
        </span>
        <GlassSegmentedControl
          fill
          value={mode}
          onChange={handleModeChange}
          options={[
            { value: 'replace', label: t('data.workflow.values.outputModes.replace') },
            { value: 'append', label: t('data.workflow.values.outputModes.append') },
            {
              value: 'error_if_exists',
              label: t('data.workflow.values.outputModes.error_if_exists'),
            },
            { value: 'merge', label: t('data.workflow.values.outputModes.merge') },
          ]}
          ariaLabel={t('data.workflow.outputMode')}
        />
      </div>

      {mode === 'merge' && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-text-secondary">
            {t('data.workflow.mergeKeys')}
          </span>
          <input
            value={mergeKeysText}
            onChange={(event) => handleMergeKeysChange(event.target.value)}
            placeholder={t('data.workflow.mergeKeysPlaceholder')}
            className="h-8 w-full rounded-lg border border-border-muted bg-surface px-2 text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
      )}

      {(mode === 'append' || mode === 'merge') && (
        <div>
          <span className="mb-1.5 block text-xs font-medium text-text-secondary">
            {t('data.workflow.schemaPolicy')}
          </span>
          <GlassSegmentedControl
            value={schemaPolicy}
            onChange={handleSchemaPolicyChange}
            options={[
              { value: 'extend', label: t('data.workflow.values.schemaPolicies.extend') },
              { value: 'strict', label: t('data.workflow.values.schemaPolicies.strict') },
              { value: 'ignore', label: t('data.workflow.values.schemaPolicies.ignore') },
            ]}
            ariaLabel={t('data.workflow.schemaPolicy')}
          />
        </div>
      )}
    </div>
  );
}

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataResultTable, DataWorkflowNode } from '../../../../types';
import { GlassSelect } from '../../../GlassSelect';
import { Info } from 'lucide-react';
import {
  Cell,
  FormGrid,
  FormScroll,
  GlassCommitTextInput,
  HintRow,
  LabelCell,
  SegmentCells,
} from '../../../workflow-forms/shared/FormGrid';
import { GlassOptionMultiSelect } from '../../../workflow-forms/shared/GlassOptionMultiSelect';
import { OUTPUT_GRID_COLUMNS } from '../../../workflow-forms/shared/gridColumns';
import { stringValue } from './workflow-summary';

export function WorkflowOutputConfig({
  node,
  resultTables,
  fieldCompletions = [],
  onNodeChange,
}: {
  node: DataWorkflowNode;
  resultTables: DataResultTable[];
  /** Upstream fields, offered as business-key options. */
  fieldCompletions?: string[];
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}) {
  const { t } = useTranslation();
  const selectedOutputRawTableId =
    stringValue(node.config.outputResultTableId) || stringValue(node.config.resultTableId);
  const configuredStrategy = stringValue(node.config.outputStrategy);
  const strategy =
    configuredStrategy === 'auto' || configuredStrategy === 'existing'
      ? configuredStrategy
      : selectedOutputRawTableId
        ? 'existing'
        : 'auto';
  const autoResultTableName =
    stringValue(node.config.resultTableName) || stringValue(node.config.table);
  const mode = stringValue(node.config.mode, 'replace');
  const schemaPolicy = stringValue(node.config.schemaPolicy, 'extend');
  const mergeKeys = Array.isArray(node.config.mergeKeys)
    ? node.config.mergeKeys.map((key) => String(key))
    : [];
  const availableResultTables = resultTables.filter(
    (resultTable) =>
      resultTable.relatedPipelineNames.length === 0 || resultTable.id === selectedOutputRawTableId
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
          delete nextConfig.outputResultTableId;
          delete nextConfig.resultTableId;
          delete nextConfig.table;
          return nextConfig;
        }

        const selected =
          availableResultTables.find(
            (resultTable) => resultTable.id === selectedOutputRawTableId
          ) ?? availableResultTables[0];
        if (selected) {
          nextConfig.outputResultTableId = selected.id;
          nextConfig.table = selected.tableName;
        } else {
          delete nextConfig.outputResultTableId;
          delete nextConfig.resultTableId;
        }
        return nextConfig;
      });
    },
    [availableResultTables, selectedOutputRawTableId, updateOutputConfig]
  );

  const handleAutoTableNameChange = useCallback(
    (tableName: string) => {
      updateOutputConfig((config) => {
        const nextConfig: Record<string, unknown> = {
          ...config,
          outputStrategy: 'auto',
          destination: 'duckdb_table',
          mode: stringValue(config.mode, 'replace'),
          resultTableName: tableName,
        };
        delete nextConfig.resultTableId;
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
    (keys: string[]) => {
      updateOutputConfig((config) => ({
        ...config,
        mergeKeys: keys
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

  const handleResultTableChange = useCallback(
    (outputResultTableId: string) => {
      updateOutputConfig((config) => {
        const selectedResultTable = resultTables.find(
          (resultTable) => resultTable.id === outputResultTableId
        );
        const nextConfig: Record<string, unknown> = {
          ...config,
          outputStrategy: 'existing',
          destination: 'duckdb_table',
          mode: stringValue(config.mode, 'replace'),
        };
        if (selectedResultTable) {
          nextConfig.outputResultTableId = selectedResultTable.id;
          nextConfig.table = selectedResultTable.tableName;
          nextConfig.resultTableName = selectedResultTable.name;
        } else {
          delete nextConfig.outputResultTableId;
          delete nextConfig.resultTableId;
        }
        return nextConfig;
      });
    },
    [resultTables, updateOutputConfig]
  );

  const showSchemaPolicy = mode === 'append' || mode === 'merge';
  const tableLabel =
    strategy === 'auto'
      ? autoResultTableName || t('data.workflow.autoResultTable')
      : stringValue(node.config.resultTableName) ||
        availableResultTables.find((item) => item.id === selectedOutputRawTableId)?.name ||
        t('data.workflow.noAvailableResultTables');
  const summaryParts = [
    mode === 'merge'
      ? t('data.workflow.outputSummary.mode.merge', {
          keys: mergeKeys.length > 0 ? mergeKeys.join('、') : '—',
        })
      : t(`data.workflow.outputSummary.mode.${mode}`),
    showSchemaPolicy ? t(`data.workflow.outputSummary.policy.${schemaPolicy}`) : '',
  ].filter(Boolean);

  return (
    <FormScroll>
      <FormGrid columns={OUTPUT_GRID_COLUMNS} testId="output-form-grid">
        <LabelCell>{t('data.workflow.outputStrategy')}</LabelCell>
        <SegmentCells
          value={strategy}
          onChange={handleStrategyChange}
          options={[
            { value: 'auto', label: t('data.workflow.values.outputStrategies.auto') },
            { value: 'existing', label: t('data.workflow.values.outputStrategies.existing') },
          ]}
          ariaLabel={t('data.workflow.outputStrategy')}
        />
        <Cell span={3} v={['muted']}>
          <span className="truncate">{t(`data.workflow.outputStrategyTips.${strategy}`)}</span>
        </Cell>

        {strategy === 'auto' ? (
          <>
            <LabelCell required>{t('data.workflow.resultTableName')}</LabelCell>
            <Cell span={5} v={['ctl', !autoResultTableName.trim() && 'err']}>
              <GlassCommitTextInput
                value={autoResultTableName}
                onCommit={(value) => handleAutoTableNameChange(value.trim())}
                placeholder={t('data.workflow.autoResultTable')}
                ariaLabel={t('data.workflow.resultTableName')}
                ariaInvalid={!autoResultTableName.trim()}
                className="h-full w-full px-2.5 text-[13px]"
              />
            </Cell>
          </>
        ) : (
          <>
            <LabelCell required>{t('data.workflow.resultTable')}</LabelCell>
            <Cell span={5} v={['ctl']}>
              <GlassSelect
                value={selectedOutputRawTableId || undefined}
                onValueChange={handleResultTableChange}
                options={[
                  // Bound table missing from choices (still loading or beyond the
                  // fetch cap): keep the option selectable but display its saved
                  // display name instead of the raw id.
                  ...(selectedOutputRawTableId &&
                  !availableResultTables.some(
                    (resultTable) => resultTable.id === selectedOutputRawTableId
                  )
                    ? [
                        {
                          value: selectedOutputRawTableId,
                          label:
                            stringValue(node.config.resultTableName) || selectedOutputRawTableId,
                        },
                      ]
                    : []),
                  ...availableResultTables.map((resultTable) => ({
                    value: resultTable.id,
                    label: resultTable.name,
                  })),
                ]}
                placeholder={t('data.workflow.noAvailableResultTables')}
                disabled={!selectedOutputRawTableId && availableResultTables.length === 0}
                triggerClassName="w-full justify-between text-[13px] text-text-primary"
                contentClassName="w-[var(--radix-select-trigger-width)]"
              />
            </Cell>
          </>
        )}

        <LabelCell>{t('data.workflow.outputMode')}</LabelCell>
        <SegmentCells
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
        <Cell v={['blank']} />

        {mode === 'merge' ? (
          <>
            <LabelCell required>{t('data.workflow.mergeKeys')}</LabelCell>
            <Cell span={5} v={['ctl', 'chips', mergeKeys.length === 0 && 'err']}>
              <GlassOptionMultiSelect
                options={[...new Set([...fieldCompletions, ...mergeKeys])]}
                selected={mergeKeys}
                onChange={handleMergeKeysChange}
                placeholder={t('data.workflow.mergeKeysPick')}
                maxHeight="300px"
              />
            </Cell>
          </>
        ) : null}

        {showSchemaPolicy ? (
          <>
            <LabelCell>{t('data.workflow.schemaPolicy')}</LabelCell>
            <SegmentCells
              value={schemaPolicy}
              onChange={handleSchemaPolicyChange}
              options={[
                { value: 'extend', label: t('data.workflow.values.schemaPolicies.extend') },
                { value: 'strict', label: t('data.workflow.values.schemaPolicies.strict') },
                { value: 'ignore', label: t('data.workflow.values.schemaPolicies.ignore') },
              ]}
              ariaLabel={t('data.workflow.schemaPolicy')}
            />
            <Cell span={2} v={['muted']}>
              <span className="truncate">
                {t(`data.workflow.schemaPolicyTips.${schemaPolicy}`)}
              </span>
            </Cell>
          </>
        ) : null}

        <HintRow span={6}>
          <Info className="opg-ic h-3.5 w-3.5" />
          <span className="min-w-0 truncate">
            {t('data.workflow.outputSummary.prefix')}
            <b className="font-medium text-text-secondary">{tableLabel}</b>
            {' · '}
            {summaryParts.join('，')}
          </span>
        </HintRow>
      </FormGrid>
    </FormScroll>
  );
}

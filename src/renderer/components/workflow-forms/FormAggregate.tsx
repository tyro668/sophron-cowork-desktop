import { Fragment, useCallback, useMemo } from 'react';
import { Settings } from 'lucide-react';
import type { OperatorFormProps } from './types';
import { GlassOptionMultiSelect } from './shared/GlassOptionMultiSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { MetricExpressionCell, autoMetricAlias } from './shared/MetricExpressionCell';
import {
  AddRow,
  Cell,
  ErrorRow,
  FormGrid,
  FormScroll,
  GlassCommitTextInput,
  GridRow,
  LabelCell,
  RowActionsCell,
} from './shared/FormGrid';
import { useGridRowDrag } from './shared/useGridRowDrag';
import { AGGREGATE_GRID_COLUMNS } from './shared/gridColumns';
import { validateAggregateMetrics } from './shared/metricValidation';
import {
  canAppendRow,
  ensureStableRowIds,
  insertRowAfter,
  removeRowAt,
  patchRowAt,
} from './shared/rowListOperations';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { isTemporalDataFieldType } from '../../../shared/data-field-types';
import { AGGREGATE_FUNCTIONS, createMetricId } from '../../../shared/operator-schemas/common';
import {
  retainSelectedDateGranularity,
  setDateGranularity,
  type AggregateDateGranularity,
} from '../../../shared/operator-config';
import {
  MAX_METRIC_COUNT,
  type AggregateFunction,
  type MetricEntry,
} from '../../../shared/operator-schemas';

const EMPTY_METRIC: Readonly<Omit<MetricEntry, 'id'>> = {
  function: 'count',
  expression: '',
  alias: '',
};

function createEmptyMetric(): MetricEntry {
  return { ...EMPTY_METRIC, id: createMetricId() };
}

const GRANULARITY_OPTIONS = [
  { value: '', labelKey: 'granularityNone' },
  { value: 'year', labelKey: 'granularityYear' },
  { value: 'quarter', labelKey: 'granularityQuarter' },
  { value: 'month', labelKey: 'granularityMonth' },
  { value: 'week', labelKey: 'granularityWeek' },
  { value: 'day', labelKey: 'granularityDay' },
] as const;

export default function FormAggregate({
  node,
  fieldCompletions,
  sourceNode,
  pipelineId,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('aggregate');
  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const groupBy = useMemo(() => (node.config.groupBy as string[]) ?? [], [node.config.groupBy]);
  const dateGranularity = useMemo(
    () => (node.config.dateGranularity as Record<string, string> | undefined) ?? {},
    [node.config.dateGranularity]
  );
  const rawMetrics = useMemo(
    () => (node.config.metrics as MetricEntry[]) ?? [],
    [node.config.metrics]
  );
  const metrics = useMemo(
    () =>
      rawMetrics.length > 0
        ? ensureStableRowIds(rawMetrics, createMetricId)
        : [createEmptyMetric()],
    [rawMetrics]
  );

  const functionGroups = useMemo(
    () => [
      {
        key: 'default',
        items: AGGREGATE_FUNCTIONS.map((f) => ({
          value: f,
          label: tr('aggregateFns.' + f),
        })),
      },
    ],
    [tr]
  );

  const handleGroupByChange = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => {
        return {
          ...cfg,
          groupBy: next.length > 0 ? next : undefined,
          dateGranularity: retainSelectedDateGranularity(
            cfg.dateGranularity as Record<string, string> | undefined,
            next
          ),
        };
      });
    },
    [updateConfig]
  );

  const handleGranularityChange = useCallback(
    (field: string, value: string) => {
      updateConfig((cfg) => {
        return {
          ...cfg,
          dateGranularity: setDateGranularity(
            cfg.dateGranularity as Record<string, string> | undefined,
            field,
            value as AggregateDateGranularity | ''
          ),
        };
      });
    },
    [updateConfig]
  );

  const handleMetricsChange = useCallback(
    (items: MetricEntry[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        metrics: items.length > 0 ? ensureStableRowIds(items, createMetricId) : undefined,
      }));
    },
    [updateConfig]
  );

  const updateMetric = useCallback(
    (index: number, patch: Partial<MetricEntry>) => {
      updateConfig((cfg) => {
        // Keep the output name in sync while it is empty or still auto-generated.
        const current = metrics[index] ?? createEmptyMetric();
        const rowsLabel = tr('metricRowsAlias');
        const prevAuto = autoMetricAlias(current.function, current.expression ?? '', rowsLabel);
        const merged = { ...current, ...patch };
        const nextAuto = autoMetricAlias(merged.function, merged.expression ?? '', rowsLabel);
        const partial =
          !('alias' in patch) && (!current.alias || current.alias === prevAuto) && nextAuto
            ? { ...patch, alias: nextAuto }
            : patch;
        const next = patchRowAt(
          (cfg.metrics as MetricEntry[] | undefined) ?? [],
          metrics,
          index,
          partial
        );
        return { ...cfg, metrics: ensureStableRowIds(next, createMetricId) };
      });
    },
    [metrics, tr, updateConfig]
  );

  const {
    activeItems: activeMetrics,
    rowProps,
    dragHandle,
  } = useGridRowDrag(metrics, handleMetricsChange);

  const addMetricAfter = useCallback(
    (index: number) => {
      if (!canAppendRow(activeMetrics.length, MAX_METRIC_COUNT)) return;
      handleMetricsChange(insertRowAfter(activeMetrics, index, createEmptyMetric()));
    },
    [activeMetrics, handleMetricsChange]
  );

  const copyMetric = useCallback(
    (index: number) => {
      if (!canAppendRow(activeMetrics.length, MAX_METRIC_COUNT)) return;
      const source = activeMetrics[index];
      const clone: MetricEntry = {
        ...source,
        id: createMetricId(),
        alias: source.alias ? tr('copyNameSuffix', { name: source.alias }) : '',
      };
      handleMetricsChange(insertRowAfter(activeMetrics, index, clone));
    },
    [activeMetrics, handleMetricsChange, tr]
  );

  const removeMetric = useCallback(
    (index: number) => {
      handleMetricsChange(removeRowAt(activeMetrics, index));
    },
    [activeMetrics, handleMetricsChange]
  );

  const canAddMetric = canAppendRow(activeMetrics.length, MAX_METRIC_COUNT);

  const issues = useMemo(
    () => validateAggregateMetrics(activeMetrics, groupBy),
    [activeMetrics, groupBy]
  );
  const rowLabels = {
    add: tr('rowAdd'),
    copy: tr('rowCopy'),
    remove: tr('rowRemove'),
    drag: tr('rowDrag'),
  };
  const errorCount = issues.reduce((n, item) => n + item.messages.length, 0);

  return (
    <FormScroll>
      <FormGrid columns={AGGREGATE_GRID_COLUMNS} testId="aggregate-form-grid">
        <LabelCell>{tr('aggregateGroupFieldsLabel')}</LabelCell>
        <Cell span={4} v={['ctl', 'chips']}>
          <GlassOptionMultiSelect
            options={fieldCompletions}
            selected={groupBy}
            onChange={handleGroupByChange}
            optionTypes={columnTypes}
            placeholder={tr('common.selectColumns')}
            maxHeight="300px"
            optionLabel={(col) => {
              const gran = dateGranularity[col];
              if (gran && isTemporalDataFieldType(columnTypes[col])) {
                const opt = GRANULARITY_OPTIONS.find((o) => o.value === gran);
                const label = opt ? tr(opt.labelKey) : gran;
                return tr('aggregateFieldWithGranularity', { field: col, granularity: label });
              }
              return col;
            }}
            itemExtras={(col) => {
              if (!isTemporalDataFieldType(columnTypes[col])) return null;
              const gran = dateGranularity[col] || '';
              return (
                <GlassDropdownMenu
                  trigger={
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-muted/50 hover:text-accent transition-colors"
                      title={tr('granularitySelect')}
                    >
                      <Settings className="h-3 w-3" />
                    </button>
                  }
                  align="center"
                  side="right"
                >
                  {GRANULARITY_OPTIONS.map((opt) => (
                    <GlassMenuItem
                      key={opt.value}
                      selected={gran === opt.value}
                      onSelect={() => handleGranularityChange(col, opt.value)}
                    >
                      {tr(opt.labelKey)}
                    </GlassMenuItem>
                  ))}
                </GlassDropdownMenu>
              );
            }}
          />
        </Cell>

        <LabelCell rowSpan={1 + activeMetrics.length + errorCount + 1}>
          {tr('aggregateMeasuresLabel')}
        </LabelCell>
        <Cell v={['th']}>{tr('aggregateFns.aggregateFunction')}</Cell>
        <Cell v={['th']}>{tr('aggregateExpressionColumn')}</Cell>
        <Cell v={['th']}>{tr('aggregateAlias')}</Cell>
        <Cell v={['th']} />
        {activeMetrics.map((metric, index) => {
          const issue = issues[index];
          return (
            <Fragment key={metric.id ?? `metric-${index}`}>
              <GridRow {...rowProps(index)} testId={`aggregate-metric-row-${index}`}>
                <Cell v={['ctl']}>
                  <GlassOptionSingleSelect
                    value={metric.function}
                    groups={functionGroups}
                    onChange={(value) =>
                      updateMetric(index, { function: value as AggregateFunction })
                    }
                    className="w-full"
                  />
                </Cell>
                <Cell v={['ctl', issue.expressionError && 'err']}>
                  <MetricExpressionCell
                    value={metric.expression ?? ''}
                    onChange={(value) => updateMetric(index, { expression: value })}
                    fieldCompletions={fieldCompletions}
                    columnTypes={columnTypes}
                    allowAllRows={metric.function === 'count'}
                    placeholder={tr('aggregateExpressionPlaceholder')}
                  />
                </Cell>
                <Cell v={['ctl', issue.aliasError && 'err']}>
                  <GlassCommitTextInput
                    value={metric.alias ?? ''}
                    onCommit={(value) => updateMetric(index, { alias: value.trim() })}
                    placeholder={tr('aggregateAliasPlaceholder')}
                    ariaLabel={tr('aggregateAlias')}
                    ariaInvalid={issue.aliasError}
                    className="h-full w-full px-2.5 text-[13px]"
                  />
                </Cell>
                <RowActionsCell
                  labels={rowLabels}
                  onAdd={() => addMetricAfter(index)}
                  onCopy={() => copyMetric(index)}
                  onRemove={() => removeMetric(index)}
                  canAdd={canAddMetric}
                  dragHandle={dragHandle(index)}
                />
              </GridRow>
              {issue.messages.map((message) => (
                <ErrorRow key={`${index}-${message.key}`} span={4}>
                  <b>{tr('rowPrefix', { index: index + 1 })}</b>
                  {tr(message.key, message.params)}
                </ErrorRow>
              ))}
            </Fragment>
          );
        })}
        <AddRow
          span={4}
          label={tr('aggregateAddMetric')}
          onClick={() => addMetricAfter(activeMetrics.length - 1)}
          disabled={!canAddMetric}
        />
      </FormGrid>
    </FormScroll>
  );
}

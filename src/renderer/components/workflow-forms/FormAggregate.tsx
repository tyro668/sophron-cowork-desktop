import { useCallback, useEffect, useMemo } from 'react';
import { Settings } from 'lucide-react';
import type { OperatorFormProps } from './types';
import { GlassOptionMultiSelect } from './shared/GlassOptionMultiSelect';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassRowList, type RowAction } from './shared/GlassRowList';
import {
  canAppendRow,
  ensureStableRowIds,
  insertRowAfter,
  removeRowAt,
} from './shared/rowListOperations';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
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
  taskId,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('aggregate');
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
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
    (index: number, partial: Partial<MetricEntry>) => {
      handleMetricsChange(metrics.map((item, i) => (i === index ? { ...item, ...partial } : item)));
    },
    [metrics, handleMetricsChange]
  );

  const {
    activeItems: activeMetrics,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleKeyboardMove,
    isDragging,
    resetDrag,
    dragIndexRef,
  } = useDragReorder(metrics, handleMetricsChange);

  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [metrics, isDragging, resetDrag]);

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
        alias: '',
      };
      handleMetricsChange(insertRowAfter(activeMetrics, index, clone));
    },
    [activeMetrics, handleMetricsChange]
  );

  const removeMetric = useCallback(
    (index: number) => {
      handleMetricsChange(removeRowAt(activeMetrics, index));
    },
    [activeMetrics, handleMetricsChange]
  );

  return (
    <div className="scrollbar-hover flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('aggregateDimensionsLabel')}</GlassFormLabel>
        <div className="min-w-0 flex-1">
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
        </div>
      </div>

      <div className="flex items-start gap-2">
        <GlassFormLabel>{tr('aggregateMeasuresLabel')}</GlassFormLabel>
        <div className="min-w-0 flex-1">
          <GlassRowList
            items={activeMetrics}
            getKey={(metric, index) => metric.id ?? `metric-${index}`}
            columns={[
              {
                flex: 'flex-[0.8]',
                header: tr('aggregateFns.aggregateFunction'),
                render: (metric: MetricEntry, index: number) => (
                  <GlassOptionSingleSelect
                    value={metric.function}
                    groups={functionGroups}
                    onChange={(value) =>
                      updateMetric(index, { function: value as AggregateFunction })
                    }
                    variant="highlight"
                    className="h-8 w-full text-[12px] [&>span]:text-left"
                  />
                ),
              },
              {
                flex: 'flex-[1.6]',
                header: tr('expression.expressionLabel'),
                render: (metric: MetricEntry, index: number) => (
                  <GlassExpressionInput
                    value={metric.expression}
                    onChange={(value) => updateMetric(index, { expression: value })}
                    fieldCompletions={fieldCompletions}
                    columnTypes={columnTypes}
                    placeholder={tr('aggregateExpressionPlaceholder')}
                  />
                ),
              },
              {
                flex: 'flex-[1]',
                header: tr('aggregateAlias'),
                render: (metric: MetricEntry, index: number) => (
                  <GlassFormTextInput
                    value={metric.alias ?? ''}
                    onChange={(value) => updateMetric(index, { alias: value })}
                    placeholder={tr('aggregateAliasPlaceholder')}
                    className="h-8 w-full px-2 text-[12px]"
                  />
                ),
              },
            ]}
            actions={['add', 'copy', 'remove']}
            onAdd={addMetricAfter}
            onCopy={copyMetric}
            onRemove={removeMetric}
            canAct={(action: RowAction) =>
              action === 'remove' || canAppendRow(activeMetrics.length, MAX_METRIC_COUNT)
            }
            addTitle={tr('aggregateAddMetric')}
            copyTitle={tr('rowList.copyRow')}
            removeTitle={tr('aggregateRemoveMetric')}
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onKeyboardMove={handleKeyboardMove}
            getRowOpacity={(i) => !!(isDragging && dragIndexRef.current === i)}
            dragTitle={tr('rowList.dragToReorder')}
          />
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo } from 'react';
import { GripVertical, Plus, Settings, XCircle } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFieldCompactSelect } from './shared/GlassFieldCompactSelect';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { isTemporalDataFieldType } from '../../../shared/data-field-types';
import { AGGREGATE_FUNCTIONS } from '../../../shared/operator-schemas/common';
import {
  retainSelectedDateGranularity,
  setDateGranularity,
  type AggregateDateGranularity,
} from '../../../shared/operator-config';
import type { AggregateFunction, MetricEntry } from '../../../shared/operator-schemas';

const EMPTY_METRIC: Readonly<MetricEntry> = {
  function: 'count',
  expression: '',
  alias: '',
};

const GRANULARITY_OPTIONS = [
  { value: '', labelKey: 'granularityNone', labelFallback: '不处理' },
  { value: 'year', labelKey: 'granularityYear', labelFallback: '按年' },
  { value: 'quarter', labelKey: 'granularityQuarter', labelFallback: '按季度' },
  { value: 'month', labelKey: 'granularityMonth', labelFallback: '按月' },
  { value: 'week', labelKey: 'granularityWeek', labelFallback: '按周' },
  { value: 'day', labelKey: 'granularityDay', labelFallback: '按天' },
] as const;

export default function FormAggregate({
  node,
  fieldCompletions,
  sourceNode,
  taskId,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation();
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
    () => (rawMetrics.length > 0 ? rawMetrics : [{ ...EMPTY_METRIC }]),
    [rawMetrics]
  );

  const functionGroups = useMemo(
    () => [
      {
        key: 'default',
        items: AGGREGATE_FUNCTIONS.map((f) => ({
          value: f,
          label: tr('aggregateFn_' + f),
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
        metrics: items.length > 0 ? items : undefined,
      }));
    },
    [updateConfig]
  );

  function updateMetric(index: number, partial: Partial<MetricEntry>) {
    handleMetricsChange(metrics.map((item, i) => (i === index ? { ...item, ...partial } : item)));
  }

  function addMetricAfter(index: number) {
    if (activeMetrics.some((metric) => !metric.expression)) return;
    handleMetricsChange([
      ...activeMetrics.slice(0, index + 1),
      { ...EMPTY_METRIC },
      ...activeMetrics.slice(index + 1),
    ]);
  }

  function removeMetric(index: number) {
    const remaining = activeMetrics.filter((_, metricIndex) => metricIndex !== index);
    const firstEmptyIndex = remaining.findIndex((metric) => !metric.expression);
    handleMetricsChange(
      firstEmptyIndex < 0
        ? remaining
        : remaining.filter(
            (metric, metricIndex) => metricIndex === firstEmptyIndex || metric.expression
          )
    );
  }

  const {
    activeItems: activeMetrics,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    isDragging,
    resetDrag,
    dragIndexRef,
  } = useDragReorder(metrics, handleMetricsChange);

  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [metrics, isDragging, resetDrag]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex gap-2.5 flex-1 min-h-0">
        {/* Left: group-by fields */}
        <section className="operator-section flex-[4] content-start flex flex-col min-h-0">
          <div className="flex-1 min-h-0 px-3 pb-3 flex flex-col">
            <div className="mb-3 px-0.5 pt-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                {tr('aggregateDimensionsLabel')}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-text-muted">
                {tr('aggregateDimensionsHint')}
              </p>
            </div>
            <GlassFieldCompactSelect
              columns={fieldCompletions}
              selected={groupBy}
              onChange={handleGroupByChange}
              columnTypes={columnTypes}
              maxHeight="none"
              columnLabel={(col) => {
                const gran = dateGranularity[col];
                if (gran && isTemporalDataFieldType(columnTypes[col])) {
                  const opt = GRANULARITY_OPTIONS.find((o) => o.value === gran);
                  const label = opt ? tr(opt.labelKey) : gran;
                  return `${col}（${label}）`;
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
        </section>

        {/* Right: metrics */}
        <section className="operator-section flex flex-[6] min-h-0 flex-col content-start">
          <div className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto border-l border-border-subtle/70 pl-3 pr-3 grid content-start gap-3">
            <div className="flex items-start justify-between gap-3 pt-1">
              <div>
                <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                  <span className="h-2 w-2 rounded-full bg-accent" />
                  {tr('aggregateMeasuresLabel')}
                </div>
                <p className="mt-1 text-[12px] leading-5 text-text-muted">
                  {tr('aggregateMeasuresHint')}
                </p>
              </div>
              <button
                type="button"
                disabled={activeMetrics.some((metric) => !metric.expression)}
                onClick={() => addMetricAfter(activeMetrics.length - 1)}
                className="flex h-9 flex-none items-center gap-1.5 rounded-lg border border-accent px-3 text-[12px] font-medium text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                {tr('aggregateAddMetric')}
              </button>
            </div>

            <div className="grid grid-cols-[minmax(88px,0.7fr)_minmax(0,1.5fr)_minmax(96px,0.9fr)_28px_32px] items-center gap-2 px-3 text-[12px] font-medium text-text-muted">
              <span>{tr('aggregateFunction')}</span>
              <span>{tr('expressionLabel')}</span>
              <span>{tr('aggregateAlias')}</span>
              <span />
              <span />
            </div>

            <div className="grid gap-2">
              {activeMetrics.map((metric, index) => {
                const dragging = isDragging && dragIndexRef.current === index;
                return (
                  <div
                    key={index}
                    onDragOver={(event) => handleDragOver(event, index)}
                    className={`grid min-h-14 grid-cols-[minmax(88px,0.7fr)_minmax(0,1.5fr)_minmax(96px,0.9fr)_28px_32px] items-center gap-2 rounded-lg border border-border-muted bg-background px-3 py-2 transition-opacity ${
                      dragging ? 'opacity-50' : ''
                    }`}
                  >
                    <GlassOptionSingleSelect
                      value={metric.function}
                      groups={functionGroups}
                      onChange={(value) =>
                        updateMetric(index, { function: value as AggregateFunction })
                      }
                      className="h-8 w-full !border-transparent !bg-[rgb(var(--color-surface-active-rgb))] text-[12px] !text-accent-text hover:!bg-[rgb(var(--color-surface-active-rgb))] [&>span]:text-left"
                    />
                    <GlassExpressionInput
                      value={metric.expression}
                      onChange={(value) => updateMetric(index, { expression: value })}
                      fieldCompletions={fieldCompletions}
                      columnTypes={columnTypes}
                      placeholder={tr('aggregateExpressionPlaceholder')}
                    />
                    <GlassFormTextInput
                      value={metric.alias ?? ''}
                      onChange={(value) => updateMetric(index, { alias: value })}
                      placeholder={tr('aggregateAliasPlaceholder')}
                      className="h-8 w-full px-2 text-[12px]"
                    />
                    <div
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragEnd={handleDragEnd}
                      className="flex h-8 w-7 cursor-grab items-center justify-center text-text-muted transition-colors hover:text-text-secondary active:cursor-grabbing"
                      title={tr('dragToReorder')}
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMetric(index)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-error/10 hover:text-error"
                      title={tr('aggregateRemoveMetric')}
                      aria-label={tr('aggregateRemoveMetric')}
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

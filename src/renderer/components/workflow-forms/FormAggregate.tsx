import { useCallback, useEffect, useMemo } from 'react';
import { Settings } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import { GlassRowList, type RowAction } from './shared/GlassRowList';
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
        <section className="operator-section flex-[1.5] content-start flex flex-col min-h-0">
          <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5 shrink-0">
            <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
              1
            </span>
            <div className="grid">
              <span className="text-[13px] font-semibold text-text-primary">
                {tr('aggregateGroupBy')}
              </span>
              <span className="text-[10px] text-text-muted">{tr('aggregateGroupByHint')}</span>
            </div>
          </div>
          <div className="flex-1 min-h-0 px-3 pb-3 flex flex-col">
            <GlassFieldMultiSelect
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
        <section className="operator-section flex-[8.5] content-start flex flex-col min-h-0 border-l border-border-subtle/70">
          <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5 shrink-0">
            <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
              2
            </span>
            <div className="grid">
              <span className="text-[13px] font-semibold text-text-primary">
                {tr('aggregateMetric')}
              </span>
              <span className="text-[10px] text-text-muted">{tr('aggregateMetricHint')}</span>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
            <GlassRowList
              headerClassName="text-[12px]"
              items={activeMetrics}
              columns={[
                {
                  flex: 'flex-[2.5]',
                  header: tr('aggregateFunction'),
                  render: (item: MetricEntry, i: number) => (
                    <GlassOptionSingleSelect
                      value={item.function}
                      groups={functionGroups}
                      onChange={(v) => updateMetric(i, { function: v as AggregateFunction })}
                      className="h-7 rounded-md text-[12px] w-full"
                    />
                  ),
                },
                {
                  flex: 'flex-[3.5]',
                  header: tr('expressionLabel'),
                  render: (item: MetricEntry, i: number) => (
                    <GlassExpressionInput
                      value={item.expression}
                      onChange={(v) => updateMetric(i, { expression: v })}
                      fieldCompletions={fieldCompletions}
                      columnTypes={columnTypes}
                      placeholder={tr('aggregateExpressionPlaceholder')}
                    />
                  ),
                },
                {
                  flex: 'flex-[2]',
                  header: tr('aggregateAlias'),
                  render: (item: MetricEntry, i: number) => (
                    <GlassFormTextInput
                      value={item.alias ?? ''}
                      onChange={(v) => updateMetric(i, { alias: v })}
                      placeholder={tr('aggregateAliasPlaceholder')}
                      className="h-7 px-1.5 text-[12px] w-full"
                    />
                  ),
                },
              ]}
              onAdd={(i) => addMetricAfter(i)}
              onRemove={(i) => removeMetric(i)}
              addTitle={tr('aggregateAddMetric')}
              removeTitle={tr('aggregateRemoveMetric')}
              canAct={(action: RowAction) =>
                action === 'add' ? !activeMetrics.some((m) => !m.expression) : true
              }
              draggable
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              getRowOpacity={(i) => !!(isDragging && dragIndexRef.current === i)}
              dragTitle={tr('dragToReorder')}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Copy, Ellipsis, GripVertical, Plus, Settings, Trash2 } from 'lucide-react';
import type { OperatorFormProps } from './types';
import { GlassOptionMultiSelect } from './shared/GlassOptionMultiSelect';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFormLabel } from './shared/GlassFormLabel';
import {
  canAppendRow,
  ensureStableRowIds,
  insertRowAfter,
  removeRowAt,
} from './shared/rowListOperations';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import { DropdownMenuSeparator } from '../ui';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder, getReorderTargetIndex } from '../../hooks/useDragReorder';
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

  const canAddMetric = canAppendRow(activeMetrics.length, MAX_METRIC_COUNT);
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <div className="scrollbar-hover flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto px-3 py-2">
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

      <div className="border-t border-border-subtle" />

      <div className="flex items-center justify-between">
        <span className="text-[13px] text-text-secondary">{tr('aggregateMeasuresLabel')}</span>
        <button
          type="button"
          onClick={() => addMetricAfter(activeMetrics.length - 1)}
          disabled={!canAddMetric}
          className="inline-flex h-7 items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent-muted px-2.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          {tr('aggregateAddMetric')}
        </button>
      </div>

      <div ref={listRef} className="overflow-hidden rounded-lg border border-border-muted">
        <div className="flex h-7 items-center gap-2 border-b border-border-muted bg-[var(--data-grid-header-surface)] px-2 text-[12px] font-medium text-text-muted">
          <span className="w-6 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-[0.8] truncate px-2">
            {tr('aggregateFns.aggregateFunction')}
          </span>
          <span className="min-w-0 flex-[1.6] truncate px-2">
            {tr('aggregateExpressionColumn')}
          </span>
          <span className="min-w-0 flex-[1] truncate px-2">{tr('aggregateAlias')}</span>
          <span className="w-8 shrink-0" aria-hidden="true" />
        </div>
        {activeMetrics.map((metric, index) => (
          <div
            key={metric.id ?? `metric-${index}`}
            className={`flex items-center gap-2 border-b border-border-subtle px-2 py-1 transition-colors last:border-b-0 hover:bg-surface-hover/40 ${
              isDragging && dragIndexRef.current === index ? 'opacity-50' : ''
            }`}
            onDragOver={(event) => handleDragOver(event, index)}
          >
            <button
              type="button"
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragEnd={handleDragEnd}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                const direction = event.key === 'ArrowUp' ? 'up' : 'down';
                const targetIndex = getReorderTargetIndex(activeMetrics.length, index, direction);
                if (targetIndex === null) return;
                handleKeyboardMove(index, direction);
                requestAnimationFrame(() => {
                  const handles =
                    listRef.current?.querySelectorAll<HTMLButtonElement>('[data-row-drag-handle]');
                  handles?.[targetIndex]?.focus();
                });
              }}
              className="flex h-8 w-6 flex-shrink-0 cursor-grab items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-surface-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-accent/30 active:cursor-grabbing"
              title={tr('rowList.dragToReorder')}
              aria-label={tr('rowList.dragToReorder')}
              aria-keyshortcuts="ArrowUp ArrowDown"
              data-row-drag-handle
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-[0.8]">
              <GlassOptionSingleSelect
                value={metric.function}
                groups={functionGroups}
                onChange={(value) => updateMetric(index, { function: value as AggregateFunction })}
                className="h-8 w-full text-[12px] [&>span]:text-left"
              />
            </div>
            <div className="min-w-0 flex-[1.6]">
              <GlassExpressionInput
                value={metric.expression}
                onChange={(value) => updateMetric(index, { expression: value })}
                fieldCompletions={fieldCompletions}
                columnTypes={columnTypes}
                placeholder={tr('aggregateExpressionPlaceholder')}
              />
            </div>
            <div className="min-w-0 flex-[1]">
              <GlassFormTextInput
                value={metric.alias ?? ''}
                onChange={(value) => updateMetric(index, { alias: value })}
                placeholder={tr('aggregateAliasPlaceholder')}
                className="h-8 w-full px-2 text-[12px]"
              />
            </div>
            <div className="flex w-8 flex-shrink-0 justify-center">
              <GlassDropdownMenu
                trigger={
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted outline-none transition-colors hover:bg-surface-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-accent/30"
                    title={tr('aggregateMetricActions')}
                    aria-label={tr('aggregateMetricActions')}
                  >
                    <Ellipsis className="h-4 w-4" />
                  </button>
                }
                align="end"
                side="bottom"
              >
                <GlassMenuItem
                  icon={<Plus className="h-3.5 w-3.5" />}
                  disabled={!canAddMetric}
                  onSelect={() => addMetricAfter(index)}
                >
                  {tr('aggregateAddMetric')}
                </GlassMenuItem>
                <GlassMenuItem
                  icon={<Copy className="h-3.5 w-3.5" />}
                  disabled={!canAddMetric}
                  onSelect={() => copyMetric(index)}
                >
                  {tr('rowList.copyRow')}
                </GlassMenuItem>
                <DropdownMenuSeparator />
                <GlassMenuItem
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  danger
                  onSelect={() => removeMetric(index)}
                >
                  {tr('aggregateRemoveMetric')}
                </GlassMenuItem>
              </GlassDropdownMenu>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

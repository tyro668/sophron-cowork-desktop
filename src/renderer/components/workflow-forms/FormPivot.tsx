import { useCallback, useMemo, useState } from 'react';
import type { OperatorFormProps } from './index';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassTagBar } from './shared/GlassTagBar';
import { useWorkflowNodeColumnValues } from '../../hooks/useWorkflowNodeColumnValues';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { ChevronDown, GripVertical, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { addPivotCandidate, normalizePivotAxes } from '../../../shared/operator-config';
import type {
  AggregateFunction,
  PivotAxisEntry,
  PivotLiteral,
  PivotMetric,
} from '../../../shared/operator-schemas';

const PIVOT_FUNCTIONS = ['sum', 'avg', 'min', 'max', 'count', 'count_distinct'] as const;
const EMPTY_METRIC: Readonly<PivotMetric> = {
  function: 'count',
  expression: '',
  alias: '',
};

export default function FormPivot({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation();
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const axes = useMemo(() => normalizePivotAxes(node.config.on), [node.config.on]);

  const rawUsing = useMemo(() => (node.config.using as PivotMetric[]) ?? [], [node.config?.using]);
  const using = useMemo(() => (rawUsing.length > 0 ? rawUsing : [{ ...EMPTY_METRIC }]), [rawUsing]);
  const groupBy = useMemo(() => (node.config.groupBy as string[]) ?? [], [node.config?.groupBy]);

  const handleAxesChange = useCallback(
    (next: PivotAxisEntry[]) => {
      updateConfig((cfg) => ({ ...cfg, on: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  function updateAxis(index: number, patch: Partial<PivotAxisEntry>) {
    handleAxesChange(axes.map((axis, i) => (i === index ? { ...axis, ...patch } : axis)));
  }

  function handleAxisFieldChange(index: number, field: string) {
    if (axes[index]?.field === field) return;
    updateAxis(index, { field, values: [] });
  }

  function addAxisAfter(index: number) {
    if (axes.some((axis) => !axis.field)) return;
    handleAxesChange([
      ...axes.slice(0, index + 1),
      { field: '', values: [] },
      ...axes.slice(index + 1),
    ]);
  }

  function removeAxis(index: number) {
    if (axes.length <= 1) {
      handleAxesChange([]);
      return;
    }
    handleAxesChange(axes.filter((_, axisIndex) => axisIndex !== index));
  }

  const usedFields = useMemo(() => new Set(axes.map((axis) => axis.field)), [axes]);

  const handleGroupByChange = useCallback(
    (next: string[]) =>
      updateConfig((cfg) => ({ ...cfg, groupBy: next.length > 0 ? next : undefined })),
    [updateConfig]
  );

  const removeGroupBy = useCallback(
    (col: string) => handleGroupByChange(groupBy.filter((c) => c !== col)),
    [handleGroupByChange, groupBy]
  );

  const [expandedAxisIndex, setExpandedAxisIndex] = useState<number | null>(null);
  const [groupByOpen, setGroupByOpen] = useState(false);
  const clearGroupBy = useCallback(() => handleGroupByChange([]), [handleGroupByChange]);

  // ── 多指标管理 ──

  const handleUsingChange = useCallback(
    (items: PivotMetric[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        using: items.length > 0 ? items : undefined,
      }));
    },
    [updateConfig]
  );

  function updateMetric(index: number, patch: Partial<PivotMetric>) {
    handleUsingChange(using.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function addMetricAfter(index: number) {
    if (using.some((metric) => !metric.expression)) return;
    handleUsingChange([
      ...using.slice(0, index + 1),
      { ...EMPTY_METRIC },
      ...using.slice(index + 1),
    ]);
  }

  function removeMetric(index: number) {
    if (using.length <= 1) {
      handleUsingChange([]);
      return;
    }
    const remaining = using.filter((_, metricIndex) => metricIndex !== index);
    const firstEmptyIndex = remaining.findIndex((metric) => !metric.expression);
    handleUsingChange(
      firstEmptyIndex < 0
        ? remaining
        : remaining.filter(
            (metric, metricIndex) => metricIndex === firstEmptyIndex || metric.expression
          )
    );
  }

  const fnGroups = useMemo(
    () => [
      {
        key: 'fn',
        items: PIVOT_FUNCTIONS.map((f) => ({
          value: f,
          label: tr(`aggregateFn_${f}`),
        })),
      },
    ],
    [tr]
  );
  const {
    activeItems: activeMetrics,
    handleDragStart: handleMetricDragStart,
    handleDragOver: handleMetricDragOver,
    handleDragEnd: handleMetricDragEnd,
    isDragging: isMetricDragging,
    dragIndexRef: metricDragIndexRef,
  } = useDragReorder(using, handleUsingChange);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex gap-2.5 flex-1 min-h-0">
        {/* ═══ 左块: 透视字段与分组字段 ═══ */}
        <section className="operator-section scrollbar-hover flex-[4] content-start flex flex-col min-h-0 overflow-y-auto">
          <div className="grid content-start gap-3 px-3 pb-3">
            <div className="px-0.5 pt-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                {tr('pivotDimensionsLabel')}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-text-muted">
                {tr('pivotDimensionsHint')}
              </p>
            </div>

            <div className="rounded-lg border border-border-subtle/80 bg-surface-hover/45 p-2.5">
              <div className="mb-2 text-[13px] font-medium text-text-primary">
                {tr('pivotFieldsLabel')}
              </div>
              <div className="grid gap-2">
                {axes.map((axis, index) => (
                  <PivotAxisCard
                    key={`${axis.field}-${index}`}
                    axis={axis}
                    expanded={expandedAxisIndex === index}
                    fieldCompletions={fieldCompletions}
                    columnTypes={columnTypes}
                    disabledFields={
                      new Set([...usedFields].filter((field) => field !== axis.field))
                    }
                    taskId={taskId}
                    sourceNode={sourceNode}
                    tr={tr}
                    onFieldChange={(field) => handleAxisFieldChange(index, field)}
                    onValuesChange={(values) => updateAxis(index, { values })}
                    onToggle={() =>
                      setExpandedAxisIndex((current) => (current === index ? null : index))
                    }
                    onRemove={() => {
                      removeAxis(index);
                      setExpandedAxisIndex(null);
                    }}
                  />
                ))}
                <button
                  type="button"
                  disabled={axes.some((axis) => !axis.field)}
                  onClick={() => addAxisAfter(axes.length - 1)}
                  className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-muted text-[12px] text-text-secondary transition-colors hover:border-accent/50 hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {tr('pivotAddAxis')}
                </button>
              </div>
            </div>

            <div className="pt-1">
              <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-text-primary">
                {tr('pivotGroupByLabel')}
                <span className="text-[11px] font-normal text-text-muted">{tr('optional')}</span>
              </div>
              <GlassTagBar
                items={groupBy}
                onRemove={removeGroupBy}
                onClear={clearGroupBy}
                open={groupByOpen}
                onToggle={() => setGroupByOpen((current) => !current)}
                toggleStyle="chevron"
                density="default"
                className="min-h-10"
                placeholder={tr('aggregateGroupByPlaceholder')}
              />
              {groupByOpen && (
                <GlassFieldMultiSelect
                  columns={fieldCompletions}
                  selected={groupBy}
                  onChange={handleGroupByChange}
                  columnTypes={columnTypes}
                  maxHeight="180px"
                  className="mt-2 border-0 bg-transparent rounded-none"
                  searchBordered
                />
              )}
            </div>
          </div>
        </section>

        {/* ═══ 右块: 聚合指标 ═══ */}
        <section className="operator-section flex flex-[6] min-h-0 flex-col content-start">
          <div className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto border-l border-border-subtle/70 pl-3 pr-3 grid content-start gap-3">
            <div className="flex items-start justify-between gap-3 pt-1">
              <div>
                <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                  <span className="h-2 w-2 rounded-full bg-accent" />
                  {tr('pivotMeasuresLabel')}
                </div>
                <p className="mt-1 text-[12px] leading-5 text-text-muted">
                  {tr('pivotMeasuresHint')}
                </p>
              </div>
              <button
                type="button"
                disabled={using.some((metric) => !metric.expression)}
                onClick={() => addMetricAfter(using.length - 1)}
                className="flex h-9 flex-none items-center gap-1.5 rounded-lg border border-accent px-3 text-[12px] font-medium text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                {tr('pivotAddMetric')}
              </button>
            </div>

            <div className="grid grid-cols-[28px_minmax(88px,0.7fr)_minmax(0,1.5fr)_minmax(96px,0.9fr)_28px] items-center gap-2 px-3 text-[12px] font-medium text-text-muted">
              <span />
              <span>{tr('aggregateFunction')}</span>
              <span>{tr('expressionLabel')}</span>
              <span>{tr('aggregateAlias')}</span>
              <span />
            </div>

            <div className="grid gap-2">
              {activeMetrics.map((metric, index) => {
                const dragging = isMetricDragging && metricDragIndexRef.current === index;
                return (
                  <div
                    key={index}
                    onDragOver={(event) => handleMetricDragOver(event, index)}
                    className={`grid min-h-10 grid-cols-[28px_minmax(88px,0.7fr)_minmax(0,1.5fr)_minmax(96px,0.9fr)_28px] items-center gap-2 rounded-lg border border-border-muted bg-background px-3 py-1.5 transition-opacity ${
                      dragging ? 'opacity-50' : ''
                    }`}
                  >
                    <div
                      draggable
                      onDragStart={() => handleMetricDragStart(index)}
                      onDragEnd={handleMetricDragEnd}
                      className="flex h-7 w-7 cursor-grab items-center justify-center text-text-muted transition-colors hover:text-text-secondary active:cursor-grabbing"
                      title={tr('dragToReorder')}
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>
                    <GlassOptionSingleSelect
                      value={metric.function}
                      groups={fnGroups}
                      onChange={(value) =>
                        updateMetric(index, { function: value as AggregateFunction })
                      }
                      variant="highlight"
                      className="h-7 w-full text-[12px] [&>span]:text-left"
                    />
                    <GlassExpressionInput
                      value={metric.expression}
                      onChange={(value) => updateMetric(index, { expression: value })}
                      fieldCompletions={fieldCompletions}
                      columnTypes={columnTypes}
                      placeholder={tr('pivotExpressionPlaceholder')}
                    />
                    <GlassFormTextInput
                      value={metric.alias ?? ''}
                      onChange={(value) => updateMetric(index, { alias: value })}
                      placeholder={tr('pivotAliasPlaceholder')}
                      className="h-7 w-full px-2 text-[12px]"
                    />
                    <button
                      type="button"
                      onClick={() => removeMetric(index)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-error/10 hover:text-error"
                      title={tr('pivotRemoveMetric')}
                      aria-label={tr('pivotRemoveMetric')}
                    >
                      <Trash2 className="h-4 w-4" />
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

// 纯展示用，不代表存储类型：null 显示为 "null"，空字符串显示为 ""，其余按 String 显示。
function literalDisplay(value: PivotLiteral): string {
  if (value === null) return 'null';
  if (value === '') return '""';
  return String(value);
}

interface PivotAxisCardProps {
  axis: PivotAxisEntry;
  expanded: boolean;
  fieldCompletions: string[];
  columnTypes: Record<string, string>;
  disabledFields: Set<string>;
  taskId?: string;
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  tr: (key: string, params?: Record<string, unknown>) => string;
  onFieldChange: (field: string) => void;
  onValuesChange: (values: PivotLiteral[]) => void;
  onToggle: () => void;
  onRemove: () => void;
}

function PivotAxisCard({
  axis,
  expanded,
  fieldCompletions,
  columnTypes,
  disabledFields,
  taskId,
  sourceNode,
  tr,
  onFieldChange,
  onValuesChange,
  onToggle,
  onRemove,
}: PivotAxisCardProps) {
  const {
    values: distinctValues,
    loading,
    error,
    reload,
  } = useWorkflowNodeColumnValues({
    taskId,
    sourceNode,
    column: axis.field,
  });
  const totalValueCount = useMemo(
    () =>
      new Set([
        ...distinctValues.map((value) => literalDisplay(value)),
        ...axis.values.map((value) => literalDisplay(value)),
      ]).size,
    [axis.values, distinctValues]
  );

  function handleToggle() {
    if (!expanded && axis.field) reload();
    onToggle();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-muted bg-background">
      <div className="grid h-11 grid-cols-[minmax(0,1fr)_88px_32px] items-center gap-2 px-2">
        <GlassFieldSingleSelect
          value={axis.field}
          options={fieldCompletions}
          columnTypes={columnTypes}
          onChange={onFieldChange}
          disabledOptions={disabledFields}
          placeholder={tr('pivotAxisFieldPlaceholder')}
          searchPlaceholder={tr('searchField')}
          className="h-7 min-w-0"
        />
        <button
          type="button"
          disabled={!axis.field}
          onClick={handleToggle}
          className="flex h-7 items-center justify-center gap-1 rounded-md text-[12px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-35"
          aria-expanded={expanded}
        >
          {tr('pivotSelectedValues', {
            selected: axis.values.length,
            total: totalValueCount > 0 ? totalValueCount : '—',
          })}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-error/10 hover:text-error"
          title={tr('pivotRemoveAxis')}
          aria-label={tr('pivotRemoveAxis')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded && (
        <PivotValueList
          columnType={columnTypes[axis.field]}
          values={axis.values}
          distinctValues={distinctValues}
          loading={loading}
          error={error}
          reload={reload}
          tr={tr}
          onChange={onValuesChange}
        />
      )}
    </div>
  );
}

interface PivotValueListProps {
  columnType?: string;
  values: PivotLiteral[];
  distinctValues: string[];
  loading: boolean;
  error: boolean;
  reload: () => void;
  onChange: (values: PivotLiteral[]) => void;
  tr: (key: string, params?: Record<string, unknown>) => string;
}

function PivotValueList({
  columnType,
  values,
  distinctValues,
  loading,
  error,
  reload,
  onChange,
  tr,
}: PivotValueListProps) {
  const [search, setSearch] = useState('');

  const selectedDisplays = useMemo(
    () => new Set(values.map((value) => literalDisplay(value))),
    [values]
  );
  const allValues = useMemo(() => {
    const byDisplay = new Map<string, string>();
    values.forEach((value) => byDisplay.set(literalDisplay(value), String(value ?? 'null')));
    distinctValues.forEach((value) => byDisplay.set(literalDisplay(value), value));
    return [...byDisplay.entries()].map(([display, raw]) => ({ display, raw }));
  }, [distinctValues, values]);
  const visibleValues = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? allValues.filter((value) => value.display.toLowerCase().includes(query))
      : allValues;
  }, [allValues, search]);
  const allSelected =
    values.length > 0 &&
    allValues.length > 0 &&
    allValues.every((value) => selectedDisplays.has(value.display));

  function toggleValue(raw: string, display: string) {
    if (selectedDisplays.has(display)) {
      onChange(values.filter((value) => literalDisplay(value) !== display));
      return;
    }
    const next = addPivotCandidate(values, raw, columnType);
    const nextDisplays = new Set(next.map((value) => literalDisplay(value)));
    onChange(allValues.every((value) => nextDisplays.has(value.display)) ? [] : next);
  }

  function toggleAllValues() {
    if (allSelected) {
      onChange([]);
      return;
    }
    let next: PivotLiteral[] = [];
    for (const value of allValues) {
      next = addPivotCandidate(next, value.raw, columnType);
    }
    onChange(next);
  }

  return (
    <div className="border-t border-border-subtle/80">
      <div className="flex h-10 items-center gap-2 border-b border-border-subtle/70 px-3">
        <Search className="h-3.5 w-3.5 flex-none text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={tr('pivotSearchValues')}
          className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-[12px] text-text-primary outline-none placeholder:text-text-muted"
        />
        <label className="flex h-7 cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={loading || allValues.length === 0}
            onChange={toggleAllValues}
            className="h-3.5 w-3.5 accent-accent"
          />
          {tr('selectAll')}
        </label>
      </div>
      <div className="max-h-[216px] overflow-y-auto py-1">
        {loading && allValues.length === 0 ? (
          <div className="flex h-16 items-center justify-center gap-2 text-[12px] text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {tr('loadingValues')}
          </div>
        ) : error ? (
          <button
            type="button"
            onClick={reload}
            className="flex h-16 w-full items-center justify-center text-[12px] text-error hover:bg-error/5"
          >
            {tr('pivotValuesLoadFailed')}
          </button>
        ) : visibleValues.length === 0 ? (
          <div className="flex h-16 items-center justify-center text-[12px] text-text-muted">
            {tr('pivotValuesEmpty')}
          </div>
        ) : (
          visibleValues.map((value) => {
            const checked = selectedDisplays.has(value.display);
            return (
              <label
                key={value.display}
                className="flex h-9 cursor-pointer items-center gap-2.5 px-3 text-[13px] text-text-primary transition-colors hover:bg-surface-hover"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleValue(value.raw, value.display)}
                  className="h-3.5 w-3.5 flex-none accent-accent"
                />
                <span className="min-w-0 truncate">{value.display}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

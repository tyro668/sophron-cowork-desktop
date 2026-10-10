import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OperatorFormProps } from './types';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionMultiSelect } from './shared/GlassOptionMultiSelect';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList, type GlassRowListColumn } from './shared/GlassRowList';
import {
  canAppendRow,
  ensureStableRowIds,
  insertRowAfter,
  removeRowAt,
} from './shared/rowListOperations';
import { useWorkflowNodeColumnValues } from '../../hooks/useWorkflowNodeColumnValues';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import { DropdownMenuSeparator } from '../ui';
import { ChevronDown, Copy, Ellipsis, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import {
  normalizePivotAxes,
  togglePivotAxisValue,
  addCustomPivotAxisValue,
  getPivotMetricDefaultSuffix,
  getPivotAxisSelectionSummary,
  getPivotPreservedValues,
  togglePivotVisibleValues,
  removePivotCustomValue,
} from '../../../shared/operator-config';
import {
  MAX_ON_COUNT,
  MAX_PIVOT_VALUES_PER_FIELD,
  MAX_USING_COUNT,
} from '../../../shared/operator-schemas';
import type { PivotAxisEntry, PivotLiteral, PivotMetric } from '../../../shared/operator-schemas';
import { PIVOT_AGGREGATE_FUNCTIONS, createMetricId } from '../../../shared/operator-schemas';

const EMPTY_METRIC: Readonly<Omit<PivotMetric, 'id'>> = {
  function: 'count',
  expression: '',
  alias: '',
};

function createEmptyMetric(): PivotMetric {
  return { ...EMPTY_METRIC, id: createMetricId() };
}

export default function FormPivot({
  node,
  pipelineId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('pivot');
  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const axes = useMemo(() => normalizePivotAxes(node.config.on), [node.config.on]);

  const rawUsing = useMemo(() => (node.config.using as PivotMetric[]) ?? [], [node.config?.using]);
  const using = useMemo(
    () =>
      rawUsing.length > 0 ? ensureStableRowIds(rawUsing, createMetricId) : [createEmptyMetric()],
    [rawUsing]
  );
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
    updateAxis(index, { field, values: [], customValues: [] });
  }

  function addAxisAfter(index: number) {
    if (!canAppendRow(axes.length, MAX_ON_COUNT)) return;
    handleAxesChange(insertRowAfter(axes, index, { field: '', values: [], customValues: [] }));
  }

  function removeAxis(index: number) {
    if (axes.length <= 1) {
      handleAxesChange([]);
      return;
    }
    handleAxesChange(removeRowAt(axes, index));
  }

  const usedFields = useMemo(() => new Set(axes.map((axis) => axis.field)), [axes]);

  const handleGroupByChange = useCallback(
    (next: string[]) =>
      updateConfig((cfg) => ({ ...cfg, groupBy: next.length > 0 ? next : undefined })),
    [updateConfig]
  );

  const [expandedAxisIndex, setExpandedAxisIndex] = useState<number | null>(null);

  // ── 多指标管理 ──

  const handleUsingChange = useCallback(
    (items: PivotMetric[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        using: items.length > 0 ? ensureStableRowIds(items, createMetricId) : undefined,
      }));
    },
    [updateConfig]
  );

  function updateMetric(index: number, patch: Partial<PivotMetric>) {
    handleUsingChange(using.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function addMetricAfter(index: number) {
    if (!canAppendRow(using.length, MAX_USING_COUNT)) return;
    handleUsingChange(insertRowAfter(using, index, createEmptyMetric()));
  }

  function removeMetric(index: number) {
    handleUsingChange(removeRowAt(using, index));
  }

  function copyMetric(index: number) {
    if (!canAppendRow(using.length, MAX_USING_COUNT)) return;
    const source = using[index];
    handleUsingChange(insertRowAfter(using, index, { ...source, id: createMetricId(), alias: '' }));
  }

  const fnGroups = useMemo(
    () => [
      {
        key: 'fn',
        items: PIVOT_AGGREGATE_FUNCTIONS.map((f) => ({
          value: f,
          label: tr(`aggregateFns.${f}`),
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
    handleKeyboardMove: handleMetricKeyboardMove,
    isDragging: isMetricDragging,
    resetDrag: resetMetricDrag,
    dragIndexRef: metricDragIndexRef,
  } = useDragReorder(using, handleUsingChange);

  useEffect(() => {
    if (!isMetricDragging) resetMetricDrag();
  }, [using, isMetricDragging, resetMetricDrag]);

  const canAddMetric = canAppendRow(activeMetrics.length, MAX_USING_COUNT);

  const metricColumns: GlassRowListColumn<PivotMetric>[] = [
    {
      flex: 'flex-[0.8]',
      header: tr('aggregateFns.aggregateFunction'),
      render: (metric, index) => (
        <GlassOptionSingleSelect
          value={metric.function}
          groups={fnGroups}
          onChange={(value) => updateMetric(index, { function: value as PivotMetric['function'] })}
          className="h-8 w-full text-[12px] [&>span]:text-left"
        />
      ),
    },
    {
      flex: 'flex-[1.6]',
      header: tr('aggregate.aggregateExpressionColumn'),
      render: (metric, index) => (
        <GlassExpressionInput
          value={metric.expression}
          onChange={(value) => updateMetric(index, { expression: value })}
          fieldCompletions={fieldCompletions}
          columnTypes={columnTypes}
          placeholder={tr('pivotExpressionPlaceholder')}
        />
      ),
    },
    {
      flex: 'flex-[1]',
      header: tr('pivotSuffixLabel'),
      render: (metric, index) => (
        <GlassFormTextInput
          value={metric.alias ?? ''}
          onChange={(value) => updateMetric(index, { alias: value })}
          placeholder={tr('pivotDefaultSuffix', {
            suffix: getPivotMetricDefaultSuffix(metric.function),
          })}
          className="h-8 w-full px-2 text-[12px]"
        />
      ),
    },
  ];

  return (
    <div className="scrollbar-hover flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto px-3 py-2">
      <div className="flex items-start gap-2">
        <GlassFormLabel>{tr('pivotFieldsLabel')}</GlassFormLabel>
        <div className="grid min-w-0 flex-1 gap-0.5">
          {axes.map((axis, index) => (
            <PivotAxisCard
              key={`${axis.field}-${index}`}
              axis={axis}
              expanded={expandedAxisIndex === index}
              fieldCompletions={fieldCompletions}
              columnTypes={columnTypes}
              disabledFields={new Set([...usedFields].filter((field) => field !== axis.field))}
              pipelineId={pipelineId}
              sourceNode={sourceNode}
              tr={tr}
              canAdd={canAppendRow(axes.length, MAX_ON_COUNT)}
              onAddAfter={() => addAxisAfter(index)}
              onFieldChange={(field) => handleAxisFieldChange(index, field)}
              onValuesChange={(values) => updateAxis(index, { values })}
              onCustomValueAdd={(values, customValues) =>
                updateAxis(index, { values, customValues })
              }
              onCustomValueRemove={(display) => {
                const next = removePivotCustomValue(axis.values, axis.customValues, display);
                updateAxis(index, next);
              }}
              onToggle={() => setExpandedAxisIndex((current) => (current === index ? null : index))}
              onRemove={() => {
                removeAxis(index);
                setExpandedAxisIndex(null);
              }}
            />
          ))}
          <button
            type="button"
            disabled={!canAppendRow(axes.length, MAX_ON_COUNT)}
            onClick={() => addAxisAfter(axes.length - 1)}
            className="flex h-6 w-fit items-center gap-1 text-[12px] font-medium text-accent transition-colors hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            {tr('pivotAddAxis')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('pivotGroupByLabel')}</GlassFormLabel>
        <div className="min-w-0 flex-1">
          <GlassOptionMultiSelect
            options={fieldCompletions}
            selected={groupBy}
            onChange={handleGroupByChange}
            optionTypes={columnTypes}
            placeholder={tr('aggregateGroupByPlaceholder')}
            maxHeight="300px"
          />
        </div>
      </div>

      <div className="border-t border-border-subtle" />

      <div className="flex items-center justify-between">
        <span className="text-[13px] text-text-secondary">{tr('pivotMeasuresLabel')}</span>
        <button
          type="button"
          onClick={() => addMetricAfter(activeMetrics.length - 1)}
          disabled={!canAddMetric}
          className="inline-flex h-7 items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent-muted px-2.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          {tr('pivotAddMetric')}
        </button>
      </div>

      <GlassRowList
        rowPaddingClassName="px-0"
        items={activeMetrics}
        getKey={(metric, index) => metric.id ?? `metric-${index}`}
        columns={metricColumns}
        actions={[]}
        renderExtraActions={(index) => (
          <GlassDropdownMenu
            trigger={
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-surface-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-accent/30"
                title={tr('aggregate.aggregateMetricActions')}
                aria-label={tr('aggregate.aggregateMetricActions')}
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
              {tr('pivotAddMetric')}
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
              {tr('pivotRemoveMetric')}
            </GlassMenuItem>
          </GlassDropdownMenu>
        )}
        draggable
        dragHandlePosition="end"
        onDragStart={handleMetricDragStart}
        onDragOver={handleMetricDragOver}
        onDragEnd={handleMetricDragEnd}
        onKeyboardMove={handleMetricKeyboardMove}
        getRowOpacity={(index) => !!(isMetricDragging && metricDragIndexRef.current === index)}
        getDropMarker={(index) =>
          isMetricDragging && metricDragIndexRef.current === index ? 'before' : null
        }
        dragTitle={tr('rowList.dragToReorder')}
      />
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
  pipelineId?: string;
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  tr: (key: string, params?: Record<string, unknown>) => string;
  onFieldChange: (field: string) => void;
  onValuesChange: (values: PivotLiteral[]) => void;
  onCustomValueAdd: (values: PivotLiteral[], customValues: PivotLiteral[]) => void;
  onCustomValueRemove: (display: string) => void;
  canAdd: boolean;
  onAddAfter: () => void;
  onToggle: () => void;
  onRemove: () => void;
}

function PivotAxisCard({
  axis,
  expanded,
  fieldCompletions,
  columnTypes,
  disabledFields,
  pipelineId,
  sourceNode,
  tr,
  canAdd,
  onAddAfter,
  onFieldChange,
  onValuesChange,
  onCustomValueAdd,
  onCustomValueRemove,
  onToggle,
  onRemove,
}: PivotAxisCardProps) {
  const {
    values: distinctValues,
    loading,
    loaded,
    error,
    reload,
  } = useWorkflowNodeColumnValues({
    pipelineId,
    sourceNode,
    column: axis.field,
  });
  const selectionSummary = useMemo(
    () => getPivotAxisSelectionSummary(axis.values, distinctValues, loaded, axis.customValues),
    [axis.customValues, axis.values, distinctValues, loaded]
  );

  useEffect(() => {
    if (axis.field) reload();
  }, [axis.field, reload, sourceNode?.config, sourceNode?.id, sourceNode?.type, pipelineId]);

  function handleToggle() {
    if (!expanded && axis.field && !loaded && !loading) reload();
    onToggle();
  }

  return (
    <div>
      <div className="flex items-center gap-2 py-1 transition-colors">
        <GlassFieldSingleSelect
          value={axis.field}
          options={fieldCompletions}
          columnTypes={columnTypes}
          onChange={onFieldChange}
          disabledOptions={disabledFields}
          placeholder={tr('pivotAxisFieldPlaceholder')}
          searchPlaceholder={tr('fieldPicker.searchField')}
          className="h-8 min-w-0 flex-1"
        />
        <button
          type="button"
          disabled={!axis.field}
          onClick={handleToggle}
          className="flex h-8 w-[88px] shrink-0 items-center justify-between gap-1 rounded-md border border-border-muted bg-surface px-2.5 text-[12px] text-text-secondary transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-35"
          aria-expanded={expanded}
        >
          <span className="truncate">
            {axis.values.length === 0 && loaded
              ? tr('pivotAllValuesShort')
              : tr('pivotSelectedValues', {
                  selected: selectionSummary.selected ?? '—',
                  total: selectionSummary.total ?? '—',
                })}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        <div className="flex w-8 flex-shrink-0 justify-center">
          <GlassDropdownMenu
            trigger={
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted outline-none transition-colors hover:bg-surface-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-accent/30"
                title={tr('aggregate.aggregateMetricActions')}
                aria-label={tr('aggregate.aggregateMetricActions')}
              >
                <Ellipsis className="h-4 w-4" />
              </button>
            }
            align="end"
            side="bottom"
          >
            <GlassMenuItem
              icon={<Plus className="h-3.5 w-3.5" />}
              disabled={!canAdd}
              onSelect={onAddAfter}
            >
              {tr('pivotAddAxis')}
            </GlassMenuItem>
            <DropdownMenuSeparator />
            <GlassMenuItem icon={<Trash2 className="h-3.5 w-3.5" />} danger onSelect={onRemove}>
              {tr('pivotRemoveAxis')}
            </GlassMenuItem>
          </GlassDropdownMenu>
        </div>
      </div>
      {expanded && (
        <PivotValueList
          columnType={columnTypes[axis.field]}
          values={axis.values}
          customValues={axis.customValues}
          distinctValues={distinctValues}
          loading={loading}
          loaded={loaded}
          error={error}
          reload={reload}
          tr={tr}
          onChange={onValuesChange}
          onCustomValueAdd={onCustomValueAdd}
          onCustomValueRemove={onCustomValueRemove}
        />
      )}
    </div>
  );
}

interface PivotValueListProps {
  columnType?: string;
  values: PivotLiteral[];
  customValues: PivotLiteral[];
  distinctValues: string[];
  loading: boolean;
  loaded: boolean;
  error: boolean;
  reload: () => void;
  onChange: (values: PivotLiteral[]) => void;
  onCustomValueAdd: (values: PivotLiteral[], customValues: PivotLiteral[]) => void;
  onCustomValueRemove: (display: string) => void;
  tr: (key: string, params?: Record<string, unknown>) => string;
}

function PivotValueList({
  columnType,
  values,
  customValues,
  distinctValues,
  loading,
  loaded,
  error,
  reload,
  onChange,
  onCustomValueAdd,
  onCustomValueRemove,
  tr,
}: PivotValueListProps) {
  const [search, setSearch] = useState('');
  const [addingCustomValue, setAddingCustomValue] = useState(false);
  const [customValue, setCustomValue] = useState('');

  const selectedDisplays = useMemo(
    () => new Set(values.map((value) => literalDisplay(value))),
    [values]
  );
  const preservedValues = useMemo(
    () => getPivotPreservedValues(values, customValues, distinctValues, loaded),
    [customValues, distinctValues, loaded, values]
  );
  const removableCustomDisplays = useMemo(
    () => new Set((loaded ? preservedValues : customValues).map(literalDisplay)),
    [customValues, loaded, preservedValues]
  );
  const allValues = useMemo(() => {
    const byDisplay = new Map<string, string>();
    distinctValues.forEach((value) => byDisplay.set(literalDisplay(value), value));
    preservedValues.forEach((value) =>
      byDisplay.set(literalDisplay(value), String(value ?? 'null'))
    );
    values.forEach((value) => byDisplay.set(literalDisplay(value), String(value ?? 'null')));
    return [...byDisplay.entries()].map(([display, raw]) => ({ display, raw }));
  }, [distinctValues, preservedValues, values]);
  const visibleValues = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? allValues.filter((value) => value.display.toLowerCase().includes(query))
      : allValues;
  }, [allValues, search]);
  const isValueSelected = (display: string) => selectedDisplays.has(display);
  const visibleDisplays = useMemo(
    () => new Set(visibleValues.map((value) => value.display)),
    [visibleValues]
  );
  const allSelected =
    visibleValues.length > 0 && visibleValues.every((value) => isValueSelected(value.display));
  const selectAllIndeterminate =
    visibleValues.length > 0 &&
    visibleValues.some((value) => isValueSelected(value.display)) &&
    !allSelected;

  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectAllIndeterminate;
    }
  }, [selectAllIndeterminate]);

  function toggleValue(raw: string, display: string) {
    onChange(togglePivotAxisValue(values, display, raw, columnType));
  }

  function toggleAllValues() {
    onChange(togglePivotVisibleValues(values, allValues, visibleDisplays, columnType));
  }

  const configuredValueCount =
    values.length === 0
      ? allValues.length
      : new Set([...values, ...preservedValues].map(literalDisplay)).size;
  const canAddCustomValue =
    loaded &&
    !loading &&
    !error &&
    columnType !== 'boolean' &&
    configuredValueCount < MAX_PIVOT_VALUES_PER_FIELD;

  function closeCustomValueInput() {
    setAddingCustomValue(false);
    setCustomValue('');
  }

  function submitCustomValue() {
    if (!canAddCustomValue || !customValue.trim()) return;
    const next = addCustomPivotAxisValue(
      values,
      preservedValues,
      customValue,
      distinctValues.map((raw) => ({ raw })),
      columnType
    );
    if (next.values.length > MAX_PIVOT_VALUES_PER_FIELD) return;
    onCustomValueAdd(next.values, next.customValues);
    closeCustomValueInput();
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
          className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-[12px] text-text-primary outline-none placeholder:text-text-muted"
        />
        <button
          type="button"
          disabled={!canAddCustomValue}
          onClick={() => setAddingCustomValue((current) => !current)}
          className="flex h-8 flex-none items-center gap-1 rounded-md px-1.5 text-[12px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-35"
          aria-expanded={addingCustomValue}
          title={
            configuredValueCount >= MAX_PIVOT_VALUES_PER_FIELD
              ? tr('pivotCustomValueLimit', { max: MAX_PIVOT_VALUES_PER_FIELD })
              : !loaded || loading || error
                ? tr('pivotAddValueAfterLoading')
                : tr('pivotAddCustomValue')
          }
        >
          <Plus className="h-3.5 w-3.5" />
          {tr('pivotAddValue')}
        </button>
        <label
          className="flex h-8 cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary"
          title={search.trim() ? tr('pivotToggleSearchResults') : tr('pivotAllValues')}
        >
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            disabled={loading || visibleValues.length === 0}
            onChange={toggleAllValues}
            className="h-3.5 w-3.5 accent-accent"
          />
          {tr('fieldPicker.selectAll')}
        </label>
      </div>
      {addingCustomValue && (
        <div className="flex h-10 items-center gap-2 border-b border-border-subtle/70 px-3">
          <input
            autoFocus
            type="text"
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitCustomValue();
              if (event.key === 'Escape') closeCustomValueInput();
            }}
            placeholder={tr('pivotCustomValuePlaceholder')}
            className="h-8 min-w-0 flex-1 rounded-md border border-border-muted bg-background px-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
          />
          <button
            type="button"
            disabled={!customValue.trim()}
            onClick={submitCustomValue}
            className="h-8 flex-none rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {tr('confirm')}
          </button>
          <button
            type="button"
            onClick={closeCustomValueInput}
            className="h-8 flex-none rounded-md px-2 text-[12px] text-text-secondary hover:bg-surface-hover"
          >
            {tr('cancel')}
          </button>
        </div>
      )}
      <div className="scrollbar-hover max-h-[216px] overflow-y-auto py-1">
        {loading && allValues.length === 0 ? (
          <div className="flex h-16 items-center justify-center gap-2 text-[12px] text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {tr('valueInput.loadingValues')}
          </div>
        ) : error ? (
          <button
            type="button"
            onClick={reload}
            className="flex h-16 w-full items-center justify-center text-[12px] text-error hover:bg-error/5"
          >
            {tr('pivotValuesLoadFailed')}
          </button>
        ) : (
          <>
            <div className="flex h-8 items-center gap-2 border-b border-border-subtle/70 px-3 text-[13px] text-text-primary transition-colors hover:bg-surface-hover">
              <label
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5"
                title={tr('pivotAllValues')}
              >
                <input
                  type="checkbox"
                  checked={values.length === 0}
                  onChange={() => onChange([])}
                  className="h-3.5 w-3.5 flex-none accent-accent"
                />
                <span className="min-w-0 truncate">{tr('pivotAllValuesOption')}</span>
              </label>
            </div>
            {visibleValues.length === 0 ? (
              <div className="flex h-16 items-center justify-center text-[12px] text-text-muted">
                {tr('pivotValuesEmpty')}
              </div>
            ) : (
              visibleValues.map((value) => {
                return (
                  <div
                    key={value.display}
                    className="flex h-8 items-center gap-2 px-3 text-[13px] text-text-primary transition-colors hover:bg-surface-hover"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={isValueSelected(value.display)}
                        onChange={() => toggleValue(value.raw, value.display)}
                        className="h-3.5 w-3.5 flex-none accent-accent"
                      />
                      <span className="min-w-0 truncate">{value.display}</span>
                    </label>
                    {removableCustomDisplays.has(value.display) && (
                      <button
                        type="button"
                        onClick={() => onCustomValueRemove(value.display)}
                        className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-text-muted transition-colors hover:bg-error/10 hover:text-error"
                        title={tr('pivotRemoveCustomValue')}
                        aria-label={tr('pivotRemoveCustomValue')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}

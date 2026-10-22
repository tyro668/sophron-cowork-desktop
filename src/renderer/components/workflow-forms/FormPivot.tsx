import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OperatorFormProps } from './types';
import { MetricExpressionCell } from './shared/MetricExpressionCell';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionMultiSelect } from './shared/GlassOptionMultiSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import {
  AddRow,
  Cell,
  ErrorRow,
  FormGrid,
  FormScroll,
  GlassCommitTextInput,
  GridRow,
  HintRow,
  LabelCell,
  RowActionsCell,
  type RowActionLabels,
} from './shared/FormGrid';
import { useGridRowDrag } from './shared/useGridRowDrag';
import { validateAggregateMetrics } from './shared/metricValidation';
import { PIVOT_GRID_COLUMNS } from './shared/gridColumns';
import {
  canAppendRow,
  ensureStableRowIds,
  insertRowAfter,
  removeRowAt,
  patchRowAt,
} from './shared/rowListOperations';
import { useWorkflowNodeColumnValues } from '../../hooks/useWorkflowNodeColumnValues';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { ChevronDown, Info, Loader2, Plus, Search, X } from 'lucide-react';
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
    updateConfig((cfg) => {
      const next = patchRowAt((cfg.using as PivotMetric[] | undefined) ?? [], using, index, patch);
      return { ...cfg, using: ensureStableRowIds(next, createMetricId) };
    });
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
    handleUsingChange(
      insertRowAfter(using, index, {
        ...source,
        id: createMetricId(),
        alias: source.alias ? tr('copyNameSuffix', { name: source.alias }) : '',
      })
    );
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
    rowProps: metricRowProps,
    dragHandle: metricDragHandle,
  } = useGridRowDrag(using, handleUsingChange);
  const { rowProps: axisRowProps, dragHandle: axisDragHandle } = useGridRowDrag(
    axes,
    handleAxesChange
  );
  const [firstAxisValues, setFirstAxisValues] = useState<string[]>([]);

  const canAddMetric = canAppendRow(activeMetrics.length, MAX_USING_COUNT);

  const issues = useMemo(
    () => validateAggregateMetrics(activeMetrics, [], { checkGroupConflict: false }),
    [activeMetrics]
  );
  const errorCount = issues.reduce((n, item) => n + item.messages.length, 0);
  const rowLabels = {
    add: tr('rowAdd'),
    copy: tr('rowCopy'),
    remove: tr('rowRemove'),
    drag: tr('rowDrag'),
  };
  const axisRowCount =
    1 + Math.max(axes.length, 1) + (expandedAxisIndex !== null && axes[expandedAxisIndex] ? 1 : 0);
  const previewColumns = useMemo(() => {
    const first = axes[0];
    if (!first?.field) return [];
    const values = (first.values.length > 0 ? first.values.map(literalDisplay) : firstAxisValues)
      .filter((value) => value !== '')
      .slice(0, 2);
    const suffixes = activeMetrics.map(
      (metric) => metric.alias?.trim() || getPivotMetricDefaultSuffix(metric.function)
    );
    const out: string[] = [];
    for (const value of values) for (const suffix of suffixes) out.push(`${value}_${suffix}`);
    return out.slice(0, 3);
  }, [activeMetrics, axes, firstAxisValues]);

  return (
    <FormScroll>
      <FormGrid columns={PIVOT_GRID_COLUMNS} testId="pivot-form-grid">
        <LabelCell rowSpan={axisRowCount}>{tr('pivotFieldsLabel')}</LabelCell>
        <Cell span={2} v={['th']}>
          {tr('pivotFieldsLabel')}
        </Cell>
        <Cell v={['th']}>{tr('pivotValuesHeader')}</Cell>
        <Cell v={['th']} />
        {axes.length === 0 ? (
          <AddRow span={4} label={tr('pivotAddAxis')} onClick={() => addAxisAfter(-1)} />
        ) : null}
        {axes.map((axis, index) => (
          <PivotAxisRow
            key={`${axis.field}-${index}`}
            index={index}
            axis={axis}
            expanded={expandedAxisIndex === index}
            fieldCompletions={fieldCompletions}
            columnTypes={columnTypes}
            disabledFields={new Set([...usedFields].filter((field) => field !== axis.field))}
            pipelineId={pipelineId}
            sourceNode={sourceNode}
            tr={tr}
            rowLabels={rowLabels}
            rowProps={axisRowProps(index)}
            dragHandle={axisDragHandle(index)}
            canAdd={canAppendRow(axes.length, MAX_ON_COUNT)}
            onAddAfter={() => addAxisAfter(index)}
            onFieldChange={(field) => handleAxisFieldChange(index, field)}
            onValuesChange={(values) => updateAxis(index, { values })}
            onCustomValueAdd={(values, customValues) => updateAxis(index, { values, customValues })}
            onCustomValueRemove={(display) => {
              const next = removePivotCustomValue(axis.values, axis.customValues, display);
              updateAxis(index, next);
            }}
            onDistinctValues={index === 0 ? setFirstAxisValues : undefined}
            onToggle={() => setExpandedAxisIndex((current) => (current === index ? null : index))}
            onRemove={() => {
              removeAxis(index);
              setExpandedAxisIndex(null);
            }}
          />
        ))}

        <LabelCell>{tr('pivotGroupByLabel')}</LabelCell>
        <Cell span={4} v={['ctl', 'chips']}>
          <GlassOptionMultiSelect
            options={fieldCompletions}
            selected={groupBy}
            onChange={handleGroupByChange}
            optionTypes={columnTypes}
            placeholder={tr('aggregateGroupByPlaceholder')}
            maxHeight="300px"
          />
        </Cell>

        <LabelCell rowSpan={1 + activeMetrics.length + errorCount + 1}>
          {tr('pivotMeasuresLabel')}
        </LabelCell>
        <Cell v={['th']}>{tr('aggregateFns.aggregateFunction')}</Cell>
        <Cell v={['th']}>{tr('aggregate.aggregateExpressionColumn')}</Cell>
        <Cell v={['th']}>{tr('pivotSuffixLabel')}</Cell>
        <Cell v={['th']} />
        {activeMetrics.map((metric, index) => {
          const issue = issues[index];
          return (
            <Fragment key={metric.id ?? `metric-${index}`}>
              <GridRow {...metricRowProps(index)} testId={`pivot-metric-row-${index}`}>
                <Cell v={['ctl']}>
                  <GlassOptionSingleSelect
                    value={metric.function}
                    groups={fnGroups}
                    onChange={(value) =>
                      updateMetric(index, { function: value as PivotMetric['function'] })
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
                    placeholder={tr('pivotExpressionPlaceholder')}
                  />
                </Cell>
                <Cell v={['ctl', issue.aliasError && 'err']}>
                  <GlassCommitTextInput
                    value={metric.alias ?? ''}
                    onCommit={(value) => updateMetric(index, { alias: value.trim() })}
                    placeholder={tr('pivotDefaultSuffix', {
                      suffix: getPivotMetricDefaultSuffix(metric.function),
                    })}
                    ariaLabel={tr('pivotSuffixLabel')}
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
                  dragHandle={metricDragHandle(index)}
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
          label={tr('pivotAddMetric')}
          onClick={() => addMetricAfter(activeMetrics.length - 1)}
          disabled={!canAddMetric}
        />
        {previewColumns.length > 0 ? (
          <HintRow span={5}>
            <Info className="opg-ic h-3.5 w-3.5" />
            <span className="min-w-0 truncate">
              {tr('pivotPreviewPrefix')}
              <span className="font-mono text-text-secondary">{previewColumns.join(' · ')} …</span>
              {tr('pivotPreviewSuffix')}
            </span>
          </HintRow>
        ) : null}
      </FormGrid>
    </FormScroll>
  );
}

// 纯展示用，不代表存储类型：null 显示为 "null"，空字符串显示为 ""，其余按 String 显示。
function literalDisplay(value: PivotLiteral): string {
  if (value === null) return 'null';
  if (value === '') return '""';
  return String(value);
}

interface PivotAxisRowProps {
  index: number;
  rowLabels: RowActionLabels;
  rowProps: { onDragOver: (event: React.DragEvent) => void; dragging: boolean };
  dragHandle?: {
    onDragStart: (event: React.DragEvent) => void;
    onDragEnd: () => void;
    onKeyDown?: (event: React.KeyboardEvent) => void;
  };
  onDistinctValues?: (values: string[]) => void;
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

function PivotAxisRow({
  index,
  rowLabels,
  rowProps,
  dragHandle,
  onDistinctValues,
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
}: PivotAxisRowProps) {
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

  useEffect(() => {
    if (onDistinctValues && loaded) onDistinctValues(distinctValues);
  }, [distinctValues, loaded, onDistinctValues]);

  const valuesLabel =
    axis.values.length === 0
      ? tr('pivotAllValuesAuto')
      : tr('pivotSelectedValues', {
          selected: selectionSummary.selected ?? '—',
          total: selectionSummary.total ?? '—',
        });

  return (
    <>
      <GridRow {...rowProps} testId={`pivot-axis-row-${index}`}>
        <Cell span={2} v={['ctl']}>
          <GlassFieldSingleSelect
            value={axis.field}
            options={fieldCompletions}
            columnTypes={columnTypes}
            onChange={onFieldChange}
            disabledOptions={disabledFields}
            placeholder={tr('pivotAxisFieldPlaceholder')}
            searchPlaceholder={tr('fieldPicker.searchField')}
            className="w-full"
          />
        </Cell>
        <Cell v={['ctl']}>
          <button
            type="button"
            disabled={!axis.field}
            onClick={handleToggle}
            className="flex items-center justify-between gap-1 text-left text-[12.5px] text-text-primary disabled:cursor-not-allowed disabled:opacity-35"
            aria-expanded={expanded}
            aria-label={tr('pivotValuesAria', { field: axis.field || '—', values: valuesLabel })}
            title={axis.values.length === 0 ? tr('pivotAllValues') : undefined}
          >
            <span className="truncate pl-2">{valuesLabel}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        </Cell>
        <RowActionsCell
          labels={{ ...rowLabels, add: tr('pivotAddAxis'), remove: tr('pivotRemoveAxis') }}
          onAdd={onAddAfter}
          onRemove={onRemove}
          canAdd={canAdd}
          dragHandle={dragHandle}
        />
      </GridRow>
      {expanded && (
        <Cell span={4} v={['pane']}>
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
        </Cell>
      )}
    </>
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

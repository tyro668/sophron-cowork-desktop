import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OperatorFormProps } from './index';
import { GlassTagBar } from './shared/GlassTagBar';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList, type RowAction } from './shared/GlassRowList';
import { useWorkflowNodeColumnValues } from '../../hooks/useWorkflowNodeColumnValues';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useClickOutside } from '../../hooks/useClickOutside';
import { ChevronDown, Loader2, Trash2, X } from 'lucide-react';
import {
  addPivotCandidate,
  addPivotValue,
  normalizePivotAxes,
} from '../../../shared/operator-config';
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

  const {
    activeItems: activeAxes,
    handleDragStart: handleAxisDragStart,
    handleDragOver: handleAxisDragOver,
    handleDragEnd: handleAxisDragEnd,
    isDragging: isAxesDragging,
    resetDrag: resetAxesDrag,
    dragIndexRef: axesDragIndexRef,
  } = useDragReorder(axes, handleAxesChange);

  useEffect(() => {
    if (!isAxesDragging) resetAxesDrag();
  }, [axes, isAxesDragging, resetAxesDrag]);

  const handleGroupByChange = useCallback(
    (next: string[]) =>
      updateConfig((cfg) => ({ ...cfg, groupBy: next.length > 0 ? next : undefined })),
    [updateConfig]
  );

  const removeGroupBy = useCallback(
    (col: string) => handleGroupByChange(groupBy.filter((c) => c !== col)),
    [handleGroupByChange, groupBy]
  );

  const clearGroupBy = useCallback(() => handleGroupByChange([]), [handleGroupByChange]);

  const [groupByOpen, setGroupByOpen] = useState(false);

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

  return (
    <div className="flex flex-col gap-3">
      {/* ═══ 上块: 列与分组 ═══ */}
      <section className="operator-section w-full content-start">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            1
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">{tr('pivotAxes')}</span>
            <span className="text-[10px] text-text-muted">{tr('pivotSourcesHint')}</span>
          </div>
        </div>
        <div className="px-3 pb-3 grid gap-3 content-start">
          <div className="grid gap-1.5 content-start">
            <GlassRowList
              headerClassName=""
              hideHeader
              items={activeAxes}
              columns={[
                {
                  flex: 'flex-[1.5]',
                  header: '',
                  render: (axis: PivotAxisEntry, i: number) => (
                    <GlassFieldSingleSelect
                      value={axis.field}
                      options={fieldCompletions}
                      columnTypes={columnTypes}
                      onChange={(field) => handleAxisFieldChange(i, field)}
                      disabledOptions={new Set([...usedFields].filter((f) => f !== axis.field))}
                      placeholder={tr('pivotAxisFieldPlaceholder')}
                      searchPlaceholder={tr('searchField')}
                      className="h-7 flex-1 min-w-0"
                    />
                  ),
                },
                {
                  flex: 'flex-[10]',
                  header: '',
                  render: (axis: PivotAxisEntry, i: number) => (
                    <AxisValueCell
                      field={axis.field}
                      columnType={columnTypes[axis.field]}
                      values={axis.values}
                      taskId={taskId}
                      sourceNode={sourceNode}
                      tr={tr}
                      onChange={(values) => updateAxis(i, { values })}
                    />
                  ),
                },
              ]}
              onAdd={(i) => addAxisAfter(i)}
              onRemove={(i) => removeAxis(i)}
              addTitle={tr('pivotAddAxis')}
              removeTitle={tr('pivotRemoveAxis')}
              canAct={(action: RowAction) =>
                action === 'add' ? !axes.some((a) => !a.field) : true
              }
              draggable
              onDragStart={handleAxisDragStart}
              onDragOver={handleAxisDragOver}
              onDragEnd={handleAxisDragEnd}
              getRowOpacity={(i) => !!(isAxesDragging && axesDragIndexRef.current === i)}
              dragTitle={tr('dragToReorder')}
            />
          </div>
          <div className="grid gap-1.5 content-start">
            <span className="mb-1 block text-[12px] font-medium text-text-secondary">
              {tr('pivotGroupByLabel')}
              <span className="text-[10px] text-text-muted ml-1">({tr('optional')})</span>
            </span>
            <GlassTagBar
              items={groupBy}
              onRemove={removeGroupBy}
              onClear={clearGroupBy}
              open={groupByOpen}
              onToggle={() => setGroupByOpen((v) => !v)}
              toggleStyle="chevron"
              density="default"
              className="min-h-7"
              placeholder={tr('noFieldsSelected')}
            />
            {groupByOpen && (
              <GlassFieldMultiSelect
                columns={fieldCompletions}
                selected={groupBy}
                onChange={handleGroupByChange}
                columnTypes={columnTypes}
                maxHeight="180px"
              />
            )}
          </div>
        </div>
      </section>

      {/* ═══ 下块: 聚合指标 ═══ */}
      <section className="operator-section w-full content-start border-t border-border-subtle/70">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            2
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">{tr('pivotUsing')}</span>
            <span className="text-[10px] text-text-muted">{tr('pivotAggHint')}</span>
          </div>
        </div>
        <div className="px-3 pb-3 grid gap-3 content-start">
          <GlassRowList
            headerClassName=""
            items={using}
            columns={[
              {
                flex: 'flex-[1.5]',
                header: tr('aggregateFunction'),
                render: (metric: PivotMetric, i: number) => (
                  <GlassOptionSingleSelect
                    value={metric.function}
                    groups={fnGroups}
                    onChange={(v) => updateMetric(i, { function: v as AggregateFunction })}
                    className="h-7 text-[12px] [&>span]:text-left w-full"
                  />
                ),
              },
              {
                flex: 'flex-[2]',
                header: tr('expressionLabel'),
                render: (metric: PivotMetric, i: number) => (
                  <GlassExpressionInput
                    value={metric.expression}
                    onChange={(v) => updateMetric(i, { expression: v })}
                    fieldCompletions={fieldCompletions}
                    columnTypes={columnTypes}
                    placeholder={tr('pivotExpressionPlaceholder')}
                  />
                ),
              },
              {
                flex: 'flex-[1.5]',
                header: tr('aggregateAlias'),
                render: (metric: PivotMetric, i: number) => (
                  <GlassFormTextInput
                    value={metric.alias ?? ''}
                    onChange={(v) => updateMetric(i, { alias: v })}
                    placeholder={tr('pivotAliasPlaceholder')}
                    className="h-7 px-1.5 text-[12px] w-full"
                  />
                ),
              },
            ]}
            onAdd={(i) => addMetricAfter(i)}
            onRemove={(i) => removeMetric(i)}
            addTitle={tr('pivotAddMetric')}
            removeTitle={tr('pivotRemoveMetric')}
            canAct={(action: RowAction) =>
              action === 'add' ? !using.some((m) => !m.expression) : true
            }
          />
        </div>
      </section>
    </div>
  );
}

interface AxisValueCellProps {
  field: string;
  columnType?: string;
  values: PivotLiteral[];
  taskId?: string;
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  onChange: (values: PivotLiteral[]) => void;
  tr: (key: string, params?: Record<string, unknown>) => string;
}

// 纯展示用，不代表存储类型：null 显示为 "null"，空字符串显示为 ""，其余按 String 显示。
function literalDisplay(value: PivotLiteral): string {
  if (value === null) return 'null';
  if (value === '') return '""';
  return String(value);
}

interface TypedValueMultiInputProps {
  values: PivotLiteral[];
  columnType?: string;
  suggestions: string[];
  isLoading?: boolean;
  disabled?: boolean;
  onChange: (values: PivotLiteral[]) => void;
  onOpen?: () => void;
  placeholder?: string;
  addLabel?: string;
  noSuggestionsLabel?: string;
  clearLabel?: string;
}

function TypedValueMultiInput({
  values,
  columnType,
  suggestions,
  isLoading,
  disabled,
  onChange,
  onOpen,
  placeholder,
  addLabel,
  noSuggestionsLabel,
  clearLabel,
}: TypedValueMultiInputProps) {
  const tr = useFormTranslation();
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useClickOutside(ref, () => setOpen(false));

  const openDropdown = () => {
    setOpen((prev) => {
      if (!prev) onOpen?.();
      return !prev;
    });
  };

  const addTag = useCallback(() => {
    const next = addPivotValue(values, inputText, columnType);
    if (next !== values) {
      onChange(next);
      setInputText('');
    }
  }, [values, inputText, columnType, onChange]);

  const removeTag = useCallback(
    (idx: number) => onChange(values.filter((_, valueIndex) => valueIndex !== idx)),
    [values, onChange]
  );

  const tags = useMemo(() => values.map(literalDisplay), [values]);

  const filtered = useMemo(() => {
    const available = suggestions.filter((s) => !tags.includes(literalDisplay(s)));
    if (!inputText) return available.slice(0, 20);
    const lower = inputText.toLowerCase();
    return available.filter((s) => s.toLowerCase().includes(lower)).slice(0, 20);
  }, [inputText, suggestions, tags]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !inputText && values.length > 0) {
      removeTag(values.length - 1);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className="relative" style={{ width: 280, flexShrink: 0 }}>
      <div
        className={`flex h-8 w-full items-center gap-1 rounded-md border bg-background/42 transition-colors pl-1.5 pr-1 py-0.5 ${
          open ? 'border-accent' : 'border-border-muted'
        } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
      >
        {values.length > 0 && (
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange([]);
              setInputText('');
              inputRef.current?.focus();
            }}
            className="inline-flex flex-shrink-0 items-center justify-center rounded px-0.5 text-text-muted hover:text-error hover:bg-error/10 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            title={clearLabel ?? tr('filterClearValues')}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}

        <div className="flex flex-1 min-w-0 items-center gap-1 overflow-x-auto">
          {tags.map((v, i) => (
            <span
              key={i}
              className="inline-flex flex-shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[12px] font-medium text-accent"
            >
              {v}
              <button
                type="button"
                disabled={disabled}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeTag(i);
                }}
                className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            disabled={disabled}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => openDropdown()}
            placeholder={values.length === 0 ? placeholder : ''}
            className="bg-transparent h-6 min-w-[60px] flex-1 pl-0.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
          />
        </div>

        {isLoading && (
          <Loader2 className="my-auto h-3.5 w-3.5 flex-shrink-0 animate-spin text-text-muted" />
        )}
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openDropdown();
          }}
          className="flex h-6 w-5 flex-shrink-0 items-center justify-center text-text-muted hover:text-text-secondary transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-border-muted bg-[var(--glass-card-strong)] py-1 shadow-elevated backdrop-blur-xl">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className="w-full px-2.5 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-surface-hover"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const next = addPivotCandidate(values, s, columnType);
                if (next !== values) {
                  onChange(next);
                  setInputText('');
                }
              }}
            >
              {s === '' ? '""' : s}
            </button>
          ))}
          {inputText && !filtered.includes(inputText) && (
            <button
              type="button"
              className="w-full px-2.5 py-1.5 text-left text-[12px] text-accent transition-colors hover:bg-surface-hover"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                addTag();
              }}
            >
              {addLabel} "{inputText}"
            </button>
          )}
          {filtered.length === 0 && !inputText && (
            <div className="px-2.5 py-4 text-center text-[12px] text-text-muted">
              {noSuggestionsLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AxisValueCell({
  field,
  columnType,
  values,
  taskId,
  sourceNode,
  onChange,
  tr,
}: AxisValueCellProps) {
  // 懒加载：每次展开下拉才发起查询，避免切 tab 重挂载自动查库，且每次展开都反映上游当前内容。
  const {
    values: distinctValues,
    loading,
    error,
    reload,
  } = useWorkflowNodeColumnValues({
    taskId,
    sourceNode,
    column: field,
  });

  const handleOpen = () => {
    if (field) reload();
  };

  return (
    <div className="flex items-center gap-1.5">
      <TypedValueMultiInput
        values={values}
        columnType={columnType}
        suggestions={error ? [] : distinctValues}
        isLoading={loading}
        onChange={onChange}
        onOpen={handleOpen}
        disabled={!field}
        placeholder={tr('pivotAllValues')}
        addLabel={tr('pivotAddValue')}
        noSuggestionsLabel={tr('pivotValuesEmpty')}
        clearLabel={tr('filterClearValues')}
      />
      {error && (
        <span className="text-[11px] text-error" title={tr('pivotValuesLoadFailed')}>
          {tr('pivotValuesLoadFailed')}
        </span>
      )}
    </div>
  );
}

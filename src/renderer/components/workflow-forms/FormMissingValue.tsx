import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassTagBar } from './shared/GlassTagBar';
import { GlassFieldCombo } from './shared/GlassFieldCombo';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import type { OperatorFormProps } from './index';
import { GlassFieldSelector } from './shared/GlassFieldSelector';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import {
  isNumericDataFieldType,
  isTemporalDataFieldType,
  normalizeDataFieldType,
} from '../../../shared/data-field-types';

const BASE_METHODS = [
  { value: 'skip', labelKey: 'ruleMethods.skip', label: '不处理' },
  { value: 'nullify_values', labelKey: 'ruleMethods.nullify_values', label: '特殊值转空' },
  { value: 'literal_fill', labelKey: 'ruleMethods.literal_fill', label: '固定值填充' },
  { value: 'drop', labelKey: 'ruleMethods.drop', label: '删除含缺失的行' },
];

const STATISTICAL_METHODS = [
  { value: 'mean_fill', labelKey: 'ruleMethods.mean_fill', label: '均值填充' },
  { value: 'median_fill', labelKey: 'ruleMethods.median_fill', label: '中位数填充' },
  { value: 'mode_fill', labelKey: 'ruleMethods.mode_fill', label: '众数填充' },
];

const ORDERED_METHODS = [
  { value: 'forward_fill', labelKey: 'ruleMethods.forward_fill', label: '前向填充' },
  { value: 'backward_fill', labelKey: 'ruleMethods.backward_fill', label: '后向填充' },
];

function methodsForType(colType: string | undefined) {
  if (!colType) return BASE_METHODS;
  const type = normalizeDataFieldType(colType);
  if (isNumericDataFieldType(type))
    return [...BASE_METHODS, ...ORDERED_METHODS, ...STATISTICAL_METHODS];
  if (isTemporalDataFieldType(type)) return [...BASE_METHODS, ...ORDERED_METHODS];
  return BASE_METHODS;
}

interface MissingRule {
  id?: string;
  column: string;
  method: string;
  values?: string[];
  value?: unknown;
}

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function createDefault(overrides: Partial<MissingRule> = {}): MissingRule {
  return { id: generateId(), column: '', method: 'literal_fill', value: '', ...overrides };
}

type TabMode = 'row' | 'column';

export default function FormMissingValue({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const updateConfig = useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => ({
        ...current,
        config: updater(current.config),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );

  const strategy = (node.config.strategy as string) ?? 'by_column';
  const rules = useMemo<MissingRule[]>(
    () => (node.config.rules as MissingRule[]) ?? [],
    [node.config.rules]
  );
  const rowColumns = useMemo<string[]>(
    () => (node.config.columns as string[]) ?? [],
    [node.config.columns]
  );

  const tabMode: TabMode =
    strategy === 'drop_empty_rows' || strategy === 'drop_rows_by_nulls' ? 'row' : 'column';
  const rowCondition: string =
    strategy === 'drop_empty_rows' ? 'all_null' : ((node.config.condition as string) ?? 'any_null');

  const [showFieldPicker, setShowFieldPicker] = useState(true);
  const removingRef = useRef(false);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!taskId || !sourceNode?.id) return;
    const api = window.electronAPI?.data;
    if (!api?.getWorkflowNodeColumnTypes) return;
    api
      .getWorkflowNodeColumnTypes({
        taskId,
        nodeId: sourceNode.id,
        nodeType: sourceNode.type as never,
        nodeConfig: (sourceNode.config ?? {}) as Record<string, unknown>,
      })
      .then((types) => {
        const map: Record<string, string> = {};
        for (const t of types) map[t.name] = t.type;
        setColumnTypes(map);
      })
      .catch(() => setColumnTypes({}));
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config]);

  function setRowMode(condition: 'all_null' | 'any_null') {
    updateConfig((cfg) => {
      const columns = cfg.columns as string[] | undefined;
      if (condition === 'all_null' && (!columns || columns.length === 0)) {
        return { ...cfg, strategy: 'drop_empty_rows', condition: 'all_null' };
      }
      return { ...cfg, strategy: 'drop_rows_by_nulls', condition };
    });
  }

  function setColumnMode() {
    updateConfig((cfg) => ({
      ...cfg,
      strategy: 'by_column',
      condition: undefined,
      columns: undefined,
    }));
  }

  function handleRulesChange(items: MissingRule[]) {
    const itemsWithId = items.map((item) => (item.id ? item : { ...item, id: generateId() }));
    updateConfig((cfg) => ({ ...cfg, rules: itemsWithId.length > 0 ? itemsWithId : undefined }));
  }

  const handleRowsColumnsChange = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => {
        const condition = cfg.condition as string | undefined;
        const isAllNull = !condition || condition === 'all_null';
        const hasColumns = next.length > 0;
        if (isAllNull && !hasColumns) {
          return { ...cfg, strategy: 'drop_empty_rows', columns: undefined };
        }
        return { ...cfg, strategy: 'drop_rows_by_nulls', columns: hasColumns ? next : undefined };
      });
    },
    [updateConfig]
  );

  const removeRowColumn = useCallback(
    (col: string) => {
      if (removingRef.current) return;
      removingRef.current = true;
      updateConfig((cfg) => {
        const next = ((cfg.columns as string[]) ?? []).filter((c) => c !== col);
        const isAllNull = (cfg.condition as string | undefined) === 'all_null';
        if (isAllNull && next.length === 0) {
          return { ...cfg, strategy: 'drop_empty_rows', columns: undefined };
        }
        return {
          ...cfg,
          strategy: 'drop_rows_by_nulls',
          columns: next.length > 0 ? next : undefined,
        };
      });
      requestAnimationFrame(() => {
        removingRef.current = false;
      });
    },
    [updateConfig]
  );

  function updateRule(index: number, item: MissingRule) {
    handleRulesChange(rules.map((existing, i) => (i === index ? item : existing)));
  }
  function removeRule(index: number) {
    handleRulesChange(rules.filter((_, i) => i !== index));
  }

  function handleRemoveRule(index: number) {
    removeRule(index);
  }

  const displayRules = useMemo<MissingRule[]>(() => {
    if (rules.length === 0) return [createDefault()];
    return rules;
  }, [rules]);
  const coreRuleCount = rules.length;

  function updateDisplayRule(index: number, patch: Partial<MissingRule>) {
    if (index < coreRuleCount) {
      updateRule(index, { ...rules[index], ...patch });
    } else if (rules.length === 0 && patch.column) {
      handleRulesChange([createDefault({ column: patch.column })]);
    }
  }

  function removeDisplayRule(index: number) {
    if (index < coreRuleCount) {
      handleRemoveRule(index);
    }
  }

  function insertRule(index: number) {
    const insertAt = index < coreRuleCount ? index + 1 : coreRuleCount;
    const next = [...rules];
    next.splice(insertAt, 0, createDefault());
    handleRulesChange(next);
  }

  function handleDragStart(index: number) {
    setDraggingIndex(index);
  }
  function handleDragOver(e: React.DragEvent<HTMLDivElement>, index: number) {
    e.preventDefault();
    setDropTargetIndex(index);
  }
  function handleDrop(index: number) {
    if (draggingIndex === null || rules.length === 0) return;
    if (draggingIndex === index) return;
    const next = [...rules];
    const [moved] = next.splice(draggingIndex, 1);
    const insertAt = index > draggingIndex ? index - 1 : index;
    next.splice(insertAt, 0, moved);
    handleRulesChange(next);
  }
  function handleDragEnd() {
    setDraggingIndex(null);
    setDropTargetIndex(null);
  }

  const methodLabel = useCallback(
    (key: string) => {
      const entry = [...BASE_METHODS, ...ORDERED_METHODS, ...STATISTICAL_METHODS].find(
        (m) => m.value === key
      );
      return entry ? t(entry.labelKey, { defaultValue: entry.label }) : key;
    },
    [t]
  );

  const description = useMemo(() => {
    const cols = rowColumns;
    const colList = cols.length > 0 ? cols.join('、') : undefined;
    if (rowCondition === 'all_null') {
      if (colList) {
        return tr('missingDescAllNullWithCols', '删除 {{cols}} 均为空的数据行。').replace(
          '{{cols}}',
          colList
        );
      }
      return tr(
        'missingDescAllNullNoCols',
        '删除全部字段均为空的数据行。未指定判断字段，所有字段均参与判空。'
      );
    }
    if (colList) {
      return tr('missingDescAnyNullWithCols', '删除 {{cols}} 中任意字段为空的数据行。').replace(
        '{{cols}}',
        colList
      );
    }
    return tr('missingDescAnyNullNoCols', '删除任意字段为空的数据行。');
  }, [rowCondition, rowColumns, tr]);

  return (
    <div className="flex h-full min-h-0 flex-1 gap-0 overflow-hidden">
      {/* Left sidebar — global config */}
      <div className="flex w-[180px] shrink-0 flex-col gap-3.5 border-r border-border-muted bg-surface/40 p-3.5">
        <section className="flex flex-col gap-1.5">
          <GlassRadioSelect
            value={tabMode}
            options={[
              { value: 'row', label: tr('rowProcess', '按行处理') },
              { value: 'column', label: tr('colProcess', '按列处理') },
            ]}
            onChange={(v) => {
              if (v === 'row') setRowMode('any_null');
              else setColumnMode();
            }}
            label={tr('missingProcessMode', '处理模式')}
          />
        </section>

        {tabMode === 'row' && (
          <>
            <div className="h-px bg-border-muted" />
            <GlassRadioSelect
              value={rowCondition}
              options={[
                { value: 'all_null', label: tr('allNull', '全部为空') },
                { value: 'any_null', label: tr('anyNull', '任一为空') },
              ]}
              onChange={(v) => setRowMode(v as 'all_null' | 'any_null')}
              label={tr('missingTriggerCondition', '触发条件')}
            />
          </>
        )}
      </div>

      {/* Right content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {tabMode === 'row' && (
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {/* Judge fields */}
            <div className="grid gap-1.5">
              <GlassTagBar
                items={rowColumns}
                onRemove={removeRowColumn}
                onClear={() => handleRowsColumnsChange([])}
                open={showFieldPicker}
                onToggle={() => setShowFieldPicker((v) => !v)}
                toggleStyle="chevron"
                density="compact"
                placeholder={tr('missingEmptyMeansAllFields', '留空 = 所有字段参与判断')}
              />
              {showFieldPicker && (
                <GlassFieldSelector
                  columns={fieldCompletions}
                  selected={rowColumns}
                  onChange={handleRowsColumnsChange}
                  maxHeight="160px"
                  variant="glass"
                />
              )}
            </div>

            {/* Description */}
            <p className="text-[11px] leading-4 text-text-muted">{description}</p>
          </div>
        )}

        {tabMode === 'column' && (
          <div className="flex flex-1 flex-col gap-2 overflow-hidden p-4">
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
              {displayRules.map((item, i) => {
                const isSentinel = i >= coreRuleCount;
                const colType = item.column ? columnTypes[item.column] : undefined;
                const availableMethods = methodsForType(colType);
                const validMethodValues = availableMethods.map((m) => m.value);
                const effectiveMethod = validMethodValues.includes(item.method)
                  ? item.method
                  : (availableMethods[0]?.value ?? 'skip');
                const needsValue =
                  effectiveMethod === 'nullify_values' || effectiveMethod === 'literal_fill';

                return (
                  <div
                    key={item.id ?? i}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDrop={() => handleDrop(i)}
                    onDragEnd={handleDragEnd}
                    className={`relative flex items-center gap-1.5 ${
                      draggingIndex === i ? 'opacity-40' : ''
                    }`}
                  >
                    {dropTargetIndex === i && draggingIndex !== i && (
                      <div className="pointer-events-none absolute -top-0.5 left-0 right-0 h-0.5 bg-accent" />
                    )}

                    {/* Drag handle */}
                    <div
                      draggable={!isSentinel}
                      onDragStart={() => handleDragStart(i)}
                      className={`inline-flex h-7 w-6 flex-shrink-0 items-center justify-center rounded text-text-muted transition-colors ${
                        isSentinel
                          ? 'cursor-not-allowed opacity-30'
                          : 'cursor-grab hover:bg-surface-hover hover:text-text-secondary active:cursor-grabbing'
                      }`}
                      title={tr('missingDragToReorder', '拖动排序')}
                      aria-label={tr('missingDragToReorder', '拖动排序')}
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>

                    {/* Field */}
                    <div className="flex-[2] min-w-0">
                      <GlassFieldCombo
                        value={item.column}
                        options={fieldCompletions}
                        columnTypes={columnTypes}
                        onChange={(col) => {
                          if (isSentinel) {
                            updateDisplayRule(i, { column: col });
                            return;
                          }
                          const newType = columnTypes[col];
                          const methods = methodsForType(newType);
                          const methodOk = methods.some((m) => m.value === item.method);
                          updateDisplayRule(i, {
                            ...item,
                            column: col,
                            method: methodOk ? item.method : (methods[0]?.value ?? 'skip'),
                          });
                        }}
                        placeholder={tr('selectField', '选择字段')}
                        className="h-8 w-full"
                      />
                    </div>

                    {/* Method */}
                    <div className="flex-[1.5] min-w-0">
                      <GlassOperatorSelect
                        value={effectiveMethod}
                        disabled={!item.column}
                        onChange={(m) => {
                          updateDisplayRule(i, {
                            ...item,
                            method: m,
                            values: m === 'nullify_values' ? (item.values ?? []) : undefined,
                            value: m === 'literal_fill' ? (item.value ?? '') : undefined,
                          });
                        }}
                        groups={[
                          {
                            key: 'methods',
                            items: availableMethods.map((m) => ({
                              value: m.value,
                              label: methodLabel(m.value),
                            })),
                          },
                        ]}
                        className="h-8 w-full text-[12px]"
                      />
                    </div>

                    {/* Value */}
                    {needsValue && item.column && (
                      <div className="flex-[3] min-w-0">
                        <GlassFormTextInput
                          value={
                            effectiveMethod === 'nullify_values'
                              ? (item.values ?? []).join(', ')
                              : String(item.value ?? '')
                          }
                          onChange={(raw) => {
                            if (effectiveMethod === 'nullify_values') {
                              const vals = raw
                                .split(',')
                                .map((v) => v.trim().replace(/^"|"$/g, ''))
                                .filter(Boolean);
                              updateDisplayRule(i, {
                                ...item,
                                values: vals.length > 0 ? vals : undefined,
                              });
                            } else {
                              updateDisplayRule(i, { ...item, value: raw });
                            }
                          }}
                          placeholder={
                            effectiveMethod === 'nullify_values'
                              ? tr('missingSpecialValuesPlaceholder', '特殊值，逗号分隔')
                              : tr('missingFillPlaceholder', '填充值')
                          }
                        />
                      </div>
                    )}

                    {/* Spacer pushes action buttons to the right */}
                    <div className="min-w-2 flex-1" />

                    {/* Add row */}
                    <button
                      type="button"
                      onClick={() => insertRule(i)}
                      className="inline-flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-accent"
                      title={tr('missingAddRow', '添加行')}
                      aria-label={tr('missingAddRow', '添加行')}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      disabled={isSentinel}
                      onClick={() => removeDisplayRule(i)}
                      className="inline-flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-30"
                      title={tr('missingRemoveRow', '删除行')}
                      aria-label={tr('missingRemoveRow', '删除行')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

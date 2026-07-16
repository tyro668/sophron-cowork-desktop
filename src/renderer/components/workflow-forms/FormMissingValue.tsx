import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassTagBar } from './shared/GlassTagBar';
import { GlassFieldCombo } from './shared/GlassFieldCombo';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import type { OperatorFormProps } from './index';
import { GlassFieldSelector } from './shared/GlassFieldSelector';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { GlassRowList, type RowAction } from './shared/GlassRowList';
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
    () => (node.config.rules as MissingRule[]) ?? [createDefault()],
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
  const dragIndexRef = useRef<number | null>(null);
  const [dragRules, setDragRules] = useState<MissingRule[] | null>(null);

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

  const updateRule = useCallback(
    (index: number, patch: Partial<MissingRule>) => {
      handleRulesChange(
        rules.map((existing, i) => (i === index ? { ...existing, ...patch } : existing))
      );
    },
    [rules, handleRulesChange]
  );

  const removeRule = useCallback(
    (index: number) => {
      let next = rules.filter((_, i) => i !== index);
      if (next.length === 0) next = [createDefault()];
      handleRulesChange(next);
    },
    [rules, handleRulesChange]
  );

  const insertRule = useCallback(
    (index: number) => {
      const next = [...rules];
      next.splice(index + 1, 0, createDefault());
      handleRulesChange(next);
    },
    [rules, handleRulesChange]
  );

  const activeRules = dragRules ?? rules;

  const handleDragStart = useCallback(
    (index: number) => {
      dragIndexRef.current = index;
      setDragRules([...rules]);
    },
    [rules]
  );

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    const from = dragIndexRef.current;
    setDragRules((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
    dragIndexRef.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragRules && dragIndexRef.current !== null) {
      handleRulesChange(dragRules);
    }
    dragIndexRef.current = null;
    setDragRules(null);
  }, [dragRules, handleRulesChange]);

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
              <GlassRowList
                items={activeRules}
                columns={[
                  {
                    flex: 'flex-[2]',
                    header: '',
                    render: (item: MissingRule, i: number) => (
                      <GlassFieldCombo
                        value={item.column}
                        options={fieldCompletions}
                        columnTypes={columnTypes}
                        onChange={(col) => {
                          const newType = columnTypes[col];
                          const methods = methodsForType(newType);
                          const methodOk = methods.some((m) => m.value === item.method);
                          updateRule(i, {
                            column: col,
                            method: methodOk ? item.method : (methods[0]?.value ?? 'skip'),
                          });
                        }}
                        placeholder={tr('selectField', '选择字段')}
                        className="h-7 w-full"
                      />
                    ),
                  },
                  {
                    flex: 'flex-[1.5]',
                    header: '',
                    render: (item: MissingRule, i: number) => {
                      const colType = item.column ? columnTypes[item.column] : undefined;
                      const availableMethods = methodsForType(colType);
                      const validMethodValues = availableMethods.map((m) => m.value);
                      const effectiveMethod = validMethodValues.includes(item.method)
                        ? item.method
                        : (availableMethods[0]?.value ?? 'skip');
                      return (
                        <GlassOperatorSelect
                          value={effectiveMethod}
                          disabled={!item.column}
                          onChange={(m) => {
                            updateRule(i, {
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
                          className="h-7 w-full text-[12px]"
                        />
                      );
                    },
                  },
                  {
                    flex: 'flex-[3]',
                    header: '',
                    render: (item: MissingRule, i: number) => {
                      const colType = item.column ? columnTypes[item.column] : undefined;
                      const availableMethods = methodsForType(colType);
                      const validMethodValues = availableMethods.map((m) => m.value);
                      const effectiveMethod = validMethodValues.includes(item.method)
                        ? item.method
                        : (availableMethods[0]?.value ?? 'skip');
                      const needsValue =
                        effectiveMethod === 'nullify_values' || effectiveMethod === 'literal_fill';
                      if (!needsValue || !item.column) {
                        return <span className="w-full" />;
                      }
                      return (
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
                              updateRule(i, {
                                values: vals.length > 0 ? vals : undefined,
                              });
                            } else {
                              updateRule(i, { value: raw });
                            }
                          }}
                          placeholder={
                            effectiveMethod === 'nullify_values'
                              ? tr('missingSpecialValuesPlaceholder', '特殊值，逗号分隔')
                              : tr('missingFillPlaceholder', '填充值')
                          }
                        />
                      );
                    },
                  },
                ]}
                onAdd={(i) => insertRule(i)}
                onRemove={(i) => removeRule(i)}
                addTitle={tr('missingAddRow', '添加行')}
                removeTitle={tr('missingRemoveRow', '删除行')}
                canAct={(action: RowAction, _i) => (action === 'remove' ? rules.length > 1 : true)}
                draggable
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                getRowOpacity={(i) => !!(dragRules && dragIndexRef.current === i)}
                dragTitle={tr('missingDragToReorder', '拖动排序')}
                hideHeader
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

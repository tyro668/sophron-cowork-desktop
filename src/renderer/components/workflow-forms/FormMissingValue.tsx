import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import type { OperatorFormProps } from './index';
import { GlassFieldTagPicker } from './shared/GlassFieldTagPicker';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { GlassRowList, type RowAction } from './shared/GlassRowList';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import {
  formatMissingValueListInput,
  parseMissingValueInput,
  parseMissingValueListInput,
  validateMissingValueInput,
  validateMissingValueListInput,
} from '../../../shared/missing-value-values';
import { methodsForMissingValueType } from '../../../shared/operator-config';
import type {
  MissingValueMethod,
  MissingValueRule,
} from '../../../shared/operator-schemas/missing-value';

function createRuleId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function createEmptyRule(): MissingValueRule {
  return { id: createRuleId(), column: '', method: 'literal_fill', value: '' };
}

interface MissingValueMethodDefinition {
  value: MissingValueMethod;
  labelKey: string;
}

const BASE_METHODS: MissingValueMethodDefinition[] = [
  { value: 'skip', labelKey: 'ruleMethods.skip' },
  { value: 'nullify_values', labelKey: 'ruleMethods.nullify_values' },
  { value: 'literal_fill', labelKey: 'ruleMethods.literal_fill' },
  { value: 'drop', labelKey: 'ruleMethods.drop' },
];

const STATISTICAL_METHODS: MissingValueMethodDefinition[] = [
  { value: 'mean_fill', labelKey: 'ruleMethods.mean_fill' },
  { value: 'median_fill', labelKey: 'ruleMethods.median_fill' },
];

const MODE_METHODS: MissingValueMethodDefinition[] = [
  { value: 'mode_fill', labelKey: 'ruleMethods.mode_fill' },
];

const ORDERED_METHODS: MissingValueMethodDefinition[] = [
  { value: 'forward_fill', labelKey: 'ruleMethods.forward_fill' },
  { value: 'backward_fill', labelKey: 'ruleMethods.backward_fill' },
];

function methodsForType(colType: string | undefined) {
  const definitions = [
    ...BASE_METHODS,
    ...ORDERED_METHODS,
    ...STATISTICAL_METHODS,
    ...MODE_METHODS,
  ];
  const allowedMethods = new Set(methodsForMissingValueType(colType));
  return definitions.filter((method) => allowedMethods.has(method.value));
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
  const tr = useFormTranslation();
  const updateConfig = useUpdateConfig(onNodeChange);

  const strategy = (node.config.strategy as string) ?? 'by_column';
  const rules = useMemo<MissingValueRule[]>(() => {
    const configuredRules = (node.config.rules as MissingValueRule[] | undefined) ?? [];
    return configuredRules.length > 0 ? configuredRules : [createEmptyRule()];
  }, [node.config.rules]);
  const rowColumns = useMemo<string[]>(
    () => (node.config.columns as string[]) ?? [],
    [node.config.columns]
  );

  const tabMode: TabMode =
    strategy === 'drop_empty_rows' || strategy === 'drop_rows_by_nulls' ? 'row' : 'column';
  const rowCondition: string =
    strategy === 'drop_empty_rows' ? 'all_null' : ((node.config.condition as string) ?? 'any_null');

  const [showFieldPicker, setShowFieldPicker] = useState(true);
  const [valueDrafts, setValueDrafts] = useState<Record<string, string>>({});
  const removingRef = useRef(false);
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const handleRulesChange = useCallback(
    (items: MissingValueRule[]) => {
      const itemsWithId = items.map((item) => (item.id ? item : { ...item, id: createRuleId() }));
      updateConfig((cfg) => ({ ...cfg, rules: itemsWithId.length > 0 ? itemsWithId : undefined }));
    },
    [updateConfig]
  );

  const {
    activeItems: activeRules,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    isDragging,
    resetDrag,
    dragIndexRef,
  } = useDragReorder(rules, handleRulesChange);

  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [rules, isDragging, resetDrag]);

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

  const handleRowsColumnsChange = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => {
        const condition =
          cfg.strategy === 'drop_empty_rows'
            ? 'all_null'
            : ((cfg.condition as string | undefined) ?? 'any_null');
        const isAllNull = condition === 'all_null';
        const hasColumns = next.length > 0;
        if (isAllNull && !hasColumns) {
          return {
            ...cfg,
            strategy: 'drop_empty_rows',
            condition: 'all_null',
            columns: undefined,
          };
        }
        return {
          ...cfg,
          strategy: 'drop_rows_by_nulls',
          condition,
          columns: hasColumns ? next : undefined,
        };
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
        const condition =
          cfg.strategy === 'drop_empty_rows'
            ? 'all_null'
            : ((cfg.condition as string | undefined) ?? 'any_null');
        const isAllNull = condition === 'all_null';
        if (isAllNull && next.length === 0) {
          return {
            ...cfg,
            strategy: 'drop_empty_rows',
            condition: 'all_null',
            columns: undefined,
          };
        }
        return {
          ...cfg,
          strategy: 'drop_rows_by_nulls',
          condition,
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
    (index: number, patch: Partial<MissingValueRule>) => {
      handleRulesChange(
        rules.map((existing, i) => (i === index ? { ...existing, ...patch } : existing))
      );
    },
    [rules, handleRulesChange]
  );

  const removeRule = useCallback(
    (index: number) => {
      handleRulesChange(rules.filter((_, i) => i !== index));
    },
    [rules, handleRulesChange]
  );

  const insertRule = useCallback(
    (index: number) => {
      if (rules.length >= fieldCompletions.length) return;
      const next = [...rules];
      next.splice(index + 1, 0, createEmptyRule());
      handleRulesChange(next);
    },
    [rules, fieldCompletions.length, handleRulesChange]
  );

  const copyRule = useCallback(
    (index: number) => {
      if (rules.length >= fieldCompletions.length) return;
      const source = rules[index];
      if (!source) return;
      const next = [...rules];
      next.splice(index + 1, 0, {
        ...source,
        id: createRuleId(),
        column: '',
        values: source.values ? [...source.values] : undefined,
      });
      handleRulesChange(next);
    },
    [rules, fieldCompletions.length, handleRulesChange]
  );

  const methodLabel = useCallback(
    (key: string) => {
      const entry = [
        ...BASE_METHODS,
        ...ORDERED_METHODS,
        ...STATISTICAL_METHODS,
        ...MODE_METHODS,
      ].find((m) => m.value === key);
      return entry ? t('data.workflow.' + entry.labelKey) : key;
    },
    [t]
  );

  const description = useMemo(() => {
    const cols = rowColumns;
    const colList = cols.length > 0 ? cols.join('、') : undefined;
    if (rowCondition === 'all_null') {
      if (colList) {
        return tr('missingDescAllNullWithCols').replace('{{cols}}', colList);
      }
      return tr('missingDescAllNullNoCols');
    }
    if (colList) {
      return tr('missingDescAnyNullWithCols').replace('{{cols}}', colList);
    }
    return tr('missingDescAnyNullNoCols');
  }, [rowCondition, rowColumns, tr]);

  return (
    <div className="flex h-full min-h-0 flex-1 gap-0 overflow-hidden">
      {/* Left sidebar — global config */}
      <div className="scrollbar-hover flex w-[180px] shrink-0 flex-col overflow-y-auto border-r border-border-muted bg-surface/40 p-3.5">
        <GlassRadioSelect
          value={tabMode}
          options={[
            { value: 'row', label: tr('rowProcess'), tip: tr('missingRowProcessTip') },
            { value: 'column', label: tr('colProcess'), tip: tr('missingColumnProcessTip') },
          ]}
          onChange={(v) => {
            if (v === 'row') setRowMode('any_null');
            else setColumnMode();
          }}
          label={tr('missingProcessMode')}
        />
      </div>

      {/* Right content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {tabMode === 'row' && (
          <div className="scrollbar-hover flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <GlassRadioSelect
              value={rowCondition}
              options={[
                { value: 'all_null', label: tr('allNull') },
                { value: 'any_null', label: tr('anyNull') },
              ]}
              onChange={(v) => setRowMode(v as 'all_null' | 'any_null')}
              label={tr('missingTriggerCondition')}
              direction="horizontal"
            />

            {/* Description */}
            <p className="text-[11px] leading-4 text-text-muted">{description}</p>

            {/* Judge fields */}
            <GlassFieldTagPicker
              columns={fieldCompletions}
              selected={rowColumns}
              onChange={handleRowsColumnsChange}
              onRemove={removeRowColumn}
              onClear={() => handleRowsColumnsChange([])}
              open={showFieldPicker}
              onToggle={() => setShowFieldPicker((v) => !v)}
              maxHeight="160px"
              variant="glass"
              placeholder={tr('missingEmptyMeansAllFields')}
            />
          </div>
        )}

        {tabMode === 'column' && (
          <div className="flex flex-1 flex-col gap-2 overflow-hidden p-4">
            <div className="scrollbar-hover flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
              <GlassRowList
                items={activeRules}
                columns={[
                  {
                    flex: 'flex-[2]',
                    header: tr('missingColumnHeader'),
                    render: (item: MissingValueRule, i: number) => (
                      <GlassFieldSingleSelect
                        value={item.column}
                        options={fieldCompletions}
                        disabledOptions={
                          new Set(
                            rules
                              .filter((_, ruleIndex) => ruleIndex !== i)
                              .map((rule) => rule.column)
                              .filter(Boolean)
                          )
                        }
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
                        placeholder={tr('selectField')}
                        className="h-7 w-full"
                      />
                    ),
                  },
                  {
                    flex: 'flex-[1.5]',
                    header: tr('missingMethodHeader'),
                    render: (item: MissingValueRule, i: number) => {
                      const colType = item.column ? columnTypes[item.column] : undefined;
                      const availableMethods = methodsForType(colType);
                      const validMethodValues = availableMethods.map((m) => m.value);
                      const effectiveMethod = validMethodValues.includes(item.method)
                        ? item.method
                        : (availableMethods[0]?.value ?? 'skip');
                      return (
                        <GlassOptionSingleSelect
                          value={effectiveMethod}
                          onChange={(m) => {
                            updateRule(i, {
                              method: m as MissingValueMethod,
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
                          variant="highlight"
                          className="h-7 w-full text-[12px] [&>span]:text-left"
                        />
                      );
                    },
                  },
                  {
                    flex: 'flex-[3]',
                    header: tr('missingValueHeader'),
                    render: (item: MissingValueRule, i: number) => {
                      const colType = item.column ? columnTypes[item.column] : undefined;
                      const availableMethods = methodsForType(colType);
                      const validMethodValues = availableMethods.map((m) => m.value);
                      const effectiveMethod = validMethodValues.includes(item.method)
                        ? item.method
                        : (availableMethods[0]?.value ?? 'skip');
                      const needsValue =
                        effectiveMethod === 'nullify_values' || effectiveMethod === 'literal_fill';
                      if (!needsValue) {
                        return <span className="w-full" />;
                      }
                      const draftKey = `${item.id ?? i}:${effectiveMethod}`;
                      const formattedValue =
                        effectiveMethod === 'nullify_values'
                          ? formatMissingValueListInput(item.values ?? [])
                          : String(item.value ?? '');
                      const displayedValue = valueDrafts[draftKey] ?? formattedValue;
                      const inputError =
                        effectiveMethod === 'nullify_values'
                          ? validateMissingValueListInput(displayedValue, colType)
                          : validateMissingValueInput(displayedValue, colType);
                      const errorMessage =
                        inputError === 'required'
                          ? tr('missingValueRequired')
                          : inputError === 'number'
                            ? tr('missingInvalidNumber')
                            : inputError === 'boolean'
                              ? tr('missingInvalidBoolean')
                              : undefined;
                      return (
                        <GlassFormTextInput
                          value={displayedValue}
                          onChange={(raw) => {
                            setValueDrafts((drafts) => ({ ...drafts, [draftKey]: raw }));
                            if (effectiveMethod === 'nullify_values') {
                              const vals = parseMissingValueListInput(raw, colType);
                              updateRule(i, {
                                values: vals.length > 0 ? vals : undefined,
                              });
                            } else {
                              updateRule(i, {
                                value: parseMissingValueInput(raw, colType),
                              });
                            }
                          }}
                          onBlur={() =>
                            setValueDrafts((drafts) => {
                              const next = { ...drafts };
                              delete next[draftKey];
                              return next;
                            })
                          }
                          placeholder={
                            errorMessage ??
                            (effectiveMethod === 'nullify_values'
                              ? tr('missingSpecialValuesPlaceholder')
                              : tr('missingFillPlaceholder'))
                          }
                        />
                      );
                    },
                  },
                ]}
                actions={['add', 'copy', 'remove']}
                onAdd={(i) => insertRule(i)}
                onCopy={(i) => copyRule(i)}
                onRemove={(i) => removeRule(i)}
                addTitle={tr('missingAddRow')}
                copyTitle={tr('copyRow')}
                removeTitle={tr('missingRemoveRow')}
                canAct={(action: RowAction) => {
                  if (action === 'add' || action === 'copy') {
                    return rules.length < fieldCompletions.length;
                  }
                  return true;
                }}
                draggable
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                getRowOpacity={(i) => !!(isDragging && dragIndexRef.current === i)}
                dragTitle={tr('missingDragToReorder')}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import type { OperatorFormProps } from './index';
import { GlassFieldMultiDropdown } from './shared/GlassFieldMultiDropdown';
import { GlassSegmentedControl } from './shared/GlassSegmentedControl';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassRowList } from './shared/GlassRowList';
import { createStableRowId, ensureStableRowIds } from './shared/rowListOperations';
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
import {
  methodsForMissingValueType,
  normalizeMissingValueMethods,
} from '../../../shared/operator-config';
import type {
  MissingValueMethod,
  MissingValueRule,
} from '../../../shared/operator-schemas/missing-value';

function createEmptyRule(): MissingValueRule {
  return { id: createStableRowId(), column: '', method: 'literal_fill', value: '' };
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
  const tr = useFormTranslation('missingValue');
  const updateConfig = useUpdateConfig(onNodeChange);

  const strategy = (node.config.strategy as string) ?? 'by_column';
  const rules = useMemo<MissingValueRule[]>(() => {
    const configuredRules = (node.config.rules as MissingValueRule[] | undefined) ?? [];
    return configuredRules.length > 0 ? ensureStableRowIds(configuredRules) : [createEmptyRule()];
  }, [node.config.rules]);
  const rowColumns = useMemo<string[]>(
    () => (node.config.columns as string[]) ?? [],
    [node.config.columns]
  );

  const tabMode: TabMode =
    strategy === 'drop_empty_rows' || strategy === 'drop_rows_by_nulls' ? 'row' : 'column';
  const rowCondition: string =
    strategy === 'drop_empty_rows' ? 'all_null' : ((node.config.condition as string) ?? 'any_null');

  const [valueDrafts, setValueDrafts] = useState<Record<string, string>>({});
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const handleRulesChange = useCallback(
    (items: MissingValueRule[]) => {
      const itemsWithId = ensureStableRowIds(items);
      updateConfig((cfg) => ({ ...cfg, rules: itemsWithId.length > 0 ? itemsWithId : undefined }));
    },
    [updateConfig]
  );

  const {
    activeItems: activeRules,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleKeyboardMove,
    isDragging,
    resetDrag,
    dragIndexRef,
  } = useDragReorder(rules, handleRulesChange);

  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [rules, isDragging, resetDrag]);

  // A rule's method may become invalid once the column types resolve (DSL
  // imports, upstream schema changes). Write the corrected method back instead
  // of displaying a method the config does not hold.
  useEffect(() => {
    if (Object.keys(columnTypes).length === 0) return;
    const { rules: next, changed } = normalizeMissingValueMethods(rules, columnTypes);
    if (!changed) return;
    handleRulesChange(next);
  }, [columnTypes, rules, handleRulesChange]);

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
      const next = [...rules];
      next.splice(index + 1, 0, createEmptyRule());
      handleRulesChange(next);
    },
    [rules, handleRulesChange]
  );

  const copyRule = useCallback(
    (index: number) => {
      const source = rules[index];
      if (!source) return;
      const next = [...rules];
      next.splice(index + 1, 0, {
        ...source,
        id: createStableRowId(),
        values: source.values ? [...source.values] : undefined,
      });
      handleRulesChange(next);
    },
    [rules, handleRulesChange]
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

  return (
    <div className="scrollbar-hover flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('missingProcessMode')}</GlassFormLabel>
        <GlassSegmentedControl
          value={tabMode}
          options={[
            { value: 'row', label: tr('rowProcess'), tip: tr('missingRowProcessTip') },
            { value: 'column', label: tr('colProcess'), tip: tr('missingColumnProcessTip') },
          ]}
          onChange={(v) => {
            if (v === 'row') setRowMode('any_null');
            else setColumnMode();
          }}
          ariaLabel={tr('missingProcessMode')}
        />
      </div>

      {tabMode === 'row' ? (
        <>
          <div className="flex items-center gap-2">
            <GlassFormLabel>{tr('missingTriggerCondition')}</GlassFormLabel>
            <GlassSegmentedControl
              value={rowCondition}
              options={[
                { value: 'any_null', label: tr('anyNull') },
                { value: 'all_null', label: tr('allNull') },
              ]}
              onChange={(v) => setRowMode(v as 'all_null' | 'any_null')}
              ariaLabel={tr('missingTriggerCondition')}
            />
          </div>
          <div className="flex items-center gap-2">
            <GlassFormLabel>{tr('missingJudgeFields')}</GlassFormLabel>
            <div className="min-w-0 flex-1">
              <GlassFieldMultiDropdown
                columns={fieldCompletions}
                selected={rowColumns}
                onChange={handleRowsColumnsChange}
                columnTypes={columnTypes}
                placeholder={tr('missingEmptyMeansAllFields')}
                maxHeight="300px"
              />
            </div>
          </div>
        </>
      ) : (
        <GlassRowList
          items={activeRules}
          getKey={(item, index) => item.id ?? `rule-${index}`}
          columns={[
            {
              flex: 'flex-[2]',
              header: tr('missingColumnHeader'),
              render: (item: MissingValueRule, i: number) => (
                <GlassFieldSingleSelect
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
                  placeholder={tr('fieldPicker.selectField')}
                  className="h-8 w-full"
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
                    className="h-8 w-full text-[12px] [&>span]:text-left"
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
          copyTitle={tr('rowList.copyRow')}
          removeTitle={tr('missingRemoveRow')}
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onKeyboardMove={handleKeyboardMove}
          getRowOpacity={(i) => !!(isDragging && dragIndexRef.current === i)}
          dragTitle={tr('missingDragToReorder')}
        />
      )}
    </div>
  );
}

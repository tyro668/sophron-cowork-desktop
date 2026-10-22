import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import type { OperatorFormProps } from './types';
import { GlassOptionMultiSelect } from './shared/GlassOptionMultiSelect';
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
  SegmentCells,
} from './shared/FormGrid';
import { MISSING_VALUE_GRID_COLUMNS } from './shared/gridColumns';
import { useGridRowDrag } from './shared/useGridRowDrag';
import { createStableRowId, ensureStableRowIds, patchRowAt } from './shared/rowListOperations';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
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
  return { id: createStableRowId(), field: '', method: 'literal_fill', value: '' };
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
  pipelineId,
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
    () => (node.config.fields as string[]) ?? [],
    [node.config.fields]
  );

  const tabMode: TabMode =
    strategy === 'drop_empty_rows' || strategy === 'drop_rows_by_nulls' ? 'row' : 'column';
  const rowCondition: string =
    strategy === 'drop_empty_rows' ? 'all_null' : ((node.config.condition as string) ?? 'any_null');

  const [valueDrafts, setValueDrafts] = useState<Record<string, string>>({});
  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });
  const handleRulesChange = useCallback(
    (items: MissingValueRule[]) => {
      const itemsWithId = ensureStableRowIds(items);
      updateConfig((cfg) => ({ ...cfg, rules: itemsWithId.length > 0 ? itemsWithId : undefined }));
    },
    [updateConfig]
  );

  const {
    activeItems: activeRules,
    rowProps,
    dragHandle,
  } = useGridRowDrag(rules, handleRulesChange);

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
      const columns = cfg.fields as string[] | undefined;
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
      fields: undefined,
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
            fields: undefined,
          };
        }
        return {
          ...cfg,
          strategy: 'drop_rows_by_nulls',
          condition,
          fields: hasColumns ? next : undefined,
        };
      });
    },
    [updateConfig]
  );

  // Functional update against the latest config (no stale `rules` closure).
  const updateRule = useCallback(
    (index: number, patch: Partial<MissingValueRule>) => {
      updateConfig((cfg) => {
        const current = (cfg.rules as MissingValueRule[] | undefined) ?? [];
        const next = ensureStableRowIds(patchRowAt(current, rules, index, patch));
        return { ...cfg, rules: next };
      });
    },
    [rules, updateConfig]
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

  // Ordered fills run over the physical row order across the whole column —
  // the tooltip states that scope so users can tell fill direction.
  const methodTip = useCallback(
    (key: string) =>
      ORDERED_METHODS.some((m) => m.value === key)
        ? t(`data.workflow.ruleMethodTips.${key}`)
        : undefined,
    [t]
  );

  const effectiveMethodOf = (item: MissingValueRule) => {
    const colType = item.field ? columnTypes[item.field] : undefined;
    const availableMethods = methodsForType(colType);
    const method = availableMethods.some((m) => m.value === item.method)
      ? item.method
      : (availableMethods[0]?.value ?? 'skip');
    return { colType, availableMethods, method };
  };

  const rowLabels = {
    add: tr('missingAddRow'),
    copy: tr('rowList.copyRow'),
    remove: tr('missingRemoveRow'),
    drag: tr('missingDragToReorder'),
  };

  const ruleViews = activeRules.map((item, i) => {
    const { colType, availableMethods, method } = effectiveMethodOf(item);
    const needsValue = method === 'nullify_values' || method === 'literal_fill';
    const draftKey = `${item.id ?? i}:${method}`;
    const formattedValue =
      method === 'nullify_values'
        ? formatMissingValueListInput(item.values ?? [])
        : String(item.value ?? '');
    const displayedValue = valueDrafts[draftKey] ?? formattedValue;
    const inputError = !needsValue
      ? undefined
      : method === 'nullify_values'
        ? validateMissingValueListInput(displayedValue, colType)
        : validateMissingValueInput(displayedValue, colType);
    const field = item.field || tr('missingColumnHeader');
    const errorMessage =
      inputError === 'required'
        ? method === 'nullify_values'
          ? tr('missingValueRequired')
          : tr('missingFillRequired')
        : inputError === 'number'
          ? tr('missingErrNumber', { field })
          : inputError === 'boolean'
            ? tr('missingErrBoolean', { field })
            : undefined;
    return {
      item,
      colType,
      availableMethods,
      method,
      needsValue,
      draftKey,
      displayedValue,
      errorMessage,
    };
  });
  const errorCount = ruleViews.filter((v) => v.errorMessage).length;

  const rowDesc =
    rowCondition === 'all_null'
      ? rowColumns.length > 0
        ? tr('missingDescAllNullWithCols', { cols: rowColumns.join(tr('missingColListSeparator')) })
        : tr('missingDescAllNullNoCols')
      : rowColumns.length > 0
        ? tr('missingDescAnyNullWithCols', { cols: rowColumns.join(tr('missingColListSeparator')) })
        : tr('missingDescAnyNullNoCols');

  return (
    <FormScroll>
      <FormGrid columns={MISSING_VALUE_GRID_COLUMNS} testId="missing-value-form-grid">
        <LabelCell>{tr('missingProcessMode')}</LabelCell>
        <SegmentCells
          value={tabMode}
          options={[
            { value: 'row', label: tr('rowProcess'), title: tr('missingRowProcessTip') },
            { value: 'column', label: tr('colProcess'), title: tr('missingColumnProcessTip') },
          ]}
          onChange={(v) => {
            if (v === 'row') setRowMode('any_null');
            else setColumnMode();
          }}
          ariaLabel={tr('missingProcessMode')}
        />
        <Cell span={3} v={['muted']}>
          {tabMode === 'row' ? tr('missingRowProcessTip') : tr('missingColumnProcessTip')}
        </Cell>

        {tabMode === 'row' ? (
          <>
            <LabelCell>{tr('missingTriggerCondition')}</LabelCell>
            <SegmentCells
              value={rowCondition as 'any_null' | 'all_null'}
              options={[
                { value: 'any_null', label: tr('anyNull') },
                { value: 'all_null', label: tr('allNull') },
              ]}
              onChange={(v) => setRowMode(v)}
              ariaLabel={tr('missingTriggerCondition')}
            />
            <Cell span={3} v={['blank']} />
            <LabelCell>{tr('missingJudgeFields')}</LabelCell>
            <Cell span={5} v={['ctl', 'chips']}>
              <GlassOptionMultiSelect
                options={fieldCompletions}
                selected={rowColumns}
                onChange={handleRowsColumnsChange}
                optionTypes={columnTypes}
                placeholder={tr('missingEmptyMeansAllFields')}
                maxHeight="300px"
                className="w-full"
              />
            </Cell>
            <Cell v={['lab']} />
            <HintRow span={5}>{rowDesc}</HintRow>
          </>
        ) : (
          <>
            <LabelCell rowSpan={activeRules.length + errorCount + 2}>
              {tr('missingRulesLabel')}
            </LabelCell>
            <Cell span={2} v={['th']}>
              {tr('missingColumnHeader')}
            </Cell>
            <Cell v={['th']}>{tr('missingMethodHeader')}</Cell>
            <Cell v={['th']}>{tr('missingValueHeader')}</Cell>
            <Cell v={['th']} />
            {ruleViews.map((view, i) => {
              const { item, colType, availableMethods, method } = view;
              return (
                <Fragment key={item.id ?? `rule-${i}`}>
                  <GridRow {...rowProps(i)} testId={`missing-value-row-${i}`}>
                    <Cell span={2} v={['ctl']}>
                      <GlassFieldSingleSelect
                        value={item.field}
                        options={fieldCompletions}
                        columnTypes={columnTypes}
                        onChange={(col) => {
                          const methods = methodsForType(columnTypes[col]);
                          const methodOk = methods.some((m) => m.value === item.method);
                          updateRule(i, {
                            field: col,
                            method: methodOk ? item.method : (methods[0]?.value ?? 'skip'),
                          });
                        }}
                        placeholder={tr('fieldPicker.selectField')}
                        className="w-full"
                      />
                    </Cell>
                    <Cell v={['ctl', 'hl']}>
                      <GlassOptionSingleSelect
                        value={method}
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
                              title: methodTip(m.value),
                            })),
                          },
                        ]}
                        variant="highlight"
                        className="w-full"
                      />
                    </Cell>
                    {view.needsValue ? (
                      <Cell v={['ctl', Boolean(view.errorMessage) && 'err']}>
                        <GlassCommitTextInput
                          value={view.displayedValue}
                          ariaLabel={tr('missingValueHeader')}
                          ariaInvalid={Boolean(view.errorMessage)}
                          onDraftChange={(raw) =>
                            setValueDrafts((drafts) => ({ ...drafts, [view.draftKey]: raw }))
                          }
                          onCommit={(raw) => {
                            setValueDrafts((drafts) => {
                              const next = { ...drafts };
                              delete next[view.draftKey];
                              return next;
                            });
                            if (method === 'nullify_values') {
                              const vals = parseMissingValueListInput(raw, colType);
                              updateRule(i, { values: vals.length > 0 ? vals : undefined });
                            } else {
                              updateRule(i, { value: parseMissingValueInput(raw, colType) });
                            }
                          }}
                          placeholder={
                            method === 'nullify_values'
                              ? tr('missingSpecialValuesPlaceholder')
                              : tr('missingFillPlaceholder')
                          }
                        />
                      </Cell>
                    ) : (
                      <Cell v={['muted']}>{tr('missingNoValueNeeded')}</Cell>
                    )}
                    <RowActionsCell
                      labels={rowLabels}
                      onAdd={() => insertRule(i)}
                      onCopy={() => copyRule(i)}
                      onRemove={() => removeRule(i)}
                      dragHandle={dragHandle(i)}
                    />
                  </GridRow>
                  {view.errorMessage ? (
                    <ErrorRow span={5}>
                      <b>{tr('rowPrefix', { index: i + 1 })}</b>
                      {view.errorMessage}
                    </ErrorRow>
                  ) : null}
                </Fragment>
              );
            })}
            <AddRow
              span={5}
              label={tr('missingAddRule')}
              onClick={() => insertRule(activeRules.length - 1)}
            />
          </>
        )}
      </FormGrid>
    </FormScroll>
  );
}

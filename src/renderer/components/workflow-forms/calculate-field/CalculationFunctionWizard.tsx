import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isTemporalDataFieldType } from '../../../../shared/data-field-types';
import {
  calculationFunctionsByCategory,
  CALCULATION_FUNCTION_CATEGORIES,
  getCalculationFunction,
  MAX_CALCULATION_WINDOW_SIZE,
  usesTemporalCalculationRangeUnit,
  type CalculationFunctionCategory,
  type CalculationFunctionInput,
  type CalculationOrderField,
} from '../../../../shared/calculate-field/function-registry';
import {
  parseWindowFrameBound,
  type CalculationWindowFrame,
} from '../../../../shared/calculate-field/window-frame';
import { buildCalculationFunctionDslExpression } from '../../../../shared/calculate-field/domain-dsl';
import {
  CALCULATION_FRAME_BOUND_TYPES,
  CALCULATION_INTERVAL_UNITS,
  calculationFrameBoundType,
  defaultCalculationParameterValues,
  formatCalculationFrameBound,
  type CalculationFrameBoundType,
} from '../../../../shared/calculate-field/wizard-state';
import { AlertCircle, Check } from 'lucide-react';
import { useDragReorder } from '../../../hooks/useDragReorder';
import { GlassDirectionToggle } from '../shared/GlassDirectionToggle';
import { GlassFieldSingleSelect } from '../shared/GlassFieldSingleSelect';
import { GlassOptionMultiSelect } from '../shared/GlassOptionMultiSelect';
import { GlassFormTextInput } from '../shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from '../shared/GlassOptionSingleSelect';
import { GlassRowList } from '../shared/GlassRowList';
import { insertRowAfter, removeRowAt } from '../shared/rowListOperations';

interface CalculationFunctionWizardProps {
  fieldCompletions: string[];
  columnTypes?: Record<string, string>;
  initialInput?: CalculationFunctionInput;
  /** Formula currently in the editor (shown read-only at the top). */
  currentExpression: string;
  onInsertAtCursor: (expression: string) => void;
  onReplace: (expression: string) => void;
  footerOverride?: React.ReactNode;
  tr: (key: string, params?: Record<string, unknown>) => string;
}

const CATEGORY_LABEL_KEYS: Record<CalculationFunctionCategory, string> = {
  group_metrics: 'calcFieldScenarioGroupMetrics',
  ranking: 'calcFieldScenarioRanking',
  cumulative: 'calcFieldScenarioCumulative',
  offset: 'calcFieldScenarioOffset',
  moving_window: 'calcFieldScenarioMovingWindow',
  period_compare: 'calcFieldScenarioPeriodCompare',
  time_intelligence: 'calcFieldScenarioTimeIntel',
};

const START_BOUND_TYPES = CALCULATION_FRAME_BOUND_TYPES.filter(
  (value) => value !== 'unbounded following'
);
const END_BOUND_TYPES = CALCULATION_FRAME_BOUND_TYPES.filter(
  (value) => value !== 'unbounded preceding'
);

const BOUND_LABEL_KEYS: Record<CalculationFrameBoundType, string> = {
  'unbounded preceding': 'calcFieldUnboundedPre',
  preceding: 'calcFieldNPreRows',
  'current row': 'calcFieldCurrentRows',
  following: 'calcFieldNFollRows',
  'unbounded following': 'calcFieldUnboundedFoll',
};

export function CalculationFunctionWizard({
  fieldCompletions,
  columnTypes,
  initialInput,
  currentExpression,
  onInsertAtCursor,
  onReplace,
  footerOverride,
  tr,
}: CalculationFunctionWizardProps) {
  const initialDefinition = initialInput
    ? getCalculationFunction(initialInput.functionId)
    : undefined;
  const initialCategory = initialDefinition?.category ?? 'group_metrics';
  const initialFrame = initialInput?.frame;
  const initialStart = initialFrame ? parseWindowFrameBound(initialFrame.start) : undefined;
  const initialEnd = initialFrame ? parseWindowFrameBound(initialFrame.end) : undefined;
  const [category, setCategory] = useState<CalculationFunctionCategory>(initialCategory);
  const initialFunction = calculationFunctionsByCategory(category)[0];
  const [functionId, setFunctionId] = useState(initialDefinition?.id ?? initialFunction.id);
  const [value, setValue] = useState(initialInput?.value ?? '');
  const [extraParameter, setExtraParameter] = useState(initialInput?.extraParameter ?? '');
  const [parameterValues, setParameterValues] = useState<Record<string, string>>(
    initialInput?.parameters ?? {}
  );
  const [partitionBy, setPartitionBy] = useState<string[]>(initialInput?.partitionBy ?? []);
  const [orderBy, setOrderBy] = useState<CalculationOrderField[]>(initialInput?.orderBy ?? []);
  const [frameType, setFrameType] = useState<CalculationWindowFrame['type']>(
    initialFrame?.type ?? 'rows'
  );
  const [frameStartType, setFrameStartType] = useState<CalculationFrameBoundType>(
    calculationFrameBoundType(initialStart, 'preceding')
  );
  const [frameStartOffset, setFrameStartOffset] = useState(String(initialStart?.offset ?? 1));
  const [frameStartUnit, setFrameStartUnit] = useState(initialStart?.unit ?? 'day');
  const [frameEndType, setFrameEndType] = useState<CalculationFrameBoundType>(
    calculationFrameBoundType(initialEnd, 'current row')
  );
  const [frameEndOffset, setFrameEndOffset] = useState(String(initialEnd?.offset ?? 1));
  const [frameEndUnit, setFrameEndUnit] = useState(initialEnd?.unit ?? 'day');
  const [frameExclude, setFrameExclude] = useState<CalculationWindowFrame['exclude']>(
    initialFrame?.exclude ?? 'no others'
  );

  const definitions = useMemo(() => calculationFunctionsByCategory(category), [category]);
  const definition = definitions.find((item) => item.id === functionId) ?? definitions[0];
  const effectiveExtraParameter = extraParameter || definition.extraParameter?.defaultValue || '';
  const effectiveParameterValues = useMemo(
    () =>
      Object.fromEntries(
        (definition.parameters ?? []).map((parameter) => [
          parameter.key,
          parameterValues[parameter.key] ?? parameter.defaultValue ?? '',
        ])
      ),
    [definition.parameters, parameterValues]
  );
  const configuredOrderBy = orderBy.filter((item) => item.field.trim());
  const usesRangeOffset =
    frameType === 'range' &&
    (frameStartType === 'preceding' ||
      frameStartType === 'following' ||
      frameEndType === 'preceding' ||
      frameEndType === 'following');
  const configuredOrderType = columnTypes?.[configuredOrderBy[0]?.field];
  const importedFrameUsesTemporalUnit = Boolean(initialStart?.unit || initialEnd?.unit);
  const usesTemporalRangeUnit =
    usesRangeOffset &&
    (configuredOrderType
      ? usesTemporalCalculationRangeUnit(frameType, configuredOrderBy, columnTypes)
      : importedFrameUsesTemporalUnit);
  const frame = useMemo<CalculationWindowFrame | undefined>(() => {
    if (definition.frame !== 'custom') return undefined;
    return {
      type: frameType,
      start: formatCalculationFrameBound(
        frameStartType,
        frameStartOffset,
        usesTemporalRangeUnit,
        frameStartUnit
      ),
      end: formatCalculationFrameBound(
        frameEndType,
        frameEndOffset,
        usesTemporalRangeUnit,
        frameEndUnit
      ),
      exclude: frameExclude,
    };
  }, [
    definition.frame,
    frameEndOffset,
    frameEndType,
    frameEndUnit,
    frameExclude,
    frameStartOffset,
    frameStartType,
    frameStartUnit,
    frameType,
    usesTemporalRangeUnit,
  ]);

  // Per-field validation errors — rendered as red icons on the owning control
  // rows instead of a single message in the preview footer.
  const fieldErrors = useMemo<Record<string, string>>(() => {
    const errors: Record<string, string> = {};
    if (definition.valueArgument !== 'none' && !value.trim()) {
      errors.value = tr('calcFieldErrValueRequired');
    }
    if (definition.order === 'required' && configuredOrderBy.length === 0) {
      errors.order = tr('calcFieldErrOrderRequired');
    }
    const extra = definition.extraParameter;
    if (extra && extra.kind !== 'text') {
      const raw = effectiveExtraParameter.trim();
      const name = tr(extra.labelKey);
      if (!/^\d+(?:\.\d+)?$/.test(raw)) {
        errors.extra = tr('calcFieldErrParamNumeric', { name });
      } else {
        const parsed = Number(raw);
        if (
          !Number.isFinite(parsed) ||
          (extra.kind === 'integer' && !Number.isSafeInteger(parsed)) ||
          (extra.min !== undefined && parsed < extra.min) ||
          (extra.max !== undefined && parsed > extra.max)
        ) {
          errors.extra = tr('calcFieldErrParamRange', { name });
        }
      }
    }
    for (const parameter of definition.parameters ?? []) {
      const raw = (effectiveParameterValues[parameter.key] ?? '').trim();
      const name = tr(parameter.labelKey);
      if (parameter.kind === 'temporal-field' && !raw) {
        errors[`param.${parameter.key}`] = tr('calcFieldErrParamRequired', { name });
      }
      if (parameter.kind === 'integer') {
        if (!/^\d+$/.test(raw)) {
          errors[`param.${parameter.key}`] = tr('calcFieldErrParamInteger', { name });
        } else {
          const parsed = Number(raw);
          if (
            !Number.isSafeInteger(parsed) ||
            parsed < (parameter.min ?? 1) ||
            parsed > (parameter.max ?? MAX_CALCULATION_WINDOW_SIZE)
          ) {
            errors[`param.${parameter.key}`] = tr('calcFieldErrParamRange', { name });
          }
        }
      }
    }
    if (usesRangeOffset && configuredOrderBy.length !== 1) {
      errors.order ??= tr('calcFieldErrRangeNeedsOrder');
    }
    if (
      definition.category === 'time_intelligence' &&
      value.trim() === '*' &&
      effectiveParameterValues.aggregation !== 'count'
    ) {
      errors['param.aggregation'] ??= tr('calcFieldErrTimeAggStar');
    }
    return errors;
  }, [
    configuredOrderBy.length,
    definition,
    effectiveExtraParameter,
    effectiveParameterValues,
    tr,
    usesRangeOffset,
    value,
  ]);

  const preview = useMemo(() => {
    if (Object.keys(fieldErrors).length > 0) {
      return { expression: '', error: '' };
    }
    try {
      return {
        expression: buildCalculationFunctionDslExpression({
          functionId: definition.id,
          value,
          extraParameter: effectiveExtraParameter,
          partitionBy,
          orderBy,
          frame,
          parameters: effectiveParameterValues,
        }),
        error: '',
      };
    } catch {
      return { expression: '', error: tr('calcFieldErrInvalidConfig') };
    }
  }, [
    definition,
    effectiveExtraParameter,
    effectiveParameterValues,
    fieldErrors,
    frame,
    orderBy,
    partitionBy,
    tr,
    value,
  ]);

  function selectCategory(nextCategory: CalculationFunctionCategory): void {
    const [firstDefinition] = calculationFunctionsByCategory(nextCategory);
    setCategory(nextCategory);
    setFunctionId(firstDefinition.id);
    setExtraParameter(firstDefinition.extraParameter?.defaultValue ?? '');
    setParameterValues(defaultCalculationParameterValues(firstDefinition.parameters));
  }

  function selectFunction(nextFunctionId: string): void {
    const nextDefinition = definitions.find((item) => item.id === nextFunctionId);
    setFunctionId(nextFunctionId);
    setExtraParameter(nextDefinition?.extraParameter?.defaultValue ?? '');
    setParameterValues(defaultCalculationParameterValues(nextDefinition?.parameters));
  }

  const allowsStar =
    definition.valueArgument === 'field-or-star' &&
    (definition.category !== 'time_intelligence' ||
      effectiveParameterValues.aggregation === 'count');
  const valueOptions = allowsStar ? ['*', ...fieldCompletions] : fieldCompletions;

  const editableOrderBy = useMemo<CalculationOrderField[]>(
    () => (orderBy.length > 0 ? orderBy : [{ field: '', direction: 'asc' }]),
    [orderBy]
  );
  const {
    activeItems: activeOrderBy,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleKeyboardMove,
    isDragging,
    dragIndexRef,
  } = useDragReorder(editableOrderBy, setOrderBy);

  function updateOrderField(index: number, patch: Partial<CalculationOrderField>): void {
    setOrderBy(activeOrderBy.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function addOrderField(index: number): void {
    if (activeOrderBy.some((item) => !item.field)) return;
    setOrderBy(insertRowAfter(activeOrderBy, index, { field: '', direction: 'asc' }));
  }

  function removeOrderField(index: number): void {
    setOrderBy(removeRowAt(activeOrderBy, index));
  }

  const hasSpecialConfig = definition.frame === 'custom';
  // Column types load asynchronously; when unknown, don't filter every field out.
  const columnTypesKnown = columnTypes != null && Object.keys(columnTypes).length > 0;
  const temporalFields = columnTypesKnown
    ? fieldCompletions.filter((field) => isTemporalDataFieldType(columnTypes[field]))
    : fieldCompletions;
  const showNoTemporalFieldHint = columnTypesKnown && temporalFields.length === 0;

  const basicRows = (
    <>
      {definition.valueArgument !== 'none' && (
        <FormRow label={tr('calcFieldValueLabel')} required>
          <FieldError error={fieldErrors.value}>
            <GlassFieldSingleSelect
              value={value}
              options={valueOptions}
              columnTypes={columnTypes}
              onChange={setValue}
              placeholder={tr('expressionFunctionArgumentPlaceholder')}
              className="h-8 w-full"
            />
          </FieldError>
        </FormRow>
      )}

      {definition.extraParameter && (
        <FormRow label={tr(definition.extraParameter.labelKey)}>
          <FieldError error={fieldErrors.extra}>
            <GlassFormTextInput
              inputMode={definition.extraParameter.kind === 'text' ? undefined : 'numeric'}
              value={effectiveExtraParameter}
              onChange={setExtraParameter}
              className="h-8 w-full rounded-md px-2 text-[12px]"
            />
          </FieldError>
        </FormRow>
      )}

      {definition.parameters?.map((parameter) => (
        <FormRow key={parameter.key} label={tr(parameter.labelKey)}>
          <FieldError
            error={
              parameter.kind === 'temporal-field' && showNoTemporalFieldHint
                ? `${fieldErrors[`param.${parameter.key}`] ?? ''}\n${tr('calcFieldNoTemporalField')}`.trim()
                : fieldErrors[`param.${parameter.key}`]
            }
          >
            {parameter.kind === 'temporal-field' ? (
              <GlassFieldSingleSelect
                value={effectiveParameterValues[parameter.key]}
                options={temporalFields}
                columnTypes={columnTypes}
                onChange={(nextValue) =>
                  setParameterValues((current) => ({
                    ...current,
                    [parameter.key]: nextValue,
                  }))
                }
                placeholder={tr('expressionFunctionArgumentPlaceholder')}
                className="h-8 w-full"
              />
            ) : parameter.kind === 'option' ? (
              <GlassOptionSingleSelect
                value={effectiveParameterValues[parameter.key]}
                groups={[
                  {
                    key: parameter.key,
                    items: (parameter.options ?? []).map((option) => ({
                      value: option.value,
                      label: tr(option.labelKey),
                    })),
                  },
                ]}
                onChange={(nextValue) =>
                  setParameterValues((current) => ({
                    ...current,
                    [parameter.key]: nextValue,
                  }))
                }
                className="h-8 w-full text-[12px]"
              />
            ) : (
              <GlassFormTextInput
                inputMode="numeric"
                value={effectiveParameterValues[parameter.key]}
                onChange={(nextValue) =>
                  setParameterValues((current) => ({
                    ...current,
                    [parameter.key]: nextValue,
                  }))
                }
                className="h-8 w-full rounded-md px-2 text-[12px]"
              />
            )}
          </FieldError>
        </FormRow>
      ))}
    </>
  );

  const fieldRows = (
    <>
      <FormRow label={tr('calcFieldPartitionBy')} variant="chips">
        <GlassOptionMultiSelect
          options={fieldCompletions}
          selected={partitionBy}
          onChange={setPartitionBy}
          onClear={() => setPartitionBy([])}
          optionTypes={columnTypes}
          maxHeight="240px"
          placeholder={tr('noFieldsSelected')}
        />
      </FormRow>

      <FormRow label={tr('calcFieldOrderBy')} variant="text">
        <FieldError error={fieldErrors.order}>
          {definition.order === 'required' ? (
            <GlassRowList
              hideHeader
              rowPaddingClassName="px-0"
              items={activeOrderBy}
              columns={[
                {
                  flex: 'flex-[3]',
                  header: tr('sortKeys.sortFieldHeader'),
                  render: (item, index) => {
                    const disabledOptions = new Set(
                      activeOrderBy.map((entry) => entry.field).filter(Boolean)
                    );
                    disabledOptions.delete(item.field);
                    return (
                      <GlassFieldSingleSelect
                        value={item.field}
                        options={fieldCompletions}
                        columnTypes={columnTypes}
                        disabledOptions={disabledOptions}
                        onChange={(field) => updateOrderField(index, { field })}
                        placeholder={tr('expressionFunctionArgumentPlaceholder')}
                        className="w-full"
                      />
                    );
                  },
                },
                {
                  flex: 'flex-[1.4]',
                  header: tr('sortKeys.sortDirectionHeader'),
                  render: (item, index) => (
                    <GlassDirectionToggle
                      value={item.direction}
                      onChange={(direction) => updateOrderField(index, { direction })}
                      className="h-6 w-full px-1 text-[11px]"
                    />
                  ),
                },
              ]}
              onAdd={addOrderField}
              onRemove={removeOrderField}
              addTitle={tr('sortKeys.sortAddKey')}
              removeTitle={tr('sortKeys.sortRemoveKey')}
              canAct={(action) =>
                action !== 'add' ||
                (!(definition.frame === 'custom' && usesRangeOffset) &&
                  !activeOrderBy.some((item) => !item.field) &&
                  activeOrderBy.length < fieldCompletions.length)
              }
              draggable
              dragHandlePosition="end"
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onKeyboardMove={handleKeyboardMove}
              getRowOpacity={(index) => !!(isDragging && dragIndexRef.current === index)}
              getDropMarker={(index) =>
                isDragging && dragIndexRef.current === index ? 'before' : null
              }
              dragTitle={tr('rowList.dragToReorder')}
            />
          ) : (
            <span className="text-[12.5px] text-text-muted">{tr('calcFieldOrderNotRequired')}</span>
          )}
        </FieldError>
      </FormRow>
    </>
  );

  const listRow =
    'flex h-8 w-full shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30';
  const paneHeader =
    'flex h-[30px] shrink-0 items-center border-b border-border-subtle bg-background-secondary px-3 text-[11.5px] font-medium text-text-muted';
  const cellBorder = 'border-b border-border-subtle';

  return (
    <>
      <div
        key="wiz-current-label"
        className={`flex items-center bg-background-secondary px-3 text-[12px] font-medium text-text-secondary ${cellBorder} border-r`}
      >
        {tr('calcFieldCurrentFormula')}
      </div>
      <div
        key="wiz-current"
        style={{ gridColumn: 'span 6' }}
        className={`flex min-w-0 items-center px-3 ${cellBorder}`}
      >
        {currentExpression.trim() ? (
          <FormulaText text={currentExpression} />
        ) : (
          <span className="text-[12.5px] text-text-muted">
            {tr('calcFieldCurrentFormulaEmpty')}
          </span>
        )}
      </div>

      <div
        key="wiz-categories"
        className={`flex min-h-0 flex-col border-r border-border-subtle ${cellBorder}`}
      >
        <div className={paneHeader}>{tr('calcFieldCategoryHeader')}</div>
        <div
          role="listbox"
          aria-label={tr('calcFieldCategoryHeader')}
          className="fx-list min-h-0 flex-1"
        >
          {CALCULATION_FUNCTION_CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={item === category}
              onClick={() => selectCategory(item)}
              className={`${listRow} ${
                item === category
                  ? 'bg-accent-muted text-accent'
                  : 'text-text-primary hover:bg-surface-hover'
              }`}
            >
              {tr(CATEGORY_LABEL_KEYS[item])}
            </button>
          ))}
        </div>
      </div>
      <div
        key="wiz-functions"
        className={`flex min-h-0 flex-col border-r border-border-subtle ${cellBorder}`}
      >
        <div className={paneHeader}>{tr('calcFieldFunctionHeader')}</div>
        <div
          role="listbox"
          aria-label={tr('calcFieldFunctionHeader')}
          className="fx-list min-h-0 flex-1"
        >
          {definitions.map((item) => {
            const selected = item.id === definition.id;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectFunction(item.id)}
                className={`${listRow} ${
                  selected
                    ? 'bg-accent-muted text-accent'
                    : 'text-text-primary hover:bg-surface-hover'
                }`}
              >
                <span className="min-w-0 truncate">{tr(item.labelKey)}</span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
              </button>
            );
          })}
        </div>
      </div>
      <div
        key="wiz-params"
        style={{ gridColumn: 'span 5' }}
        className={`flex min-h-0 flex-col ${cellBorder}`}
      >
        <div className={paneHeader}>{tr('calcFieldParamsHeader')}</div>
        <div className="opg fx-list min-h-0 flex-1 grid-cols-[104px_minmax(0,1fr)]">
          {basicRows}
          {fieldRows}
          {hasSpecialConfig && (
            <FrameEditor
              frameType={frameType}
              setFrameType={setFrameType}
              startType={frameStartType}
              setStartType={setFrameStartType}
              startOffset={frameStartOffset}
              setStartOffset={setFrameStartOffset}
              startUnit={frameStartUnit}
              setStartUnit={setFrameStartUnit}
              endType={frameEndType}
              setEndType={setFrameEndType}
              endOffset={frameEndOffset}
              setEndOffset={setFrameEndOffset}
              endUnit={frameEndUnit}
              setEndUnit={setFrameEndUnit}
              exclude={frameExclude}
              setExclude={setFrameExclude}
              usesTemporalRangeUnit={usesTemporalRangeUnit}
              tr={tr}
            />
          )}
          <FormRow label={tr('calcFieldGeneratedFormula')} variant="text">
            {preview.expression ? (
              <FormulaText text={preview.expression} />
            ) : (
              <span className="text-[12.5px] text-error">
                {preview.error || tr('calcFieldGeneratedFormulaIncomplete')}
              </span>
            )}
          </FormRow>
        </div>
      </div>

      {footerOverride ?? (
        <>
          <div
            key="wiz-hint"
            style={{ gridColumn: 'span 4' }}
            className="flex items-center px-3 text-[12px] text-text-muted"
          >
            {tr('calcFieldWizardFooterHint')}
          </div>
          <button
            key="wiz-insert"
            type="button"
            disabled={!preview.expression}
            onClick={() => onInsertAtCursor(preview.expression)}
            className="flex items-center justify-center border-l border-border-subtle bg-surface text-[12.5px] font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {tr('calcFieldInsertAtCursor')}
          </button>
          <button
            key="wiz-replace"
            type="button"
            disabled={!preview.expression}
            onClick={() => onReplace(preview.expression)}
            style={{ gridColumn: 'span 2' }}
            className="flex items-center justify-center bg-accent text-[12.5px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {tr('calcFieldReplaceFormula')}
          </button>
        </>
      )}
    </>
  );
}

/** Read-only formula with the editor's token palette. */
function FormulaText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]*\]|'[^']*'|\b[A-Za-z_][A-Za-z0-9_]*\b|\d+(?:\.\d+)?)/g);
  return (
    <code
      className="min-w-0 truncate whitespace-pre font-mono text-[12.5px] text-text-primary"
      title={text}
    >
      {parts.map((part, i) => {
        if (!part) return null;
        let cls = '';
        if (part.startsWith('[')) cls = 'text-[#2563eb]';
        else if (part.startsWith("'")) cls = 'text-[#b45309]';
        else if (/^\d/.test(part)) cls = 'text-[#7c3aed]';
        else if (/^[A-Za-z_]/.test(part)) {
          const next = text.slice(parts.slice(0, i + 1).join('').length).trimStart();
          cls = next.startsWith('(')
            ? 'font-semibold text-[#7c3aed]'
            : 'font-semibold text-[#1e1b4b]';
        }
        return (
          <span key={i} className={cls}>
            {part}
          </span>
        );
      })}
    </code>
  );
}

/** One flush parameter row on the shared operator grid: 104px label + cell. */
function FormRow({
  label,
  required,
  variant = 'ctl',
  error,
  children,
}: {
  label: string;
  required?: boolean;
  variant?: 'ctl' | 'chips' | 'text';
  error?: boolean;
  children: React.ReactNode;
}) {
  const cellClass =
    variant === 'text'
      ? 'opg-c wrap py-1.5'
      : `opg-c ctl${variant === 'chips' ? ' chips' : ''}${error ? ' err' : ''}`;
  return (
    <>
      <div className="opg-c lab" style={{ minHeight: 44 }}>
        <span className="truncate">{label}</span>
        {required && <span className="req">*</span>}
      </div>
      <div className={cellClass} style={{ minHeight: 44 }}>
        {children}
      </div>
    </>
  );
}

const FIELD_ERROR_TOOLTIP_WIDTH = 224;

// The tooltip is portaled to document.body with fixed positioning — an
// absolutely-positioned tooltip inside the scrollable form area gets clipped
// by the container's overflow and collapses to the icon's width.
function FieldError({ error, children }: { error?: string; children: React.ReactNode }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<{ top: number; left: number } | null>(null);

  function showTooltip(): void {
    const rect = iconRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fitsBelow = rect.bottom + 96 < window.innerHeight;
    setTooltipStyle({
      left: Math.max(8, rect.right - FIELD_ERROR_TOOLTIP_WIDTH),
      top: fitsBelow ? rect.bottom + 6 : Math.max(8, rect.top - 96),
    });
  }

  return (
    <>
      {children}
      {error && (
        <>
          <span
            ref={iconRef}
            style={{ flex: '0 0 32px' }}
            className="inline-flex items-center justify-center"
            onMouseEnter={showTooltip}
            onMouseLeave={() => setTooltipStyle(null)}
          >
            <AlertCircle className="h-4 w-4 text-error" />
          </span>
          {tooltipStyle &&
            createPortal(
              <div
                role="tooltip"
                style={{
                  top: tooltipStyle.top,
                  left: tooltipStyle.left,
                  width: FIELD_ERROR_TOOLTIP_WIDTH,
                }}
                className="fixed z-[10000] whitespace-pre-line rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-[12px] leading-5 text-error shadow-elevated"
              >
                {error}
              </div>,
              document.body
            )}
        </>
      )}
    </>
  );
}

interface FrameEditorProps {
  frameType: CalculationWindowFrame['type'];
  setFrameType: (value: CalculationWindowFrame['type']) => void;
  startType: CalculationFrameBoundType;
  setStartType: (value: CalculationFrameBoundType) => void;
  startOffset: string;
  setStartOffset: (value: string) => void;
  startUnit: string;
  setStartUnit: (value: string) => void;
  endType: CalculationFrameBoundType;
  setEndType: (value: CalculationFrameBoundType) => void;
  endOffset: string;
  setEndOffset: (value: string) => void;
  endUnit: string;
  setEndUnit: (value: string) => void;
  exclude: CalculationWindowFrame['exclude'];
  setExclude: (value: CalculationWindowFrame['exclude']) => void;
  usesTemporalRangeUnit: boolean;
  tr: (key: string) => string;
}

function FrameEditor(props: FrameEditorProps) {
  const typeOptions = ['rows', 'range', 'groups'].map((value) => ({
    value,
    label: trFrameType(value, props.tr),
  }));
  return (
    <>
      <FormRow label={props.tr('calcFieldFrameType')}>
        <GlassOptionSingleSelect
          value={props.frameType}
          groups={[{ key: 'frameType', items: typeOptions }]}
          onChange={(value) => props.setFrameType(value as CalculationWindowFrame['type'])}
          className="h-8 w-full text-[12px]"
        />
      </FormRow>
      <BoundEditor
        label={props.tr('calcFieldBoundStart')}
        options={START_BOUND_TYPES}
        type={props.startType}
        setType={props.setStartType}
        offset={props.startOffset}
        setOffset={props.setStartOffset}
        unit={props.startUnit}
        setUnit={props.setStartUnit}
        usesTemporalRangeUnit={props.usesTemporalRangeUnit}
        tr={props.tr}
      />
      <BoundEditor
        label={props.tr('calcFieldBoundEnd')}
        options={END_BOUND_TYPES}
        type={props.endType}
        setType={props.setEndType}
        offset={props.endOffset}
        setOffset={props.setEndOffset}
        unit={props.endUnit}
        setUnit={props.setEndUnit}
        usesTemporalRangeUnit={props.usesTemporalRangeUnit}
        tr={props.tr}
      />
      <FormRow label={props.tr('calcFieldFrameExclude')}>
        <GlassOptionSingleSelect
          value={props.exclude ?? 'no others'}
          groups={[
            {
              key: 'exclude',
              items: [
                { value: 'no others', label: props.tr('calcFieldFrameExcludeNone') },
                { value: 'current row', label: props.tr('calcFieldFrameExcludeCurrent') },
                { value: 'group', label: props.tr('calcFieldFrameExcludeGroup') },
                { value: 'ties', label: props.tr('calcFieldFrameExcludeTies') },
              ],
            },
          ]}
          onChange={(value) => props.setExclude(value as CalculationWindowFrame['exclude'])}
          className="h-8 w-full text-[12px]"
        />
      </FormRow>
    </>
  );
}

interface BoundEditorProps {
  label: string;
  options: CalculationFrameBoundType[];
  type: CalculationFrameBoundType;
  setType: (value: CalculationFrameBoundType) => void;
  offset: string;
  setOffset: (value: string) => void;
  unit: string;
  setUnit: (value: string) => void;
  usesTemporalRangeUnit: boolean;
  tr: (key: string) => string;
}

function BoundEditor(props: BoundEditorProps) {
  const needsOffset = props.type === 'preceding' || props.type === 'following';
  return (
    <FormRow label={props.label} variant="text">
      <div className="flex gap-2">
        <GlassOptionSingleSelect
          value={props.type}
          groups={[
            {
              key: 'bound',
              items: props.options.map((value) => ({
                value,
                label: props.tr(BOUND_LABEL_KEYS[value]),
              })),
            },
          ]}
          onChange={(value) => props.setType(value as CalculationFrameBoundType)}
          className="h-8 min-w-0 flex-1 text-[12px]"
        />
        {needsOffset && (
          <GlassFormTextInput
            inputMode="numeric"
            value={props.offset}
            onChange={props.setOffset}
            className="h-8 w-16 rounded-md px-1 text-center text-[12px]"
          />
        )}
        {needsOffset && props.usesTemporalRangeUnit && (
          <GlassOptionSingleSelect
            value={props.unit}
            groups={[
              {
                key: 'unit',
                items: CALCULATION_INTERVAL_UNITS.map((value) => ({ value, label: value })),
              },
            ]}
            onChange={props.setUnit}
            className="h-8 w-20 text-[12px]"
          />
        )}
      </div>
    </FormRow>
  );
}

function trFrameType(value: string, tr: (key: string) => string): string {
  if (value === 'range') return tr('calcFieldFrameRange');
  if (value === 'groups') return tr('calcFieldFrameGroups');
  return tr('calcFieldFrameRows');
}

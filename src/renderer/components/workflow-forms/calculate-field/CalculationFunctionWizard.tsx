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
import { Button } from '../../ui/button';
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
  onInsert: (expression: string) => void;
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

type WizardStep = 'basic' | 'fields' | 'window' | 'preview';

const WIZARD_STEP_LABEL_KEYS: Record<WizardStep, string> = {
  basic: 'calcFieldBasicConfig',
  fields: 'calcFieldFieldConfig',
  window: 'calcFieldSpecialConfig',
  preview: 'calcFieldExpressionPreview',
};

export function CalculationFunctionWizard({
  fieldCompletions,
  columnTypes,
  initialInput,
  onInsert,
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
  const [stepIndex, setStepIndex] = useState(0);

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
    setStepIndex(0);
  }

  function selectFunction(nextFunctionId: string): void {
    const nextDefinition = definitions.find((item) => item.id === nextFunctionId);
    setFunctionId(nextFunctionId);
    setExtraParameter(nextDefinition?.extraParameter?.defaultValue ?? '');
    setParameterValues(defaultCalculationParameterValues(nextDefinition?.parameters));
    setStepIndex(0);
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
  const hasBasicConfig =
    definition.valueArgument !== 'none' ||
    !!definition.extraParameter ||
    (definition.parameters?.length ?? 0) > 0;
  // Column types load asynchronously; when unknown, don't filter every field out.
  const columnTypesKnown = columnTypes != null && Object.keys(columnTypes).length > 0;
  const temporalFields = columnTypesKnown
    ? fieldCompletions.filter((field) => isTemporalDataFieldType(columnTypes[field]))
    : fieldCompletions;
  const showNoTemporalFieldHint = columnTypesKnown && temporalFields.length === 0;

  const steps = useMemo<WizardStep[]>(
    () =>
      hasSpecialConfig ? ['basic', 'fields', 'window', 'preview'] : ['basic', 'fields', 'preview'],
    [hasSpecialConfig]
  );
  const currentStepIndex = Math.min(stepIndex, steps.length - 1);
  const activeStep = steps[currentStepIndex];

  const basicRows = (
    <>
      {definition.valueArgument !== 'none' && (
        <FormRow label={tr('expression.expressionFunctionArgument')}>
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
      <FormRow label={tr('calcFieldPartitionBy')}>
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

      <FormRow label={tr('calcFieldOrderBy')}>
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
              dragTitle={tr('rowList.dragToReorder')}
            />
          ) : (
            <div className="rounded-md bg-surface px-3 py-2 text-[11px] text-text-muted">
              {tr('calcFieldOrderNotRequired')}
            </div>
          )}
        </FieldError>
      </FormRow>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border-muted/60">
      <div className="flex w-[17.5rem] shrink-0 border-r border-border-muted/60">
        <div
          role="listbox"
          aria-label={tr('calcFieldOpenWizard')}
          className="scrollbar-hover w-28 shrink-0 overflow-y-auto border-r border-border-muted/60 py-1.5"
        >
          {CALCULATION_FUNCTION_CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => selectCategory(item)}
              className={`flex w-full items-center px-3 py-2 text-left text-[12px] transition-colors ${
                item === category
                  ? 'bg-accent-muted font-medium text-accent'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
            >
              {tr(CATEGORY_LABEL_KEYS[item])}
            </button>
          ))}
        </div>
        <div className="scrollbar-hover min-w-0 flex-1 overflow-y-auto p-2">
          <div className="flex flex-col gap-1.5">
            {definitions.map((item) => {
              const selected = item.id === definition.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectFunction(item.id)}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-[12px] transition-colors ${
                    selected
                      ? 'border-accent/40 bg-accent-muted font-medium text-accent'
                      : 'border-border-muted/60 bg-surface text-text-secondary hover:border-accent/30 hover:bg-accent-muted/50 hover:text-text-primary'
                  }`}
                >
                  <span className="min-w-0 truncate">{tr(item.labelKey)}</span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="scrollbar-hover min-h-0 flex-1 overflow-y-auto">
          {!hasSpecialConfig && (
            <section className="flex flex-col gap-3 px-4 py-3">
              {basicRows}
              {hasBasicConfig && <div className="border-t border-border-muted/60" />}
              {fieldRows}
            </section>
          )}
          {hasSpecialConfig && activeStep === 'basic' && (
            <section className="flex max-w-[34rem] flex-col gap-3 px-4 py-3">{basicRows}</section>
          )}

          {hasSpecialConfig && activeStep === 'fields' && (
            <section className="flex min-w-0 flex-col gap-4 px-4 py-3">{fieldRows}</section>
          )}

          {hasSpecialConfig && activeStep === 'window' && (
            <section className="flex max-w-[34rem] flex-col gap-3 px-4 py-3">
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
            </section>
          )}

          {hasSpecialConfig && activeStep === 'preview' && (
            <section className="flex h-full flex-col p-4">
              <pre
                className={`scrollbar-hover min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface p-3 font-mono text-[12px] leading-6 ${
                  preview.error ? 'text-error' : 'text-text-secondary'
                }`}
              >
                {preview.error || preview.expression}
              </pre>
            </section>
          )}
        </div>

        {!hasSpecialConfig ? (
          <div className="flex items-end gap-3 border-t border-border-muted/60 bg-surface px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[10px] font-medium text-text-muted">
                {tr('calcFieldExpressionPreview')}
              </div>
              <pre
                className={`scrollbar-hover max-h-20 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 ${
                  preview.error ? 'text-error' : 'text-text-secondary'
                }`}
              >
                {preview.error || preview.expression}
              </pre>
            </div>
            <button
              type="button"
              disabled={!preview.expression}
              onClick={() => onInsert(preview.expression)}
              className="h-8 shrink-0 rounded-md bg-accent px-3 text-[12px] text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {tr('calcFieldInsertExpression')}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 border-t border-border-muted/60 bg-surface px-3 py-2">
            <div className="flex min-w-0 items-center" role="list">
              {steps.map((step, index) => (
                <WizardStepArrow
                  key={step}
                  index={index}
                  label={tr(WIZARD_STEP_LABEL_KEYS[step])}
                  active={index === currentStepIndex}
                  first={index === 0}
                  last={index === steps.length - 1}
                  onClick={() => setStepIndex(index)}
                />
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {currentStepIndex > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setStepIndex(currentStepIndex - 1)}
                >
                  {tr('calcFieldStepPrev')}
                </Button>
              )}
              {activeStep === 'preview' ? (
                <button
                  type="button"
                  disabled={!preview.expression}
                  onClick={() => onInsert(preview.expression)}
                  className="h-8 shrink-0 rounded-md bg-accent px-3 text-[12px] text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {tr('calcFieldInsertExpression')}
                </button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="border-accent/30 text-accent"
                  onClick={() => setStepIndex(currentStepIndex + 1)}
                >
                  {tr('calcFieldStepNext')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WizardStepArrow({
  label,
  index,
  active,
  first,
  last,
  onClick,
}: {
  label: string;
  index: number;
  active: boolean;
  first: boolean;
  last: boolean;
  onClick: () => void;
}) {
  const clipPath = last
    ? 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 10px 50%)'
    : first
      ? 'polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%)'
      : 'polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ clipPath }}
      className={`flex h-7 shrink-0 items-center text-[11px] font-medium transition-colors ${
        first ? 'pl-3' : 'pl-4'
      } ${last ? 'pr-3' : 'pr-5'} ${
        active
          ? 'bg-accent text-accent-foreground'
          : 'bg-surface-active/60 text-text-muted hover:text-text-secondary'
      }`}
    >
      {index + 1} {label}
    </button>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-4">
      <div className="pt-[7px] text-[12px] font-medium text-text-secondary">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
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
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">{children}</div>
      {error && (
        <>
          <span
            ref={iconRef}
            className="inline-flex shrink-0"
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
    </div>
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
    <FormRow label={props.label}>
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

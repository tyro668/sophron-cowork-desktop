import { useMemo, useState } from 'react';
import { isTemporalDataFieldType } from '../../../../shared/data-field-types';
import {
  calculationFunctionsByCategory,
  CALCULATION_FUNCTION_CATEGORIES,
  getCalculationFunction,
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
import { useDragReorder } from '../../../hooks/useDragReorder';
import { GlassDirectionToggle } from '../shared/GlassDirectionToggle';
import { GlassFieldSingleSelect } from '../shared/GlassFieldSingleSelect';
import { GlassFieldTagPicker } from '../shared/GlassFieldTagPicker';
import { GlassFormTextInput } from '../shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from '../shared/GlassOptionSingleSelect';
import { GlassRowList } from '../shared/GlassRowList';
import { insertRowAfter, removeRowAt } from '../shared/rowListOperations';

interface CalculationFunctionWizardProps {
  fieldCompletions: string[];
  columnTypes?: Record<string, string>;
  initialInput?: CalculationFunctionInput;
  onInsert: (expression: string) => void;
  tr: (key: string) => string;
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
  const [partitionOpen, setPartitionOpen] = useState(true);
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

  const preview = useMemo(() => {
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
    } catch (error) {
      return {
        expression: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [
    definition.id,
    effectiveExtraParameter,
    effectiveParameterValues,
    frame,
    orderBy,
    partitionBy,
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
  const temporalFields = fieldCompletions.filter((field) =>
    isTemporalDataFieldType(columnTypes?.[field])
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-muted/60">
        <div
          role="tablist"
          aria-label={tr('calcFieldOpenWizard')}
          className="flex shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-border-muted/60 bg-surface px-2"
        >
          {CALCULATION_FUNCTION_CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={item === category}
              onClick={() => selectCategory(item)}
              className={`h-8 shrink-0 border-b-2 px-3 text-[12px] outline-none transition-colors focus-visible:bg-accent-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 ${
                item === category
                  ? 'border-accent font-medium text-accent'
                  : 'border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
            >
              {tr(CATEGORY_LABEL_KEYS[item])}
            </button>
          ))}
        </div>

        <div className="scrollbar-hover min-h-0 flex-1 overflow-y-auto pr-1">
          <section className="p-3">
            <SectionTitle>{tr('calcFieldBasicConfig')}</SectionTitle>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <WizardLabel text={tr('calcFieldFunction')}>
                <GlassOptionSingleSelect
                  value={definition.id}
                  groups={[
                    {
                      key: category,
                      items: definitions.map((item) => ({
                        value: item.id,
                        label: tr(item.labelKey),
                      })),
                    },
                  ]}
                  onChange={selectFunction}
                  className="h-8 w-full text-[12px]"
                />
              </WizardLabel>

              {definition.valueArgument !== 'none' && (
                <WizardLabel text={tr('expression.expressionFunctionArgument')}>
                  <GlassFieldSingleSelect
                    value={value}
                    options={valueOptions}
                    columnTypes={columnTypes}
                    onChange={setValue}
                    placeholder={tr('expressionFunctionArgumentPlaceholder')}
                    className="h-8 w-full"
                  />
                </WizardLabel>
              )}

              {definition.extraParameter && (
                <WizardLabel text={tr(definition.extraParameter.labelKey)}>
                  <GlassFormTextInput
                    inputMode={definition.extraParameter.kind === 'text' ? undefined : 'numeric'}
                    value={effectiveExtraParameter}
                    onChange={setExtraParameter}
                    className="h-8 w-full rounded-md px-2 text-[12px]"
                  />
                </WizardLabel>
              )}

              {definition.parameters?.map((parameter) => (
                <WizardLabel key={parameter.key} text={tr(parameter.labelKey)}>
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
                </WizardLabel>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 border-t border-border-muted/60 md:grid-cols-[minmax(0,1.35fr)_minmax(15rem,0.65fr)]">
            <section className="flex min-w-0 flex-col gap-3 p-3">
              <SectionTitle>{tr('calcFieldFieldConfig')}</SectionTitle>
              <div className="flex min-h-0 flex-col gap-1.5">
                <span className="text-[11px] font-medium text-text-muted">
                  {tr('calcFieldPartitionBy')}
                </span>
                <GlassFieldTagPicker
                  columns={fieldCompletions}
                  selected={partitionBy}
                  onChange={setPartitionBy}
                  onRemove={(field) =>
                    setPartitionBy((current) => current.filter((item) => item !== field))
                  }
                  onClear={() => setPartitionBy([])}
                  open={partitionOpen}
                  onToggle={() => setPartitionOpen((current) => !current)}
                  columnTypes={columnTypes}
                  maxHeight="132px"
                  variant="flat"
                  placeholder={tr('noFieldsSelected')}
                />
              </div>

              <div className="border-t border-border-muted/60 pt-3">
                <div className="mb-1.5 text-[11px] font-medium text-text-muted">
                  {tr('calcFieldOrderBy')}
                </div>
                {definition.order === 'required' ? (
                  <GlassRowList
                    headerClassName=""
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
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    onKeyboardMove={handleKeyboardMove}
                    getRowOpacity={(index) => !!(isDragging && dragIndexRef.current === index)}
                    dragTitle={tr('rowList.dragToReorder')}
                  />
                ) : (
                  <div className="rounded-md bg-surface p-2 text-[11px] text-text-muted">
                    {tr('calcFieldOrderNotRequired')}
                  </div>
                )}
              </div>
            </section>

            <section className="flex min-w-0 flex-col border-t border-border-muted/60 p-3 md:border-l md:border-t-0">
              <SectionTitle>{tr('calcFieldSpecialConfig')}</SectionTitle>
              {!hasSpecialConfig && (
                <div className="flex min-h-32 flex-1 items-center justify-center rounded-md bg-surface px-4 text-center text-[11px] leading-5 text-text-muted">
                  {tr('calcFieldNoSpecialConfig')}
                </div>
              )}
              {definition.frame === 'custom' && (
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
            </section>
          </div>
        </div>
      </div>

      <div className="flex items-end gap-3 rounded-lg border border-border-muted/60 bg-surface p-3">
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
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[11px] font-medium text-text-secondary">{children}</div>;
}

function WizardLabel({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-text-muted">{text}</span>
      {children}
    </label>
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
    <div className="flex flex-col gap-2">
      <WizardLabel text={props.tr('calcFieldFrameType')}>
        <GlassOptionSingleSelect
          value={props.frameType}
          groups={[{ key: 'frameType', items: typeOptions }]}
          onChange={(value) => props.setFrameType(value as CalculationWindowFrame['type'])}
          className="h-8 w-full text-[11px]"
        />
      </WizardLabel>
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
      <WizardLabel text={props.tr('calcFieldFrameExclude')}>
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
          className="h-8 w-full text-[11px]"
        />
      </WizardLabel>
    </div>
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
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-text-muted">{props.label}</span>
      <div className="flex gap-1">
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
          className="h-8 min-w-0 flex-1 text-[10px]"
        />
        {needsOffset && (
          <GlassFormTextInput
            inputMode="numeric"
            value={props.offset}
            onChange={props.setOffset}
            className="h-8 w-12 rounded-md px-1 text-center text-[11px]"
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
            className="h-8 w-16 text-[10px]"
          />
        )}
      </div>
    </div>
  );
}

function trFrameType(value: string, tr: (key: string) => string): string {
  if (value === 'range') return tr('calcFieldFrameRange');
  if (value === 'groups') return tr('calcFieldFrameGroups');
  return tr('calcFieldFrameRows');
}

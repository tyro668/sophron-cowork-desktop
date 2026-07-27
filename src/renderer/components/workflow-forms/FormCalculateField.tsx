import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassRowList, type GlassRowListColumn } from './shared/GlassRowList';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import {
  createCalculationRow,
  exprFromParts,
  FN_ARG_SPEC,
  TIME_WINDOW_DEFS,
  needsCalculationIdNormalization,
  normalizeCalculationEntries,
  type CalculationConfigEntry,
  type CalculationRow,
} from './shared/calculate-field';
import { SCENARIO_OPTIONS, FUNCTION_CATEGORIES, parseBound } from './calculate-field/index';
import { isTemporalDataFieldType } from '@/shared/data-field-types';
import { GlassPartitionConfig } from './calculate-field/partition';
import { GlassOrderByConfig } from './calculate-field/order-by';
import { GlassWindowFrameConfig } from './calculate-field/window-frame';
import { GlassTimeIntelConfig } from './calculate-field/time-intel';

const EXCLUDE_ROW_FUNCTIONS = ['calcFieldCategoryWindow', 'calcFieldCategoryAggregate'];

const SCENARIO_DEFAULT_FN: Record<string, string> = {
  group_metrics: 'sum',
  ranking: 'row_number',
  cumulative: 'sum',
  offset: 'lag',
  moving_window: 'sum',
  period_compare: 'period_yoy_value',
};

export default function FormCalculateField({
  node,
  fieldCompletions,
  sourceNode,
  taskId,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation();
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const rawCalculations = useMemo(
    () => (node.config.calculations as CalculationConfigEntry[] | undefined) ?? [],
    [node.config.calculations]
  );
  const [localItems, setLocalItems] = useState<CalculationRow[]>(() =>
    normalizeCalculationEntries(rawCalculations)
  );
  const needsNormalization = useMemo(
    () => needsCalculationIdNormalization(rawCalculations),
    [rawCalculations]
  );

  const savedMode = node.config?._activeMode;
  const [activeMode, setActiveMode] = useState<'row' | 'cross'>(
    savedMode === 'row' || savedMode === 'cross' ? savedMode : 'row'
  );
  const savedScenario = node.config?._activeScenario;
  const [activeScenario, setActiveScenario] = useState<string>(
    typeof savedScenario === 'string' && savedScenario ? savedScenario : 'group_metrics'
  );

  const storeCalculations = useCallback(
    (next: CalculationRow[]) => {
      const toPersist = next.filter((i) =>
        activeMode === 'row'
          ? i.type === 'row'
          : i.type !== 'row' && (i.scenario || activeScenario) === activeScenario
      );
      updateConfig((cfg) => ({
        ...cfg,
        calculations: toPersist.length > 0 ? toPersist : undefined,
        _activeMode: activeMode,
        _activeScenario: activeScenario,
      }));
    },
    [updateConfig, activeMode, activeScenario]
  );

  const isMounted = useRef(false);

  useEffect(() => {
    if (isMounted.current) return;
    isMounted.current = true;
    if (activeMode === 'cross') {
      const hasItems = localItems.some(
        (i) => i.type !== 'row' && (i.scenario || activeScenario) === activeScenario
      );
      if (!hasItems) {
        updateItem(0, { fn: SCENARIO_DEFAULT_FN[activeScenario] || 'sum' });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const toPersist = localItems.filter((i) =>
      activeMode === 'row'
        ? i.type === 'row'
        : i.type !== 'row' && (i.scenario || activeScenario) === activeScenario
    );
    updateConfig((cfg) => ({
      ...cfg,
      calculations: toPersist.length > 0 ? toPersist : undefined,
      _activeMode: activeMode,
      _activeScenario: activeScenario,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, activeScenario]);

  useEffect(() => {
    if (!needsNormalization) return;
    const persisted = normalizeCalculationEntries(rawCalculations);
    if (persisted.length > 0) storeCalculations(persisted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsNormalization]);

  const visibleItems = useMemo(() => {
    const filtered = localItems.filter((i) =>
      activeMode === 'row'
        ? i.type === 'row'
        : i.type !== 'row' && (i.scenario || activeScenario) === activeScenario
    );
    if (filtered.length > 0) return [filtered[0]];
    if (activeMode === 'row') return [createCalculationRow()];
    return [
      { ...createCalculationRow(), type: 'cross' as const, scenario: activeScenario },
    ] as CalculationRow[];
  }, [localItems, activeMode, activeScenario]);

  function toBackingIndex(visibleIndex: number): number {
    let count = 0;
    for (let i = 0; i < localItems.length; i++) {
      const match =
        activeMode === 'row'
          ? localItems[i].type === 'row'
          : localItems[i].type !== 'row' &&
            (localItems[i].scenario || activeScenario) === activeScenario;
      if (match) {
        if (count === visibleIndex) return i;
        count++;
      }
    }
    return -1;
  }

  const handleChange = useCallback(
    (next: CalculationRow[]) => {
      const normalized = normalizeCalculationEntries(next);
      setLocalItems(normalized);
      storeCalculations(normalized);
    },
    [storeCalculations]
  );

  function validateFrameBounds(
    frameStart: string | undefined,
    frameEnd: string | undefined
  ): { frameStart: string; frameEnd: string } | null {
    if (!frameStart || !frameEnd) return null;
    const s = parseBound(frameStart);
    const e = parseBound(frameEnd);
    function boundOrderRank(type: string, value: number | null): number {
      switch (type) {
        case 'unbounded preceding':
          return Number.MIN_SAFE_INTEGER;
        case 'n_preceding':
          return -(value ?? 1);
        case 'current row':
          return 0;
        case 'n_following':
          return value ?? 1;
        case 'unbounded following':
          return Number.MAX_SAFE_INTEGER;
        default:
          return Number.MIN_SAFE_INTEGER;
      }
    }
    if (boundOrderRank(s.type, s.value) > boundOrderRank(e.type, e.value)) {
      return { frameStart: frameEnd, frameEnd: frameStart };
    }
    return null;
  }

  function applyFrameDefaults(item: CalculationRow, scenario: string): void {
    if (scenario === 'cumulative') {
      item.frameType = 'rows';
      item.frameStart = 'unbounded preceding';
      item.frameEnd = 'current row';
    }
    const validated = validateFrameBounds(item.frameStart, item.frameEnd);
    if (validated) {
      item.frameStart = validated.frameStart;
      item.frameEnd = validated.frameEnd;
    }
  }

  function updateItem(visibleIndex: number, patch: Partial<CalculationRow>) {
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) {
      const entry = {
        ...createCalculationRow(),
        type: activeMode,
        scenario: activeMode === 'cross' ? activeScenario : undefined,
        ...patch,
      };
      if (entry.type !== 'row') {
        applyFrameDefaults(entry, activeScenario);
        entry.expression = exprFromParts(entry);
      }
      handleChange([...localItems, entry]);
      return;
    }
    handleChange(
      localItems.map((item, i) => {
        if (i !== bi) return item;
        const updated = { ...item, ...patch };
        if (updated.type !== 'row') {
          applyFrameDefaults(updated, activeScenario);
          updated.expression = exprFromParts(updated);
        }
        return updated;
      })
    );
  }

  const [partitionOpen, setPartitionOpen] = useState<Record<number, boolean>>({});
  const [orderOpen, setOrderOpen] = useState<Record<number, boolean>>({});
  const lastPartitionByRef = useRef<Record<string, string[] | undefined>>({});

  function rowColumns() {
    const actionOptions = [
      { value: 'add', label: tr('calcFieldActionAdd', '新增字段') },
      { value: 'replace', label: tr('calcFieldActionReplace', '替换字段') },
    ];

    const insertModeCol: GlassRowListColumn<CalculationRow> = {
      flex: 'flex-[1]',
      header: '',
      render: (item: CalculationRow, index: number) => (
        <GlassOptionSingleSelect
          value={item.action || 'add'}
          groups={[{ key: 'action', items: actionOptions }]}
          onChange={(v) => updateItem(index, { action: v as 'add' | 'replace' })}
          className="h-7 text-[12px] [&>span]:text-left w-full"
        />
      ),
    };
    const targetFieldCol: GlassRowListColumn<CalculationRow> = {
      flex: 'flex-[1]',
      header: '',
      render: (item: CalculationRow, index: number) => {
        const fieldConflict =
          item.action === 'add' && item.field && fieldCompletions.includes(item.field);
        return (
          <div className="flex items-center gap-1 w-full">
            {item.action === 'replace' ? (
              <GlassFieldSingleSelect
                value={fieldCompletions.includes(item.field) ? item.field : ''}
                options={fieldCompletions}
                columnTypes={columnTypes}
                onChange={(v) => updateItem(index, { field: v })}
                placeholder={tr('calcFieldSelectPlaceholder', '选择字段')}
                className="h-7 w-full text-[12px]"
              />
            ) : (
              <div className="relative w-full">
                <GlassFormTextInput
                  value={item.field}
                  onChange={(v) => updateItem(index, { field: v })}
                  placeholder={tr('calcFieldTargetPlaceholder', '请输入字段名')}
                  className="!h-7 w-full rounded-md pr-6 px-1.5 text-[12px] shadow-none focus:ring-0"
                />
                {fieldConflict && (
                  <span className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex group">
                    <AlertCircle className="h-4 w-4 text-error" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-50 whitespace-nowrap rounded-lg border border-border-subtle bg-[var(--glass-card-strong)] px-2.5 py-1.5 text-[12px] text-error shadow-elevated backdrop-blur-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity pointer-events-none">
                      {tr('calcFieldConflictWarning', '字段名已存在于上游数据')}
                    </div>
                  </span>
                )}
              </div>
            )}
          </div>
        );
      },
    };

    return [
      { ...insertModeCol, flex: 'flex-[1]', header: tr('calcFieldActionHeader', '插入模式') },
      { ...targetFieldCol, flex: 'flex-[2]', header: tr('calcFieldTargetField', '目标字段') },
      {
        flex: 'flex-[4]',
        header: tr('calcFieldExpressionLabel', '表达式'),
        render: (item: CalculationRow, index: number) => (
          <GlassExpressionInput
            value={item.expression}
            onChange={(v) =>
              updateItem(index, {
                expression: v,
                ...(v && item.type === 'row' ? { type: 'row' as const } : {}),
              })
            }
            fieldCompletions={fieldCompletions}
            columnTypes={columnTypes}
            placeholder={tr('calcFieldExpressionPlaceholder', '请输入表达式')}
            excludeFunctionCategories={EXCLUDE_ROW_FUNCTIONS}
          />
        ),
      },
    ];
  }

  function renderCrossLayout(item: CalculationRow, index: number, scenario: string) {
    const defaultFn = SCENARIO_DEFAULT_FN[scenario] || 'sum';
    const currentFn = item.fn || defaultFn;
    const specs = FN_ARG_SPEC[currentFn] || FN_ARG_SPEC['*'];
    const isPartition = item.partitionBy !== undefined;
    const ordOpen = orderOpen[index];
    const timePrefix = Object.keys(TIME_WINDOW_DEFS).find((p) => currentFn.startsWith(p + '_'));
    const currentTimeWindow = timePrefix || 'ytd';
    const currentTimeAgg = timePrefix ? currentFn.slice(timePrefix.length + 1) : 'sum';
    const timeDef = TIME_WINDOW_DEFS[currentTimeWindow];
    const timeFieldValue = item.orderBy?.[0]?.field ?? '';

    const FN_ARG2_DEFAULTS: Record<string, string> = {
      ntile: '4',
      nth_value: '2',
      quantile_cont: '0.5',
      lag: '1',
      lead: '1',
      offset_diff: '1',
      offset_rate: '1',
    };

    const FN_ARG2_LABELS: Record<string, string> = {
      ntile_fnArg: tr('calcFieldPlaceholderBuckets', '桶数'),
      nth_value_fnArg2: tr('calcFieldPlaceholderNth', '第N行'),
      quantile_cont_fnArg2: tr('calcFieldPlaceholderQuantile', '分位值'),
      lag_fnArg2: tr('calcFieldPlaceholderOffset', '偏移行数'),
      lead_fnArg2: tr('calcFieldPlaceholderOffset', '偏移行数'),
      offset_diff_fnArg2: tr('calcFieldPlaceholderOffset', '偏移行数'),
      offset_rate_fnArg2: tr('calcFieldPlaceholderOffset', '偏移行数'),
      string_agg_fnArg2: tr('calcFieldPlaceholderDelimiter', '分隔符'),
    };

    const fnGroupOptions = (FUNCTION_CATEGORIES[scenario] || []).map((cat) => ({
      key: cat.key,
      header: tr(cat.header, cat.header),
      items: cat.items.map((f) => ({
        value: f,
        label: tr('calcFieldFn_' + f, f),
      })),
    }));

    const actionOptions = [
      { value: 'add', label: tr('calcFieldActionAdd', '新增字段') },
      { value: 'replace', label: tr('calcFieldActionReplace', '替换字段') },
    ];

    const showOrderBy =
      scenario === 'ranking' ||
      scenario === 'cumulative' ||
      scenario === 'offset' ||
      scenario === 'moving_window';

    const isPeriodCompare = scenario === 'period_compare';
    const isTimeIntel = scenario === 'time_intel';

    return (
      <div className="flex flex-col gap-3">
        {/* Row 0: 计算类别 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
              {tr('calcFieldScenarioLabel', '计算类别')}
            </span>
            <GlassOptionSingleSelect
              value={activeScenario}
              groups={[
                {
                  key: 'scenario',
                  items: SCENARIO_OPTIONS.map((s) => ({
                    value: s.value,
                    label: tr(s.key, s.label),
                  })),
                },
              ]}
              onChange={(v) => setActiveScenario(v)}
              className="h-7 text-[12px] w-28"
            />
          </div>
          <span className="text-[10px] text-text-muted">
            {tr(scenario + 'Hint', SCENARIO_OPTIONS.find((s) => s.value === scenario)?.tip || '')}
          </span>
        </div>

        {/* Row 1: 插入模式 + 目标字段 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
              {tr('calcFieldActionHeader', '插入模式')}
            </span>
            <GlassOptionSingleSelect
              value={item.action || 'add'}
              groups={[{ key: 'action', items: actionOptions }]}
              onChange={(v) => updateItem(index, { action: v as 'add' | 'replace' })}
              className="h-7 text-[12px] w-28"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
              {tr('calcFieldTargetField', '目标字段')}
            </span>
            <div className="flex items-center gap-1">
              <div className="w-36">
                {item.action === 'replace' ? (
                  <GlassFieldSingleSelect
                    value={fieldCompletions.includes(item.field) ? item.field : ''}
                    options={fieldCompletions}
                    columnTypes={columnTypes}
                    onChange={(v) => updateItem(index, { field: v })}
                    placeholder={tr('calcFieldSelectPlaceholder', '选择字段')}
                    className="h-7 w-full text-[12px]"
                  />
                ) : (
                  <GlassFormTextInput
                    value={item.field}
                    onChange={(v) => updateItem(index, { field: v })}
                    placeholder={tr('calcFieldTargetPlaceholder', '请输入字段名')}
                    className="h-7 w-full rounded-md px-1.5 text-[12px] shadow-none focus:ring-0"
                  />
                )}
              </div>
              {item.action === 'add' && item.field && fieldCompletions.includes(item.field) && (
                <span className="relative inline-flex group shrink-0">
                  <AlertCircle className="h-4 w-4 text-error cursor-pointer" />
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-50 whitespace-nowrap rounded-lg border border-border-subtle bg-[var(--glass-card-strong)] px-2.5 py-1.5 text-[12px] text-error shadow-elevated backdrop-blur-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity pointer-events-none">
                    {tr('calcFieldConflictWarning', '字段名已存在于上游数据')}
                  </div>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: 计算函数 */}
        {isTimeIntel ? (
          <GlassTimeIntelConfig
            item={item}
            index={index}
            updateItem={updateItem}
            tr={tr}
            fieldCompletions={fieldCompletions}
            columnTypes={columnTypes}
            currentTimeWindow={currentTimeWindow}
            currentTimeAgg={currentTimeAgg}
            timeDef={timeDef}
            timeFieldValue={timeFieldValue}
          />
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                {tr('calcFieldFunction', '计算函数')}
              </span>
              <GlassOptionSingleSelect
                value={currentFn}
                groups={fnGroupOptions}
                onChange={(v) => {
                  const defaultVal = FN_ARG2_DEFAULTS[v];
                  const patch: Partial<CalculationRow> = { fn: v };
                  if (defaultVal !== undefined && !item.fnArg2) patch.fnArg2 = defaultVal;
                  updateItem(index, patch);
                }}
                className="h-7 text-[12px] w-28"
              />
            </div>
            {specs.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                  {s.type === 'field'
                    ? tr('calcFieldFnArg', '参数字段')
                    : FN_ARG2_LABELS[currentFn + '_' + s.key] ||
                      tr('calcFieldFnArgConst', '参数常数')}
                </span>
                <div className={s.type === 'field' ? 'w-36' : 'w-28'}>
                  {s.type === 'field' ? (
                    <GlassFieldSingleSelect
                      value={item[s.key] ?? ''}
                      options={fieldCompletions}
                      columnTypes={columnTypes}
                      onChange={(v) => updateItem(index, { [s.key]: v } as Partial<CalculationRow>)}
                      placeholder={tr('calcFieldFnArgPlaceholder', '选择字段')}
                      className="h-7 w-full text-[12px]"
                    />
                  ) : (
                    <GlassFormTextInput
                      inputMode={s.type === 'text' ? undefined : 'numeric'}
                      value={item[s.key] ?? ''}
                      onChange={(v) => updateItem(index, { [s.key]: v } as Partial<CalculationRow>)}
                      placeholder={
                        FN_ARG2_LABELS[currentFn + '_' + s.key] ||
                        tr('calcFieldFnArgNumPlaceholder', '参数')
                      }
                      className="h-7 rounded-md px-1.5 text-[12px] w-full"
                    />
                  )}
                </div>
              </div>
            ))}
            {isPeriodCompare && (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                  {tr('calcFieldRefField', '参照字段')}
                </span>
                <GlassFieldSingleSelect
                  value={item.orderBy?.[0]?.field ?? ''}
                  options={fieldCompletions.filter((c) => isTemporalDataFieldType(columnTypes[c]))}
                  columnTypes={columnTypes}
                  onChange={(v) =>
                    updateItem(index, { orderBy: v ? [{ field: v, direction: 'asc' }] : undefined })
                  }
                  placeholder={tr('calcFieldDatePlaceholder', '选择日期字段')}
                  className="h-7 w-28 text-[12px]"
                />
              </div>
            )}
          </div>
        )}

        {/* Row 3: 分区范围 */}
        <GlassPartitionConfig
          item={item}
          index={index}
          updateItem={updateItem}
          tr={tr}
          fieldCompletions={fieldCompletions}
          columnTypes={columnTypes}
          scenario={scenario}
          isPartition={isPartition}
          partitionOpen={partitionOpen}
          setPartitionOpen={setPartitionOpen}
          lastPartitionByRef={lastPartitionByRef}
        />

        {/* Row 4: 排序字段 */}
        {showOrderBy && (
          <GlassOrderByConfig
            item={item}
            index={index}
            updateItem={updateItem}
            tr={tr}
            fieldCompletions={fieldCompletions}
            columnTypes={columnTypes}
            ordOpen={ordOpen}
            setOrderOpen={setOrderOpen}
          />
        )}

        {/* Row 5: 窗口帧 */}
        {scenario === 'moving_window' && (
          <GlassWindowFrameConfig
            item={item}
            index={index}
            updateItem={updateItem}
            tr={tr}
            columnTypes={columnTypes}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 h-full min-h-0">
      <div className="flex-[1] rounded-lg border border-border-muted bg-background/42 content-start">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            1
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">
              {tr('calcFieldModeHeader', '计算模式')}
            </span>
            <span className="text-[10px] text-text-muted">
              {tr('calcFieldModeHint', '选择计算方式')}
            </span>
          </div>
        </div>
        <div className="px-3 pb-3 flex flex-col gap-1.5">
          <GlassRadioSelect
            value={activeMode}
            options={[
              {
                value: 'row',
                label: tr('calcFieldModeRow', '逐行计算'),
                tip: tr('calcFieldModeRowTip', '基于当前行的字段做运算，不依赖其他行'),
              },
              {
                value: 'cross',
                label: tr('calcFieldModeCross', '跨行计算'),
                tip: tr('calcFieldModeCrossTip', '按分区汇总、排名、滑动窗口、周期对比等'),
              },
            ]}
            onChange={(v) => setActiveMode(v as 'row' | 'cross')}
          />
        </div>
      </div>
      <div className="flex-[4] rounded-lg border border-border-muted bg-background/42 content-start overflow-hidden flex flex-col">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5 shrink-0">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            2
          </span>
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <div className="grid min-w-0 flex-1">
              <span className="text-[13px] font-semibold text-text-primary">
                {tr('calcFieldConfigHeader', '计算配置')}
              </span>
              {activeMode === 'row' && (
                <span className="text-[10px] text-text-muted">
                  {tr('calcFieldConfigHintRow', '定义新字段及其计算表达式')}
                </span>
              )}
              {activeMode === 'cross' && (
                <span className="text-[10px] text-text-muted">
                  {tr('calcFieldConfigHintCross', '选择模式并进行配置')}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="px-3 pb-3 overflow-y-auto flex-1 min-h-0">
          {activeMode === 'row' ? (
            <GlassRowList
              headerClassName="text-[12px]"
              items={visibleItems as CalculationRow[]}
              columns={rowColumns()}
              onAdd={() => {}}
              onRemove={() => {}}
              addTitle=""
              removeTitle=""
              actions={[]}
            />
          ) : (
            renderCrossLayout(visibleItems[0], 0, activeScenario)
          )}
        </div>
      </div>
    </div>
  );
}

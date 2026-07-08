import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, RotateCcw, Trash2, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFieldCombo } from './shared/GlassFieldCombo';
import { GlassColumnSelector } from './shared/GlassColumnSelector';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassRowList, type GlassRowListColumn } from './shared/GlassRowList';
import {
  createCalculationRow,
  exprFromParts,
  FN_ARG_SPEC,
  needsCalculationIdNormalization,
  normalizeCalculationEntries,
  type CalculationConfigEntry,
  type CalculationRow,
} from './shared/calculate-field';

const EXCLUDE_ROW_FUNCTIONS = ['calcFieldCategoryWindow', 'calcFieldCategoryAggregate'];

const FRAME_PRESETS = [
  {
    value: 'unbounded preceding|current row',
    label: '累计到当前行',
    key: 'calcFieldFrameCumulative',
  },
  {
    value: 'current row|unbounded following',
    label: '从当前行累计',
    key: 'calcFieldFrameRemaining',
  },
  { value: 'unbounded preceding|unbounded following', label: '整个分区', key: 'calcFieldFrameAll' },
  { value: 'custom', label: '自定义', key: 'calcFieldFrameCustom' },
];

const SCENARIO_OPTIONS = [
  {
    value: 'group',
    key: 'calcFieldScenarioGroup',
    label: '分组统计',
    tip: '按分区聚合数据：求和/平均/计数/中位数/标准差/方差/众数/分位数/占比',
  },
  {
    value: 'sorted',
    key: 'calcFieldScenarioSorted',
    label: '窗口计算',
    tip: '累计求和、移动平均、自定义窗口范围、前后行值引用',
  },
  {
    value: 'rank',
    key: 'calcFieldScenarioRank',
    label: '排序编号',
    tip: '行号、排名、密集排名、百分比排名、累积分布、分桶',
  },
  {
    value: 'period',
    key: 'calcFieldScenarioPeriod',
    label: '周期对比',
    tip: '同比值/率、环比值/率、自定义偏移差值/率',
  },
];

const FUNCTION_CATEGORIES: Record<string, { key: string; header: string; items: string[] }[]> = {
  group: [
    {
      key: 'agg',
      header: 'calcFieldCatAgg',
      items: [
        'sum',
        'avg',
        'min',
        'max',
        'count',
        'count_distinct',
        'median',
        'stddev',
        'var',
        'mode',
        'quantile_cont',
      ],
    },
    {
      key: 'value',
      header: 'calcFieldCatValue',
      items: ['first_value', 'last_value', 'nth_value'],
    },
    {
      key: 'text',
      header: 'calcFieldCatTextLogical',
      items: ['string_agg', 'bool_and', 'bool_or'],
    },
    {
      key: 'special',
      header: 'calcFieldCatSpecial',
      items: ['percentage'],
    },
  ],
  sorted: [
    {
      key: 'agg',
      header: 'calcFieldCatAgg',
      items: [
        'sum',
        'avg',
        'min',
        'max',
        'count',
        'count_distinct',
        'median',
        'stddev',
        'var',
        'mode',
        'quantile_cont',
        'product',
      ],
    },
    {
      key: 'value',
      header: 'calcFieldCatValue',
      items: ['first_value', 'last_value', 'nth_value', 'lag', 'lead'],
    },
    {
      key: 'text',
      header: 'calcFieldCatTextLogical',
      items: ['string_agg', 'bool_and', 'bool_or'],
    },
  ],
  rank: [
    {
      key: 'rank',
      header: 'calcFieldCatRank',
      items: ['row_number', 'rank', 'dense_rank', 'ntile', 'percent_rank', 'cume_dist'],
    },
  ],
  period: [
    {
      key: 'period',
      header: 'calcFieldCatPeriod',
      items: [
        'period_yoy_value',
        'period_yoy_rate',
        'period_mom_value',
        'period_mom_rate',
        'offset_diff',
        'offset_rate',
      ],
    },
  ],
};

function parseFrameN(frameStart: string | undefined): number {
  if (!frameStart || frameStart === 'unbounded preceding') return -1;
  const m = frameStart.match(/^(\d+) preceding$/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseFrameM(frameEnd: string | undefined): number {
  if (!frameEnd || frameEnd === 'unbounded following') return -1;
  if (frameEnd === 'current row') return 0;
  const m = frameEnd.match(/^(\d+) following$/);
  return m ? parseInt(m[1], 10) : 0;
}

export default function FormCalculateField({
  node,
  fieldCompletions,
  sourceNode,
  taskId,
  onNodeChange,
}: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

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
      .then((types: Array<{ name: string; type: string }>) => {
        const map: Record<string, string> = {};
        for (const t of types) map[t.name] = t.type;
        setColumnTypes(map);
      })
      .catch(() => {});
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config]);

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

  const [activeMode, setActiveMode] = useState<'row' | 'cross'>(
    () => (node.config?._activeMode as 'row' | 'cross') || 'row'
  );
  const [activeScenario, setActiveScenario] = useState<string>(
    () => (node.config?._activeScenario as string) || 'group'
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
      }));
    },
    [updateConfig, activeMode, activeScenario]
  );

  useEffect(() => {
    const hasItems = localItems.some((i) =>
      activeMode === 'row'
        ? i.type === 'row'
        : i.type !== 'row' && (i.scenario || activeScenario) === activeScenario
    );

    if (!hasItems && activeMode === 'cross') {
      const defaults: Record<string, string> = {
        group: 'sum',
        sorted: 'sum',
        rank: 'row_number',
        period: 'period_yoy_value',
      };
      updateItem(0, { fn: defaults[activeScenario] || 'sum' });
      return;
    }

    const toPersist = localItems.filter((i) =>
      activeMode === 'row'
        ? i.type === 'row'
        : i.type !== 'row' && (i.scenario || activeScenario) === activeScenario
    );
    updateConfig((cfg) => ({
      ...cfg,
      _activeMode: activeMode,
      _activeScenario: activeScenario,
      calculations: toPersist.length > 0 ? toPersist : undefined,
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

  function updateItem(visibleIndex: number, patch: Partial<CalculationRow>) {
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) {
      const entry = {
        ...createCalculationRow(),
        type: activeMode,
        scenario: activeMode === 'cross' ? activeScenario : undefined,
        ...patch,
      };
      if (entry.type !== 'row') entry.expression = exprFromParts(entry);
      handleChange([...localItems, entry]);
      return;
    }
    handleChange(
      localItems.map((item, i) => {
        if (i !== bi) return item;
        const updated = { ...item, ...patch };
        if (updated.type !== 'row') updated.expression = exprFromParts(updated);
        return updated;
      })
    );
  }

  function resetItem(visibleIndex: number) {
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) return;
    handleChange(
      localItems.map((it, i) =>
        i !== bi
          ? it
          : { ...createCalculationRow(), type: it.type, action: it.action, scenario: it.scenario }
      )
    );
  }

  const [partitionOpen, setPartitionOpen] = useState<Record<number, boolean>>({});
  const [orderOpen, setOrderOpen] = useState<Record<number, boolean>>({});

  function rowColumns() {
    const actionOptions = [
      { value: 'add', label: tr('calcFieldActionAdd', '新增字段') },
      { value: 'replace', label: tr('calcFieldActionReplace', '替换字段') },
    ];

    const insertModeCol: GlassRowListColumn<CalculationRow> = {
      flex: 'flex-[1]',
      header: '',
      render: (item: CalculationRow, index: number) => (
        <GlassOperatorSelect
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
      render: (item: CalculationRow, index: number) =>
        item.action === 'replace' ? (
          <GlassFieldCombo
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
            className="!h-7 w-full rounded-md px-1.5 text-[12px] shadow-none focus:ring-0"
          />
        ),
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
    const scenarioDefaults: Record<string, string> = {
      group: 'sum',
      sorted: 'sum',
      rank: 'row_number',
      period: 'period_yoy_value',
    };
    const defaultFn = scenarioDefaults[scenario] || 'sum';
    const currentFn = item.fn || defaultFn;
    const specs = FN_ARG_SPEC[currentFn] || FN_ARG_SPEC['*'];
    const isPartition = item.partitionBy !== undefined;
    const partOpen = partitionOpen[index];
    const ordOpen = orderOpen[index];

    const FN_ARG2_DEFAULTS: Record<string, string> = {
      ntile: '4',
      nth_value: '2',
      quantile_cont: '0.5',
      lag: '1',
      lead: '1',
      offset_diff: '1',
      offset_rate: '1',
    };

    const NUM_PLACEHOLDER: Record<string, string> = {
      ntile_fnArg: tr('calcFieldPlaceholderBuckets', '桶数'),
      nth_value_fnArg2: tr('calcFieldPlaceholderNth', '第N行'),
      quantile_cont_fnArg2: tr('calcFieldPlaceholderQuantile', '分位值 (0-1)'),
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

    const showOrderBy = scenario !== 'group';

    return (
      <div className="flex flex-col gap-3">
        {/* Row 0: 计算类别 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
              {tr('calcFieldScenarioLabel', '计算类别')}
            </span>
            <GlassOperatorSelect
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
            <GlassOperatorSelect
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
            <div className="w-36">
              {item.action === 'replace' ? (
                <GlassFieldCombo
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
                  className="!h-7 w-full rounded-md px-1.5 text-[12px] shadow-none focus:ring-0"
                />
              )}
            </div>
          </div>
        </div>

        {/* Row 2: 计算函数 + 参数 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
              {tr('calcFieldFunction', '计算函数')}
            </span>
            <GlassOperatorSelect
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
                  : tr('calcFieldFnArgConst', '参数常数')}
              </span>
              <div className={s.type === 'field' ? 'w-36' : 'w-28'}>
                {s.type === 'field' ? (
                  <GlassFieldCombo
                    value={item[s.key] ?? ''}
                    options={fieldCompletions}
                    columnTypes={columnTypes}
                    onChange={(v) => updateItem(index, { [s.key]: v } as Partial<CalculationRow>)}
                    placeholder={tr('calcFieldFnArgPlaceholder', '选择字段')}
                    className="h-7 w-full text-[12px]"
                  />
                ) : s.type === 'text' ? (
                  <input
                    type="text"
                    value={item[s.key] ?? ''}
                    onChange={(e) =>
                      updateItem(index, { [s.key]: e.target.value } as Partial<CalculationRow>)
                    }
                    placeholder={
                      NUM_PLACEHOLDER[currentFn + '_' + s.key] ||
                      tr('calcFieldFnArgNumPlaceholder', '参数')
                    }
                    className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent placeholder:text-text-muted"
                  />
                ) : (
                  <input
                    type="number"
                    min={0}
                    value={item[s.key] ?? ''}
                    onChange={(e) =>
                      updateItem(index, { [s.key]: e.target.value } as Partial<CalculationRow>)
                    }
                    placeholder={
                      NUM_PLACEHOLDER[currentFn + '_' + s.key] ||
                      tr('calcFieldFnArgNumPlaceholder', '参数')
                    }
                    className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent placeholder:text-text-muted"
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Row 3: 分区范围 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
              {tr('calcFieldPartitionRange', '分区范围')}
            </span>
            <GlassOperatorSelect
              value={isPartition ? 'partition' : 'all'}
              groups={[
                {
                  key: 'partitionMode',
                  items: [
                    { value: 'all', label: tr('calcFieldPartitionAll', '全表') },
                    { value: 'partition', label: tr('calcFieldPartitionSelect', '部分') },
                  ],
                },
              ]}
              onChange={(v) => {
                if (v === 'all') {
                  updateItem(index, { partitionBy: undefined });
                } else {
                  updateItem(index, { partitionBy: [] });
                  setPartitionOpen((o) => ({ ...o, [index]: true }));
                }
              }}
              className="h-7 text-[12px] w-28"
            />
          </div>
          {isPartition && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                {tr('calcFieldPartitionBy', '分区字段')}
              </span>
              <div className="w-72 min-w-0 relative">
                <div className="flex min-h-7 items-center rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
                  {item.partitionBy?.length ? (
                    <button
                      type="button"
                      onClick={() => updateItem(index, { partitionBy: [] })}
                      className="ml-1 inline-flex flex-shrink-0 items-center justify-center self-stretch rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                      title={tr('clearAll', '清空')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  ) : null}
                  <div className="flex flex-1 items-center gap-1 px-1.5 min-w-0 overflow-x-auto">
                    {item.partitionBy?.map((col) => (
                      <span
                        key={col}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[12px] font-medium text-accent"
                      >
                        {col}
                        <button
                          type="button"
                          onClick={() =>
                            updateItem(index, {
                              partitionBy: item.partitionBy?.filter((c) => c !== col),
                            })
                          }
                          className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      readOnly
                      placeholder={
                        !item.partitionBy?.length
                          ? tr('calcFieldPartitionPlaceholder', '选择分区字段')
                          : ''
                      }
                      onFocus={() => setPartitionOpen((o) => ({ ...o, [index]: true }))}
                      onBlur={() =>
                        setTimeout(() => setPartitionOpen((o) => ({ ...o, [index]: false })), 150)
                      }
                      className="h-5 min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted cursor-pointer"
                    />
                  </div>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setPartitionOpen((o) => ({ ...o, [index]: !partOpen }))}
                    className="flex w-7 flex-shrink-0 items-center justify-center self-stretch border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${partOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>
                {partOpen && (
                  <div className="absolute z-10 left-0 right-0 mt-0.5">
                    <GlassColumnSelector
                      columns={fieldCompletions}
                      selected={item.partitionBy ?? []}
                      onChange={(v) =>
                        updateItem(index, { partitionBy: v.length > 0 ? v : undefined })
                      }
                      columnTypes={columnTypes}
                      maxHeight="160px"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Row 4: 排序字段 (sorted, rank, period) */}
        {showOrderBy && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                {tr('calcFieldOrderBy', '排序字段')}
              </span>
              <div className="w-72 min-w-0 relative">
                <div className="flex min-h-7 items-center rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
                  {item.orderBy?.length ? (
                    <button
                      type="button"
                      onClick={() => updateItem(index, { orderBy: undefined })}
                      className="ml-1 inline-flex flex-shrink-0 items-center justify-center self-stretch rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                      title={tr('clearAll', '清空')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  ) : null}
                  <div className="flex flex-1 items-center gap-1 px-1.5 min-w-0 overflow-x-auto">
                    {item.orderBy?.map((o) => (
                      <span
                        key={o.field}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[12px] font-medium text-accent"
                      >
                        {o.field}
                        <button
                          type="button"
                          onClick={() =>
                            updateItem(index, {
                              orderBy: item.orderBy?.map((x) =>
                                x.field === o.field
                                  ? {
                                      ...x,
                                      direction:
                                        x.direction === 'desc'
                                          ? ('asc' as const)
                                          : ('desc' as const),
                                    }
                                  : x
                              ),
                            })
                          }
                          className="text-[11px] leading-none px-0.5 hover:text-text-primary rounded"
                          title={o.direction === 'asc' ? tr('asc', '升序') : tr('desc', '降序')}
                        >
                          {o.direction === 'asc' ? '↑' : '↓'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateItem(index, {
                              orderBy: item.orderBy?.filter((x) => x.field !== o.field),
                            })
                          }
                          className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      readOnly
                      placeholder={
                        !item.orderBy?.length ? tr('calcFieldOrderPlaceholder', '选择排序字段') : ''
                      }
                      onFocus={() => setOrderOpen((o) => ({ ...o, [index]: true }))}
                      onBlur={() =>
                        setTimeout(() => setOrderOpen((o) => ({ ...o, [index]: false })), 150)
                      }
                      className="h-5 min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted cursor-pointer"
                    />
                  </div>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setOrderOpen((o) => ({ ...o, [index]: !ordOpen }))}
                    className="flex w-7 flex-shrink-0 items-center justify-center self-stretch border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${ordOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>
                {ordOpen && (
                  <div className="absolute z-10 left-0 right-0 mt-0.5">
                    <GlassColumnSelector
                      columns={fieldCompletions}
                      selected={item.orderBy?.map((o) => o.field) ?? []}
                      onChange={(v) =>
                        updateItem(index, {
                          orderBy:
                            v.length > 0
                              ? v.map((f) => ({
                                  field: f,
                                  direction:
                                    item.orderBy?.find((x) => x.field === f)?.direction ??
                                    ('asc' as const),
                                }))
                              : undefined,
                        })
                      }
                      columnTypes={columnTypes}
                      maxHeight="160px"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Row 5: 窗口帧 (sorted only) */}
        {scenario === 'sorted' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                {tr('calcFieldFrame', '窗口范围')}
              </span>
              {(() => {
                const currentKey = `${item.frameStart ?? 'unbounded preceding'}|${item.frameEnd ?? 'unbounded following'}`;
                const isCustom = !FRAME_PRESETS.filter((p) => p.value !== 'custom').some(
                  (p) => p.value === currentKey
                );
                const presets = FRAME_PRESETS.map((p) => ({
                  value: p.value,
                  label: tr(p.key, p.label),
                }));
                const n = isCustom ? parseFrameN(item.frameStart) : 0;
                const m = isCustom ? parseFrameM(item.frameEnd) : 0;
                return (
                  <div className="flex items-center gap-1 w-full">
                    <GlassOperatorSelect
                      value={isCustom ? 'custom' : currentKey}
                      groups={[{ key: 'frame', items: presets }]}
                      onChange={(v) => {
                        if (v === 'custom') {
                          updateItem(index, { frameStart: '1 preceding', frameEnd: 'current row' });
                          return;
                        }
                        const [frameStart, frameEnd] = v.split('|');
                        updateItem(index, { frameStart, frameEnd });
                      }}
                      className="h-7 text-[12px] [&>span]:text-left w-36"
                    />
                    {isCustom && (
                      <div className="flex items-center gap-1 text-[12px] text-text-muted">
                        <span className="shrink-0">前</span>
                        <input
                          type="number"
                          min={0}
                          value={n < 0 ? '' : n}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (isNaN(val) || val < 0) return;
                            updateItem(index, {
                              frameStart: val > 0 ? `${val} preceding` : 'current row',
                            });
                          }}
                          placeholder="∞"
                          className="h-6 w-12 rounded border border-border-muted bg-background/42 px-1 text-center text-[12px] text-text-primary outline-none"
                        />
                        <span className="shrink-0">行 → 后</span>
                        <input
                          type="number"
                          min={0}
                          value={m < 0 ? '' : m}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (isNaN(val) || val < 0) return;
                            updateItem(index, {
                              frameEnd: val > 0 ? `${val} following` : 'current row',
                            });
                          }}
                          placeholder="∞"
                          className="h-6 w-12 rounded border border-border-muted bg-background/42 px-1 text-center text-[12px] text-text-primary outline-none"
                        />
                        <span className="shrink-0">行</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 h-full min-h-0">
      {/* Left panel — mode selection */}
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

      {/* Right panel — expression list */}
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
            <button
              type="button"
              onClick={() => resetItem(0)}
              className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-accent"
              title={tr('calcFieldReset', '重置配置')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="px-3 pb-3 overflow-y-auto flex-1 min-h-0">
          {activeMode === 'row' ? (
            <GlassRowList
              items={visibleItems as CalculationRow[]}
              columns={rowColumns()}
              onAdd={() => {}}
              onRemove={() => {}}
              addTitle=""
              removeTitle=""
              hideActions
            />
          ) : (
            renderCrossLayout(visibleItems[0], 0, activeScenario)
          )}
        </div>
      </div>
    </div>
  );
}

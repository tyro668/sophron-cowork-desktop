import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Trash2, X, AlertCircle } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassTagBar } from './shared/GlassTagBar';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';
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
import { isTemporalDataFieldType } from '@/shared/data-field-types';

const EXCLUDE_ROW_FUNCTIONS = ['calcFieldCategoryWindow', 'calcFieldCategoryAggregate'];

const FRAME_TYPE_OPTIONS = [
  { value: 'rows', key: 'calcFieldFrameRows', label: '按物理行号', hint: 'calcFieldFrameRowsHint' },
  {
    value: 'range',
    key: 'calcFieldFrameRange',
    label: '按值范围',
    hint: 'calcFieldFrameRangeHint',
  },
  {
    value: 'groups',
    key: 'calcFieldFrameGroups',
    label: '按值所在组',
    hint: 'calcFieldFrameGroupsHint',
  },
];

const FRAME_PRESETS_BY_TYPE: Record<string, { value: string; label: string; key: string }[]> = {
  rows: [
    {
      value: 'unbounded preceding|unbounded following',
      label: '整个窗口',
      key: 'calcFieldFrameAll',
    },
    { value: 'custom', label: '自定义', key: 'calcFieldFrameCustom' },
  ],
  range: [
    {
      value: 'unbounded preceding|unbounded following',
      label: '整个窗口',
      key: 'calcFieldFrameAll',
    },
    { value: 'custom', label: '自定义', key: 'calcFieldFrameCustom' },
  ],
  groups: [
    {
      value: 'unbounded preceding|unbounded following',
      label: '整个窗口',
      key: 'calcFieldFrameAll',
    },
    { value: 'custom', label: '自定义', key: 'calcFieldFrameCustom' },
  ],
};

const EXCLUDE_OPTIONS = [
  { value: 'no others', key: 'calcFieldFrameExcludeNone', label: '不排除' },
  { value: 'current row', key: 'calcFieldFrameExcludeCurrent', label: '排除当前行' },
  { value: 'ties', key: 'calcFieldFrameExcludeTies', label: '仅排除同行值' },
  { value: 'group', key: 'calcFieldFrameExcludeGroup', label: '排除当前行和同行值' },
];

const INTERVAL_UNIT_OPTIONS = [
  { value: 'day', label: '天' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
];

const TIME_WINDOW_OPTIONS: { value: string; label: string; key: string }[] = [
  { value: 'ytd', label: '年累计', key: 'timeWindowYtd' },
  { value: 'qtd', label: '季累计', key: 'timeWindowQtd' },
  { value: 'mtd', label: '月累计', key: 'timeWindowMtd' },
  { value: 'wtd', label: '周累计', key: 'timeWindowWtd' },
  { value: 'rolling_year', label: '近N年', key: 'timeWindowRollingYear' },
  { value: 'rolling_month', label: '近N月', key: 'timeWindowRollingMonth' },
  { value: 'rolling_day', label: '近N天', key: 'timeWindowRollingDay' },
  { value: 'rolling_week', label: '近N周', key: 'timeWindowRollingWeek' },
];

const TIME_AGG_OPTIONS: { value: string; label: string; key: string }[] = [
  { value: 'sum', label: '求和', key: 'timeAggSum' },
  { value: 'avg', label: '平均', key: 'timeAggAvg' },
  { value: 'count', label: '计数', key: 'timeAggCount' },
  { value: 'min', label: '最小值', key: 'timeAggMin' },
  { value: 'max', label: '最大值', key: 'timeAggMax' },
  { value: 'distinct_count', label: '去重计数', key: 'timeAggDistinctCount' },
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
  {
    value: 'time',
    key: 'calcFieldScenarioTime',
    label: '时间智能',
    tip: '年初至今、季初至今、近N年滚动累计等时间窗口计算',
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
    {
      key: 'time',
      header: 'calcFieldCatTime',
      items: ['ytd_sum', 'ytd_avg'],
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
  time: [],
};

function parseBound(bound: string | undefined): { type: string; value: number | null } {
  if (!bound || bound === 'unbounded preceding')
    return { type: 'unbounded preceding', value: null };
  if (bound === 'unbounded following') return { type: 'unbounded following', value: null };
  if (bound === 'current row') return { type: 'current row', value: null };
  const m = bound.match(/^(\d+) preceding$/);
  if (m) return { type: 'n_preceding', value: parseInt(m[1], 10) };
  const n = bound.match(/^(\d+) following$/);
  if (n) return { type: 'n_following', value: parseInt(n[1], 10) };
  const iv = bound.match(/^INTERVAL (\d+) (\w+) (PRECEDING|FOLLOWING)$/);
  if (iv)
    return {
      type: iv[3] === 'PRECEDING' ? 'n_preceding' : 'n_following',
      value: parseInt(iv[1], 10),
    };
  return { type: 'unbounded preceding', value: null };
}

function formatBoundFromType(
  type: string,
  value: number | null,
  frameType: string,
  intervalUnit?: string
): string {
  const num = value ?? 1;
  if (type === 'n_preceding' && frameType === 'range' && intervalUnit)
    return `INTERVAL ${num} ${intervalUnit.toUpperCase()} PRECEDING`;
  if (type === 'n_following' && frameType === 'range' && intervalUnit)
    return `INTERVAL ${num} ${intervalUnit.toUpperCase()} FOLLOWING`;
  switch (type) {
    case 'unbounded preceding':
      return 'unbounded preceding';
    case 'unbounded following':
      return 'unbounded following';
    case 'current row':
      return 'current row';
    case 'n_preceding':
      return `${num} preceding`;
    case 'n_following':
      return `${num} following`;
    default:
      return 'unbounded preceding';
  }
}

function parseIntervalUnit(bound: string | undefined): string | null {
  const m = bound?.match(/^INTERVAL \d+ (\w+) (PRECEDING|FOLLOWING)$/);
  return m ? m[1].toLowerCase() : null;
}

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

  const isMountedRef = useRef(false);

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      if (activeMode === 'cross') {
        const hasItems = localItems.some(
          (i) => i.type !== 'row' && (i.scenario || activeScenario) === activeScenario
        );
        if (!hasItems) {
          const defaults: Record<string, string> = {
            group: 'sum',
            sorted: 'sum',
            rank: 'row_number',
            period: 'period_yoy_value',
          };
          updateItem(0, { fn: defaults[activeScenario] || 'sum' });
        }
      }
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

  function boundOrderRank(type: string, value: number | null): number {
    switch (type) {
      case 'unbounded preceding':
        return -999999;
      case 'n_preceding':
        return -(value ?? 1);
      case 'current row':
        return 0;
      case 'n_following':
        return value ?? 1;
      case 'unbounded following':
        return 999999;
      default:
        return -999999;
    }
  }

  function validateFrameBounds(
    frameStart: string | undefined,
    frameEnd: string | undefined
  ): { frameStart: string; frameEnd: string } | null {
    if (!frameStart || !frameEnd) return null;
    const s = parseBound(frameStart);
    const e = parseBound(frameEnd);
    if (boundOrderRank(s.type, s.value) > boundOrderRank(e.type, e.value)) {
      return { frameStart: frameEnd, frameEnd: frameStart };
    }
    return null;
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
        const validated = validateFrameBounds(entry.frameStart, entry.frameEnd);
        if (validated) {
          entry.frameStart = validated.frameStart;
          entry.frameEnd = validated.frameEnd;
        }
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
          const validated = validateFrameBounds(updated.frameStart, updated.frameEnd);
          if (validated) {
            updated.frameStart = validated.frameStart;
            updated.frameEnd = validated.frameEnd;
          }
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
    const ordOpen = orderOpen[index];
    const timePrefix = Object.keys(TIME_WINDOW_DEFS).find((p) => currentFn.startsWith(p + '_'));
    const currentTimeWindow = timePrefix || 'ytd';
    const currentTimeAgg = timePrefix ? currentFn.slice(timePrefix.length + 1) : 'sum';
    const timeDef = TIME_WINDOW_DEFS[currentTimeWindow];
    const timeFieldValue = item.orderBy?.[0]?.field ?? '';
    const timeDateOptions = fieldCompletions.filter((c) => isTemporalDataFieldType(columnTypes[c]));

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

    const NUM_PLACEHOLDER: Record<string, string> = {
      ...FN_ARG2_LABELS,
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

        {/* Row 2: 计算函数 + 参数 — 时间智能场景专用 */}
        {scenario === 'time' ? (
          <div className="flex flex-col gap-2">
            {/* Row 2a: 时间字段 + 时间窗口 + 参数 */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                  {tr('calcFieldDateColumn', '时间字段')}
                </span>
                <GlassFieldSingleSelect
                  value={timeFieldValue}
                  options={timeDateOptions}
                  columnTypes={columnTypes}
                  onChange={(v) =>
                    updateItem(index, {
                      orderBy: v ? [{ field: v, direction: 'asc' }] : undefined,
                    })
                  }
                  placeholder={tr('calcFieldDatePlaceholder', '选择日期字段')}
                  className="h-7 w-28 text-[12px]"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                  {tr('calcFieldTimeWindow', '时间窗口')}
                </span>
                <GlassOptionSingleSelect
                  value={currentTimeWindow}
                  groups={[
                    {
                      key: 'timeWindow',
                      items: TIME_WINDOW_OPTIONS.map((o) => ({
                        value: o.value,
                        label: tr(o.key, o.label),
                      })),
                    },
                  ]}
                  onChange={(v) => {
                    const agg = currentTimeAgg;
                    const fn = `${v}_${agg}`;
                    const patch: Partial<CalculationRow> = { fn };
                    if (TIME_WINDOW_DEFS[v]?.hasParam && !item.fnArg2) patch.fnArg2 = '1';
                    updateItem(index, patch);
                  }}
                  className="h-7 text-[12px] w-28"
                />
                {timeDef?.hasParam && (
                  <GlassFormTextInput
                    inputMode="numeric"
                    value={item.fnArg2 || '1'}
                    onChange={(v) => {
                      const val = parseInt(v, 10);
                      if (isNaN(val) || val < 1) return;
                      updateItem(index, { fnArg2: String(val) });
                    }}
                    textCenter
                    className="h-7 w-14 rounded-md px-1 text-[12px]"
                  />
                )}
                {!timeDef?.hasParam && currentTimeWindow === 'ytd' && (
                  <>
                    <span className="text-[12px] text-text-muted shrink-0 leading-7">
                      {tr('calcFieldFiscalStart', '年度起始月')}
                    </span>
                    <GlassFormTextInput
                      inputMode="numeric"
                      value={String(item.fiscalStartMonth ?? '1')}
                      onChange={(v) => {
                        const val = parseInt(v, 10);
                        if (isNaN(val) || val < 1 || val > 12) return;
                        updateItem(index, { fiscalStartMonth: val });
                      }}
                      textCenter
                      className="h-7 w-14 rounded-md px-1 text-[12px]"
                    />
                  </>
                )}
              </div>
            </div>
            {/* Row 2b: 聚合函数 + 参数字段 */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                  {tr('calcFieldTimeAgg', '聚合函数')}
                </span>
                <GlassOptionSingleSelect
                  value={currentTimeAgg}
                  groups={[
                    {
                      key: 'timeAgg',
                      items: TIME_AGG_OPTIONS.map((o) => ({
                        value: o.value,
                        label: tr(o.key, o.label),
                      })),
                    },
                  ]}
                  onChange={(v) => {
                    updateItem(index, { fn: `${currentTimeWindow}_${v}` });
                  }}
                  className="h-7 text-[12px] w-28"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                  {tr('calcFieldFnArg', '参数字段')}
                </span>
                <div className="w-36">
                  <GlassFieldSingleSelect
                    value={item.fnArg ?? ''}
                    options={fieldCompletions}
                    columnTypes={columnTypes}
                    onChange={(v) => updateItem(index, { fnArg: v } as Partial<CalculationRow>)}
                    placeholder={tr('calcFieldFnArgPlaceholder', '选择字段')}
                    className="h-7 w-full text-[12px]"
                  />
                </div>
              </div>
            </div>
          </div>
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
                  ) : s.type === 'text' ? (
                    <GlassFormTextInput
                      value={item[s.key] ?? ''}
                      onChange={(v) => updateItem(index, { [s.key]: v } as Partial<CalculationRow>)}
                      placeholder={
                        NUM_PLACEHOLDER[currentFn + '_' + s.key] ||
                        tr('calcFieldFnArgNumPlaceholder', '参数')
                      }
                      className="h-7 rounded-md px-1.5 text-[12px] w-full"
                    />
                  ) : (
                    <GlassFormTextInput
                      inputMode="numeric"
                      value={item[s.key] ?? ''}
                      onChange={(v) => updateItem(index, { [s.key]: v } as Partial<CalculationRow>)}
                      placeholder={
                        NUM_PLACEHOLDER[currentFn + '_' + s.key] ||
                        tr('calcFieldFnArgNumPlaceholder', '参数')
                      }
                      className="h-7 rounded-md px-1.5 text-[12px] w-full"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Row 3: 分区范围 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
              {tr('calcFieldPartitionRange', '分区范围')}
            </span>
            <GlassOptionSingleSelect
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
                const cacheKey = `${scenario}_${index}`;
                if (v === 'all') {
                  lastPartitionByRef.current[cacheKey] = item.partitionBy;
                  updateItem(index, { partitionBy: undefined });
                } else {
                  updateItem(index, { partitionBy: lastPartitionByRef.current[cacheKey] ?? [] });
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
                <GlassTagBar
                  items={item.partitionBy ?? []}
                  onRemove={(col) =>
                    updateItem(index, {
                      partitionBy: item.partitionBy?.filter((c) => c !== col),
                    })
                  }
                  onClear={() => updateItem(index, { partitionBy: [] })}
                  open={!!partitionOpen[index]}
                  onToggle={() => setPartitionOpen((o) => ({ ...o, [index]: !o[index] }))}
                  toggleStyle="chevron"
                  density="compact"
                  className="min-h-7"
                  placeholder={tr('calcFieldPartitionPlaceholder', '选择分区字段')}
                />
                {!!partitionOpen[index] && (
                  <div className="absolute z-10 left-0 right-0 mt-0.5">
                    <GlassFieldMultiSelect
                      columns={fieldCompletions}
                      selected={item.partitionBy ?? []}
                      onChange={(v) =>
                        updateItem(index, { partitionBy: v.length > 0 ? v : undefined })
                      }
                      columnTypes={columnTypes}
                      maxHeight="160px"
                      variant="glass"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Row 4: 排序字段 (sorted, rank, period) */}
        {showOrderBy && scenario !== 'time' && (
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
                    <GlassFieldMultiSelect
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
                      variant="glass"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Row 5: 窗口帧 (sorted only) */}
        {scenario === 'sorted' &&
          (() => {
            const currentFt = item.frameType || 'rows';
            const framePresets = FRAME_PRESETS_BY_TYPE[currentFt] || FRAME_PRESETS_BY_TYPE.rows;
            const currentKey = `${item.frameStart ?? 'unbounded preceding'}|${item.frameEnd ?? 'unbounded following'}`;
            const isCustom = !framePresets
              .filter((p) => p.value !== 'custom')
              .some((p) => p.value === currentKey);
            const startInfo = parseBound(item.frameStart);
            const endInfo = parseBound(item.frameEnd);
            const unitLabel = frameTypeUnitLabel(currentFt, tr);
            const boundOptions = getBoundOptions(currentFt, tr);
            const orderByCol = item.orderBy?.[0]?.field;
            const isRangeDate =
              currentFt === 'range' &&
              !!orderByCol &&
              isTemporalDataFieldType(columnTypes[orderByCol]);
            const startIntervalUnit = parseIntervalUnit(item.frameStart);
            const endIntervalUnit = parseIntervalUnit(item.frameEnd);
            const effectiveStartUnit = startIntervalUnit || 'day';
            const effectiveEndUnit = endIntervalUnit || 'day';

            return (
              <div className="flex flex-col gap-2">
                {/* Row A: 窗口类型 + 窗口范围预设 */}
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                    {tr('calcFieldFrameType', '窗口类型')}
                  </span>
                  <GlassOptionSingleSelect
                    value={item.frameType || 'rows'}
                    groups={[
                      {
                        key: 'frameTypes',
                        items: FRAME_TYPE_OPTIONS.map((opt) => ({
                          value: opt.value,
                          label: tr(opt.key, opt.label),
                        })),
                      },
                    ]}
                    onChange={(v) => {
                      const prevFt = item.frameType || 'rows';
                      if (v === prevFt) return;
                      const key = `${item.frameStart ?? 'unbounded preceding'}|${item.frameEnd ?? 'unbounded following'}`;
                      const existsInNew = (FRAME_PRESETS_BY_TYPE[v] || []).some(
                        (p) => p.value !== 'custom' && p.value === key
                      );
                      updateItem(index, {
                        frameType: v as 'rows' | 'range' | 'groups',
                        ...(existsInNew
                          ? {}
                          : { frameStart: 'unbounded preceding', frameEnd: 'unbounded following' }),
                      });
                    }}
                    className="h-7 text-[12px] w-28"
                  />
                  <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                    {tr('calcFieldFrame', '窗口范围')}
                  </span>
                  <GlassOptionSingleSelect
                    value={isCustom ? 'custom' : currentKey}
                    groups={[
                      {
                        key: 'frame',
                        items: framePresets.map((p) => ({
                          value: p.value,
                          label: tr(p.key, p.label),
                        })),
                      },
                    ]}
                    onChange={(v) => {
                      if (v === 'custom') {
                        updateItem(index, { frameStart: '1 preceding', frameEnd: 'current row' });
                        return;
                      }
                      const [frameStart, frameEnd] = v.split('|');
                      updateItem(index, { frameStart, frameEnd });
                    }}
                    className="h-7 text-[12px] text-center w-28"
                  />
                  {/* EXCLUDE (有帧定义时) */}
                  {item.frameStart && item.orderBy?.length && (
                    <>
                      <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                        {tr('calcFieldFrameExclude', '排除方式')}
                      </span>
                      <GlassOptionSingleSelect
                        value={item.frameExclude || 'no others'}
                        groups={[
                          {
                            key: 'exclude',
                            items: EXCLUDE_OPTIONS.map((o) => ({
                              value: o.value,
                              label: tr(o.key, o.label),
                            })),
                          },
                        ]}
                        onChange={(v) =>
                          updateItem(index, { frameExclude: v as CalculationRow['frameExclude'] })
                        }
                        className="h-7 text-[12px] w-36"
                      />
                    </>
                  )}
                </div>

                {/* Row B: 自定义边界 */}
                {isCustom && (
                  <div className="flex items-center gap-2 text-[12px] text-text-muted flex-wrap">
                    <span className="text-[12px] text-text-muted shrink-0 w-16 h-7 leading-7">
                      {tr('calcFieldFrameConfig', '窗口配置')}
                    </span>
                    {/* 起始边界 */}
                    <div className="flex items-center gap-1">
                      <span className="shrink-0">{tr('calcFieldBoundStart', '起始')}</span>
                      <GlassOptionSingleSelect
                        value={startInfo.type}
                        groups={[{ key: 'bound', items: boundOptions }]}
                        onChange={(v) => {
                          const unit = isRangeDate ? effectiveStartUnit : undefined;
                          updateItem(index, {
                            frameStart: formatBoundFromType(v, startInfo.value, currentFt, unit),
                          });
                        }}
                        className="h-7 text-[12px] w-24"
                      />
                      {(startInfo.type === 'n_preceding' || startInfo.type === 'n_following') && (
                        <>
                          <GlassFormTextInput
                            inputMode="numeric"
                            value={String(startInfo.value ?? 1)}
                            onChange={(v) => {
                              const val = parseInt(v, 10);
                              if (isNaN(val) || val < 0) return;
                              const unit = isRangeDate ? effectiveStartUnit : undefined;
                              updateItem(index, {
                                frameStart: formatBoundFromType(
                                  startInfo.type,
                                  val,
                                  currentFt,
                                  unit
                                ),
                              });
                            }}
                            textCenter
                            className="h-6 w-14 rounded-md px-1 text-[12px]"
                          />
                          {isRangeDate ? (
                            <GlassOptionSingleSelect
                              value={effectiveStartUnit}
                              groups={[{ key: 'interval', items: INTERVAL_UNIT_OPTIONS }]}
                              onChange={(v) => {
                                updateItem(index, {
                                  frameStart: formatBoundFromType(
                                    startInfo.type,
                                    startInfo.value ?? 1,
                                    currentFt,
                                    v
                                  ),
                                });
                              }}
                              className="h-7 text-[12px] w-16"
                            />
                          ) : (
                            <span className="shrink-0 w-6">{unitLabel}</span>
                          )}
                        </>
                      )}
                    </div>

                    {/* 结束边界 */}
                    <div className="flex items-center gap-1">
                      <span className="shrink-0">{tr('calcFieldBoundEnd', '结束')}</span>
                      <GlassOptionSingleSelect
                        value={endInfo.type}
                        groups={[{ key: 'bound', items: boundOptions }]}
                        onChange={(v) => {
                          const unit = isRangeDate ? effectiveEndUnit : undefined;
                          updateItem(index, {
                            frameEnd: formatBoundFromType(v, endInfo.value, currentFt, unit),
                          });
                        }}
                        className="h-7 text-[12px] w-24"
                      />
                      {(endInfo.type === 'n_preceding' || endInfo.type === 'n_following') && (
                        <>
                          <GlassFormTextInput
                            inputMode="numeric"
                            value={String(endInfo.value ?? 1)}
                            onChange={(v) => {
                              const val = parseInt(v, 10);
                              if (isNaN(val) || val < 0) return;
                              const unit = isRangeDate ? effectiveEndUnit : undefined;
                              updateItem(index, {
                                frameEnd: formatBoundFromType(endInfo.type, val, currentFt, unit),
                              });
                            }}
                            textCenter
                            className="h-6 w-14 rounded-md px-1 text-[12px]"
                          />
                          {isRangeDate ? (
                            <GlassOptionSingleSelect
                              value={effectiveEndUnit}
                              groups={[{ key: 'interval', items: INTERVAL_UNIT_OPTIONS }]}
                              onChange={(v) => {
                                updateItem(index, {
                                  frameEnd: formatBoundFromType(
                                    endInfo.type,
                                    endInfo.value ?? 1,
                                    currentFt,
                                    v
                                  ),
                                });
                              }}
                              className="h-7 text-[12px] w-16"
                            />
                          ) : (
                            <span className="shrink-0 w-6">{unitLabel}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
      </div>
    );
  }

  function frameTypeUnitLabel(frameType: string, trFn: typeof tr): string {
    if (frameType === 'range') return trFn('calcFieldRangeUnit', '个值');
    if (frameType === 'groups') return trFn('calcFieldGroupsUnit', '组');
    return trFn('calcFieldRowsUnit', '行');
  }

  function getBoundOptions(
    frameType: string,
    trFn: typeof tr
  ): Array<{ value: string; label: string }> {
    const unboundedPre = trFn('calcFieldUnboundedPre', '到开头');
    const unboundedFoll = trFn('calcFieldUnboundedFoll', '到末尾');
    const nPreLabel =
      frameType === 'range'
        ? trFn('calcFieldNPreRange', '前N个值')
        : frameType === 'groups'
          ? trFn('calcFieldNPreGroups', '前N组')
          : trFn('calcFieldNPreRows', '前N行');
    const currentLabel =
      frameType === 'range'
        ? trFn('calcFieldCurrentRange', '当前值')
        : frameType === 'groups'
          ? trFn('calcFieldCurrentGroups', '当前组')
          : trFn('calcFieldCurrentRows', '当前行');
    const nFollLabel =
      frameType === 'range'
        ? trFn('calcFieldNFollRange', '后N个值')
        : frameType === 'groups'
          ? trFn('calcFieldNFollGroups', '后N组')
          : trFn('calcFieldNFollRows', '后N行');
    return [
      { value: 'unbounded preceding', label: unboundedPre },
      { value: 'n_preceding', label: nPreLabel },
      { value: 'current row', label: currentLabel },
      { value: 'n_following', label: nFollLabel },
      { value: 'unbounded following', label: unboundedFoll },
    ];
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

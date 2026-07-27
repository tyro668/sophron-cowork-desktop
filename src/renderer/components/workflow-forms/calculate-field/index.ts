export const FRAME_TYPE_OPTIONS = [
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

export const FRAME_PRESETS = [
  { value: 'unbounded preceding|unbounded following', label: '整个窗口', key: 'calcFieldFrameAll' },
  { value: 'custom', label: '自定义', key: 'calcFieldFrameCustom' },
];

export const EXCLUDE_OPTIONS = [
  { value: 'no others', key: 'calcFieldFrameExcludeNone', label: '不排除' },
  { value: 'current row', key: 'calcFieldFrameExcludeCurrent', label: '排除当前行' },
  { value: 'ties', key: 'calcFieldFrameExcludeTies', label: '仅排除同行值' },
  { value: 'group', key: 'calcFieldFrameExcludeGroup', label: '排除当前行和同行值' },
];

export const INTERVAL_UNIT_OPTIONS = [
  { value: 'day', key: 'intervalUnitDay', label: '天' },
  { value: 'week', key: 'intervalUnitWeek', label: '周' },
  { value: 'month', key: 'intervalUnitMonth', label: '月' },
  { value: 'year', key: 'intervalUnitYear', label: '年' },
];

export const TIME_WINDOW_OPTIONS: { value: string; label: string; key: string }[] = [
  { value: 'ytd', label: '年累计', key: 'timeWindowYtd' },
  { value: 'qtd', label: '季累计', key: 'timeWindowQtd' },
  { value: 'mtd', label: '月累计', key: 'timeWindowMtd' },
  { value: 'wtd', label: '周累计', key: 'timeWindowWtd' },
  { value: 'rolling_year', label: '近N年', key: 'timeWindowRollingYear' },
  { value: 'rolling_month', label: '近N月', key: 'timeWindowRollingMonth' },
  { value: 'rolling_day', label: '近N天', key: 'timeWindowRollingDay' },
  { value: 'rolling_week', label: '近N周', key: 'timeWindowRollingWeek' },
];

export const TIME_AGG_OPTIONS: { value: string; label: string; key: string }[] = [
  { value: 'sum', label: '求和', key: 'timeAggSum' },
  { value: 'avg', label: '平均', key: 'timeAggAvg' },
  { value: 'count', label: '计数', key: 'timeAggCount' },
  { value: 'min', label: '最小值', key: 'timeAggMin' },
  { value: 'max', label: '最大值', key: 'timeAggMax' },
  { value: 'distinct_count', label: '去重计数', key: 'timeAggDistinctCount' },
];

export const SCENARIO_OPTIONS = [
  {
    value: 'group_metrics',
    key: 'calcFieldScenarioGroupMetrics',
    label: '组内指标',
    tip: '按分区聚合数据：求和/平均/最大/最小/计数/去重计数/中位数/标准差/方差/众数/分位数/字符串聚合/逻辑与/逻辑或',
  },
  {
    value: 'ranking',
    key: 'calcFieldScenarioRanking',
    label: '排名与序号',
    tip: '行号、排名、密集排名、百分比排名、累积分布、分桶',
  },
  {
    value: 'cumulative',
    key: 'calcFieldScenarioCumulative',
    label: '累计',
    tip: '累计求和、累计平均、累计计数等，从第一行累计到当前行',
  },
  {
    value: 'offset',
    key: 'calcFieldScenarioOffset',
    label: '前后行',
    tip: '上一行值、下一行值、首值、末值、第N个值、与前N行差值/变化率',
  },
  {
    value: 'moving_window',
    key: 'calcFieldScenarioMovingWindow',
    label: '移动窗口',
    tip: '最近N行求和/平均、前后N行求和/平均、自定义窗口范围',
  },
  {
    value: 'period_compare',
    key: 'calcFieldScenarioPeriodCompare',
    label: '周期对比',
    tip: '同比值/率、环比值/率、自定义偏移差值/率',
  },
  {
    value: 'time_intel',
    key: 'calcFieldScenarioTimeIntel',
    label: '时间累计',
    tip: '年初至今、季初至今、月初至今、周初至今、近N年/月/日/周滚动累计',
  },
];

export const FUNCTION_CATEGORIES: Record<
  string,
  { key: string; header: string; items: string[] }[]
> = {
  group_metrics: [
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
  ranking: [
    {
      key: 'rank',
      header: 'calcFieldCatRank',
      items: ['row_number', 'rank', 'dense_rank', 'ntile', 'percent_rank', 'cume_dist'],
    },
  ],
  cumulative: [
    {
      key: 'agg',
      header: 'calcFieldCatAgg',
      items: ['sum', 'avg', 'count', 'min', 'max', 'product'],
    },
  ],
  offset: [
    {
      key: 'value',
      header: 'calcFieldCatValue',
      items: ['first_value', 'last_value', 'nth_value', 'lag', 'lead'],
    },
    { key: 'offset', header: 'calcFieldCatPeriod', items: ['offset_diff', 'offset_rate'] },
  ],
  moving_window: [
    { key: 'agg', header: 'calcFieldCatAgg', items: ['sum', 'avg', 'count', 'min', 'max'] },
  ],
  period_compare: [
    {
      key: 'period',
      header: 'calcFieldCatPeriod',
      items: [
        'period_yoy_value',
        'period_yoy_rate',
        'period_yoy_prev',
        'period_mom_value',
        'period_mom_rate',
        'period_mom_prev',
      ],
    },
  ],
  time_intel: [],
};

export { parseBound } from '@/shared/calculate-field/index';

export function formatBoundFromType(
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

export function parseIntervalUnit(bound: string | undefined): string | null {
  const m = bound?.match(/^INTERVAL \d+ (\w+) (PRECEDING|FOLLOWING)$/);
  return m ? m[1].toLowerCase() : null;
}

export function frameTypeUnitLabel(
  frameType: string,
  trFn: (key: string, fallback: string) => string
): string {
  if (frameType === 'range') return trFn('calcFieldRangeUnit', '个值');
  if (frameType === 'groups') return trFn('calcFieldGroupsUnit', '组');
  return trFn('calcFieldRowsUnit', '行');
}

export function getBoundOptions(
  frameType: string,
  trFn: (key: string, fallback: string) => string
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

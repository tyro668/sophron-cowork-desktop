export const FRAME_TYPE_OPTIONS = [
  { value: 'rows', key: 'calcFieldFrameRows', hint: 'calcFieldFrameRowsHint' },
  { value: 'range', key: 'calcFieldFrameRange', hint: 'calcFieldFrameRangeHint' },
  { value: 'groups', key: 'calcFieldFrameGroups', hint: 'calcFieldFrameGroupsHint' },
];

export const FRAME_PRESETS = [
  { value: 'unbounded preceding|unbounded following', key: 'calcFieldFrameAll' },
  { value: 'custom', key: 'calcFieldFrameCustom' },
];

export const EXCLUDE_OPTIONS = [
  { value: 'no others', key: 'calcFieldFrameExcludeNone' },
  { value: 'current row', key: 'calcFieldFrameExcludeCurrent' },
  { value: 'ties', key: 'calcFieldFrameExcludeTies' },
  { value: 'group', key: 'calcFieldFrameExcludeGroup' },
];

export const INTERVAL_UNIT_OPTIONS = [
  { value: 'day', key: 'intervalUnitDay' },
  { value: 'week', key: 'intervalUnitWeek' },
  { value: 'month', key: 'intervalUnitMonth' },
  { value: 'year', key: 'intervalUnitYear' },
];

export const TIME_WINDOW_OPTIONS: { value: string; key: string }[] = [
  { value: 'ytd', key: 'timeWindowYtd' },
  { value: 'qtd', key: 'timeWindowQtd' },
  { value: 'mtd', key: 'timeWindowMtd' },
  { value: 'wtd', key: 'timeWindowWtd' },
  { value: 'rolling_year', key: 'timeWindowRollingYear' },
  { value: 'rolling_month', key: 'timeWindowRollingMonth' },
  { value: 'rolling_day', key: 'timeWindowRollingDay' },
  { value: 'rolling_week', key: 'timeWindowRollingWeek' },
];

export const TIME_AGG_OPTIONS: { value: string; key: string }[] = [
  { value: 'sum', key: 'timeAggSum' },
  { value: 'avg', key: 'timeAggAvg' },
  { value: 'count', key: 'timeAggCount' },
  { value: 'min', key: 'timeAggMin' },
  { value: 'max', key: 'timeAggMax' },
  { value: 'distinct_count', key: 'timeAggDistinctCount' },
];

export const SCENARIO_OPTIONS = [
  { value: 'group_metrics', key: 'calcFieldScenarioGroupMetrics' },
  { value: 'ranking', key: 'calcFieldScenarioRanking' },
  { value: 'cumulative', key: 'calcFieldScenarioCumulative' },
  { value: 'offset', key: 'calcFieldScenarioOffset' },
  { value: 'moving_window', key: 'calcFieldScenarioMovingWindow' },
  { value: 'period_compare', key: 'calcFieldScenarioPeriodCompare' },
  { value: 'time_intel', key: 'calcFieldScenarioTimeIntel' },
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
    { key: 'special', header: 'calcFieldCatSpecial', items: ['percentage'] },
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

export function frameTypeUnitLabel(frameType: string, trFn: (key: string) => string): string {
  if (frameType === 'range') return trFn('calcFieldRangeUnit');
  if (frameType === 'groups') return trFn('calcFieldGroupsUnit');
  return trFn('calcFieldRowsUnit');
}

export function getBoundOptions(
  trFn: (key: string) => string
): Array<{ value: string; label: string }> {
  return [
    { value: 'unbounded preceding', label: trFn('calcFieldUnboundedPre') },
    { value: 'n_preceding', label: trFn('calcFieldNPreRows') },
    { value: 'current row', label: trFn('calcFieldCurrentRows') },
    { value: 'n_following', label: trFn('calcFieldNFollRows') },
    { value: 'unbounded following', label: trFn('calcFieldUnboundedFoll') },
  ];
}

import { formatCalculationStringLiteral } from './string-literal';
import {
  CALCULATION_FUNCTIONS,
  getCalculationFunctionArgumentSpec,
  MODERN_FUNCTION_WHITELIST,
  type ParamSpec,
} from './function-registry';

export interface CalculationConfigEntry {
  id?: string;
  field: string;
  expression: string;
  type?: 'row' | 'agg' | 'window' | 'cross';
  action?: 'add' | 'replace';
  fn?: string;
  fnArg?: string;
  fnArg2?: string;
  scenario?: string;
  partitionBy?: string[];
  orderBy?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  frameType?: 'rows' | 'range' | 'groups';
  frameStart?: string;
  frameEnd?: string;
  frameExclude?: 'current row' | 'group' | 'ties' | 'no others';
  fiscalStartMonth?: number;
}

export interface CalculationRow extends CalculationConfigEntry {
  id: string;
}

export const SCENARIO_MIGRATION: Record<string, string> = {
  group: 'group_metrics',
  sorted: 'moving_window',
  rank: 'ranking',
  period: 'period_compare',
  time: 'time_intel',
};

export const LEGACY_FUNCTION_WHITELIST: ReadonlySet<string> = new Set([
  'var_pop',
  'product',
  'period_yoy_value',
  'period_yoy_rate',
  'period_yoy_prev',
  'period_mom_value',
  'period_mom_rate',
  'period_mom_prev',
]);

const TIME_AGG_WHITELIST = new Set(['sum', 'avg', 'count', 'min', 'max', 'distinct_count']);

export function isAllowedCalculationFunction(fn: string): boolean {
  if (MODERN_FUNCTION_WHITELIST.has(fn) || LEGACY_FUNCTION_WHITELIST.has(fn)) return true;
  const prefix = Object.keys(TIME_WINDOW_DEFS).find((item) => fn.startsWith(`${item}_`));
  return Boolean(prefix && TIME_AGG_WHITELIST.has(fn.slice((prefix?.length ?? 0) + 1)));
}

function fieldRef(value: string): string {
  if (!/[\]`\\]/.test(value)) return `[${value}]`;
  const escaped = value.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  return `[\`${escaped}\`]`;
}

function numericArg(
  value: string | undefined,
  fallback: number = 1,
  rule: NonNullable<ParamSpec['numberRule']> = {}
): string {
  const raw = value?.trim() || String(fallback);
  if (!/^\d+(?:\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid numeric calculation argument '${raw}'`);
  }
  const parsed = Number(raw);
  const min = rule.min ?? 0;
  const max = rule.max ?? 1_000_000;
  if (
    !Number.isFinite(parsed) ||
    (rule.integer && !Number.isSafeInteger(parsed)) ||
    parsed < min ||
    parsed > max
  ) {
    throw new Error(`Calculation argument '${raw}' is outside the allowed range`);
  }
  return String(parsed);
}

function textArg(value: string | undefined): string {
  return formatCalculationStringLiteral(value ?? '');
}

export const TIME_WINDOW_DEFS: Record<
  string,
  {
    partitions: (f: string) => string;
    frame: (n: string) => string;
    hasParam: boolean;
  }
> = {
  ytd: {
    partitions: (f) => `year([${f}])`,
    frame: () => 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW',
    hasParam: false,
  },
  qtd: {
    partitions: (f) => `year([${f}]), quarter([${f}])`,
    frame: () => 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW',
    hasParam: false,
  },
  mtd: {
    partitions: (f) => `year([${f}]), month([${f}])`,
    frame: () => 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW',
    hasParam: false,
  },
  wtd: {
    partitions: (f) => `year([${f}]), week([${f}])`,
    frame: () => 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW',
    hasParam: false,
  },
  rolling_year: {
    partitions: () => '',
    frame: (n) => `RANGE BETWEEN INTERVAL ${n} YEAR PRECEDING AND CURRENT ROW`,
    hasParam: true,
  },
  rolling_month: {
    partitions: () => '',
    frame: (n) => `RANGE BETWEEN INTERVAL ${n} MONTH PRECEDING AND CURRENT ROW`,
    hasParam: true,
  },
  rolling_day: {
    partitions: () => '',
    frame: (n) => `RANGE BETWEEN INTERVAL ${n} DAY PRECEDING AND CURRENT ROW`,
    hasParam: true,
  },
  rolling_week: {
    partitions: () => '',
    frame: (n) => `RANGE BETWEEN INTERVAL ${n} WEEK PRECEDING AND CURRENT ROW`,
    hasParam: true,
  },
};

export function createCalculationId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  return `calc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createCalculationRow(): CalculationRow {
  return {
    id: createCalculationId(),
    field: '',
    expression: '',
    type: 'row',
    action: 'add',
    frameType: 'rows',
    frameStart: 'unbounded preceding',
    frameEnd: 'unbounded following',
    frameExclude: 'no others',
  };
}

export function normalizeCalculationEntries(
  entries: readonly CalculationConfigEntry[] | null | undefined
): CalculationRow[] {
  const seenIds = new Set<string>();
  return (entries ?? []).map((entry) => {
    const currentId = typeof entry.id === 'string' ? entry.id.trim() : '';
    let id = currentId || createCalculationId();
    while (seenIds.has(id)) {
      id = createCalculationId();
    }
    seenIds.add(id);
    return {
      id,
      field: typeof entry.field === 'string' ? entry.field : '',
      expression: typeof entry.expression === 'string' ? entry.expression : '',
      type:
        entry.type === 'agg' || entry.type === 'window' || entry.type === 'cross'
          ? entry.type
          : 'row',
      action: entry.action === 'replace' ? 'replace' : 'add',
      fn: typeof entry.fn === 'string' ? entry.fn : undefined,
      fnArg: typeof entry.fnArg === 'string' ? entry.fnArg : undefined,
      fnArg2: typeof entry.fnArg2 === 'string' ? entry.fnArg2 : undefined,
      scenario:
        typeof entry.scenario === 'string'
          ? SCENARIO_MIGRATION[entry.scenario] || entry.scenario
          : undefined,
      partitionBy: Array.isArray(entry.partitionBy) ? entry.partitionBy : undefined,
      orderBy: Array.isArray(entry.orderBy) ? entry.orderBy : undefined,
      frameType:
        entry.frameType === 'rows' || entry.frameType === 'range' || entry.frameType === 'groups'
          ? entry.frameType
          : undefined,
      frameStart: typeof entry.frameStart === 'string' ? entry.frameStart : undefined,
      frameEnd: typeof entry.frameEnd === 'string' ? entry.frameEnd : undefined,
      frameExclude:
        entry.frameExclude === 'current row' ||
        entry.frameExclude === 'group' ||
        entry.frameExclude === 'ties'
          ? entry.frameExclude
          : undefined,
      fiscalStartMonth:
        typeof entry.fiscalStartMonth === 'number' &&
        entry.fiscalStartMonth >= 1 &&
        entry.fiscalStartMonth <= 12
          ? entry.fiscalStartMonth
          : undefined,
    };
  });
}

/**
 * Converts legacy structured calculations into the unified expression model used by the form.
 * The execution layer still accepts the legacy fields while saved edits use expression text only.
 */
export function normalizeExpressionCalculationEntries(
  entries: readonly CalculationConfigEntry[] | null | undefined,
  sourceFields: readonly string[] = []
): CalculationRow[] {
  const rawEntries = entries ?? [];
  const sourceFieldsByName = new Map(
    sourceFields.map((field) => [field.trim().toLowerCase(), field] as const)
  );
  return normalizeCalculationEntries(rawEntries).map((entry, index) => {
    const explicitAction = rawEntries[index]?.action;
    const matchingSourceField = sourceFieldsByName.get(entry.field.trim().toLowerCase());
    const action = explicitAction ?? (matchingSourceField ? 'replace' : 'add');
    return {
      id: entry.id,
      field: action === 'replace' && matchingSourceField ? matchingSourceField : entry.field,
      action,
      expression:
        entry.expression.trim() || (entry.type !== 'row' && entry.fn ? exprFromParts(entry) : ''),
    };
  });
}

export function exprFromParts(item: CalculationRow): string {
  if (item.type === 'row') return item.expression || '';
  const fn = item.fn || 'sum';
  const partition = item.partitionBy?.filter(Boolean);
  const order = item.orderBy?.filter((o) => o.field);

  function overStr(useOrder: boolean, lowercase = false): string {
    const upper = (value: string): string => (lowercase ? value.toLowerCase() : value);
    const parts: string[] = [];
    if (partition?.length)
      parts.push(`${upper('PARTITION BY')} ${partition.map(fieldRef).join(', ')}`);
    if (useOrder && order?.length)
      parts.push(
        `${upper('ORDER BY')} ${order.map((o) => `${fieldRef(o.field)}${o.direction === 'desc' ? ' desc' : ''}`).join(', ')}`
      );
    if (item.frameStart && order?.length) {
      const ft = upper(item.frameType || 'rows');
      const start = lowerize(item.frameStart, lowercase);
      const end = lowerize(item.frameEnd || 'current row', lowercase);
      parts.push(`${ft} BETWEEN ${start} AND ${end}`);
    }
    if (item.frameExclude && item.frameExclude !== 'no others') {
      parts.push(`${upper('EXCLUDE')} ${upper(item.frameExclude)}`);
    }
    return parts.length > 0 ? ` ${upper('OVER')} (${parts.join(' ')})` : ` ${upper('OVER')} ()`;
  }

  function lowerize(value: string, lowercase: boolean): string {
    return lowercase ? value.toLowerCase() : value;
  }

  const fieldArg = item.fnArg || '*';
  const wrappedFieldArg = fieldArg === '*' ? fieldArg : fieldRef(fieldArg.replace(/^\[|\]$/g, ''));

  // percentage: [arg] / sum([arg]) OVER (...)  — no ORDER BY
  if (fn === 'percentage') {
    return `${wrappedFieldArg} / sum(${wrappedFieldArg})${overStr(false)}`;
  }

  // Period comparison types
  if (
    fn === 'period_mom_value' ||
    fn === 'period_mom_rate' ||
    fn === 'period_mom_prev' ||
    fn === 'period_yoy_value' ||
    fn === 'period_yoy_rate' ||
    fn === 'period_yoy_prev'
  ) {
    const isRate = fn.endsWith('_rate');
    const isPrev = fn.endsWith('_prev');
    const isYoy = fn.startsWith('period_yoy');
    const dateField = order?.[0]?.field;
    if (dateField && isYoy) {
      const userPart = partition?.length ? `${partition.map(fieldRef).join(', ')}, ` : '';
      const dateRef = fieldRef(dateField);
      const datePart = `PARTITION BY ${userPart}extract('month' FROM ${dateRef}), extract('day' FROM ${dateRef})`;
      const yearExpr = `extract('year' FROM ${dateRef})`;
      const lag = `lag(${wrappedFieldArg}) OVER (${datePart} ORDER BY ${yearExpr})`;
      const yearLag = `lag(${yearExpr}) OVER (${datePart} ORDER BY ${yearExpr})`;
      const guard = `CASE WHEN (${yearExpr} - ${yearLag}) = 1 THEN `;
      if (isPrev) return `${guard}${lag} ELSE NULL END`;
      if (isRate) return `${guard}(${wrappedFieldArg} - ${lag}) / nullif(${lag}, 0) ELSE NULL END`;
      return `${guard}${wrappedFieldArg} - ${lag} ELSE NULL END`;
    }
    const lag = `lag(${wrappedFieldArg})${overStr(true)}`;
    if (isPrev) return lag;
    if (isRate) return `(${wrappedFieldArg} - ${lag}) / nullif(${lag}, 0)`;
    return `${wrappedFieldArg} - ${lag}`;
  }

  // Time intelligence: ytd_sum, qtd_avg, rolling_year_count, etc.
  const prefix = Object.keys(TIME_WINDOW_DEFS).find((p) => fn.startsWith(p + '_'));
  if (prefix) {
    const def = TIME_WINDOW_DEFS[prefix];
    const agg = fn.slice(prefix.length + 1);
    if (!TIME_AGG_WHITELIST.has(agg)) {
      throw new Error(`Unsupported aggregation '${agg}' in time window calculation`);
    }
    const dateField = order?.[0]?.field;
    if (!dateField) return `${agg}(${wrappedFieldArg}) OVER ()`;
    const n = def.hasParam
      ? numericArg(item.fnArg2, 1, { integer: true, min: 1, max: 1_000_000 })
      : '';
    let partitionStr = def.partitions(dateField);
    const fiscalMonth = item.fiscalStartMonth;
    if (prefix === 'ytd' && fiscalMonth && fiscalMonth > 1) {
      const dateRef = fieldRef(dateField);
      partitionStr = `CASE WHEN month(${dateRef}) >= ${fiscalMonth} THEN year(${dateRef}) ELSE year(${dateRef}) - 1 END`;
    }
    const aggFn =
      agg === 'distinct_count'
        ? `count(DISTINCT ${wrappedFieldArg})`
        : `${agg}(${wrappedFieldArg})`;
    const fullPartition = [partitionStr, ...(partition?.map(fieldRef) ?? [])]
      .filter(Boolean)
      .join(', ');
    const partitionClause = fullPartition ? `PARTITION BY ${fullPartition} ` : '';
    return `${aggFn} OVER (${partitionClause}ORDER BY ${fieldRef(dateField)} ${def.frame(n)})`;
  }
  // Generic: fn(args) OVER (PARTITION BY ... ORDER BY ...)
  const fnSqlMap: Record<string, string> = {
    var: 'var_pop',
  };
  const noArgRankingFns = new Set(
    CALCULATION_FUNCTIONS.filter(
      (d) => d.category === 'ranking' && d.valueArgument === 'none' && !d.extraParameter
    ).map((d) => d.id)
  );
  const domainFns = new Set(
    CALCULATION_FUNCTIONS.filter((d) => d.category === 'offset' || d.category === 'ranking').map(
      (d) => d.id
    )
  );
  let fnCall: string;
  if (noArgRankingFns.has(fn)) {
    fnCall = `${fn}()`;
  } else if (fn === 'count_distinct') {
    fnCall = `count(DISTINCT ${wrappedFieldArg})`;
  } else {
    if (!isAllowedCalculationFunction(fn)) {
      throw new Error(`Unsupported function '${fn}' in calculation expression`);
    }
    const sqlFn = fnSqlMap[fn] || fn;
    const specs = getCalculationFunctionArgumentSpec(fn);
    const args = specs
      .map((s) => {
        const raw = item[s.key];
        if (s.type === 'number') {
          if ((fn === 'lag' || fn === 'lead') && !raw) return '';
          return numericArg(raw, fn === 'ntile' ? 2 : 1, s.numberRule);
        }
        if (!raw) return s.type === 'field' ? '*' : '';
        if (s.type === 'field') return fieldRef(raw.replace(/^\[|\]$/g, ''));
        return textArg(raw);
      })
      .filter((a) => a !== '');
    fnCall = `${sqlFn}(${args.join(', ')})`;
  }
  const over = overStr(true, domainFns.has(fn));
  return fnCall + over;
}

export function parseBound(bound: string | undefined): { type: string; value: number | null } {
  const normalized = bound?.trim().toLowerCase();
  if (!normalized || normalized === 'unbounded preceding')
    return { type: 'unbounded preceding', value: null };
  if (normalized === 'unbounded following') return { type: 'unbounded following', value: null };
  if (normalized === 'current row') return { type: 'current row', value: null };
  const m = normalized.match(/^(\d+) preceding$/);
  if (m && isAllowedBoundOffset(m[1])) return { type: 'n_preceding', value: Number(m[1]) };
  const n = normalized.match(/^(\d+) following$/);
  if (n && isAllowedBoundOffset(n[1])) return { type: 'n_following', value: Number(n[1]) };
  const interval = normalized.match(
    /^interval (\d+) (day|week|month|quarter|year) (preceding|following)$/
  );
  if (interval && isAllowedBoundOffset(interval[1]))
    return {
      type: interval[3] === 'preceding' ? 'n_preceding' : 'n_following',
      value: Number(interval[1]),
    };
  return { type: 'invalid', value: null };
}

function isAllowedBoundOffset(value: string): boolean {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000_000;
}

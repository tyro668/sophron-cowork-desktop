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

export interface CalculationRow {
  id: string;
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

export interface ParamSpec {
  key: 'fnArg' | 'fnArg2';
  type: 'field' | 'number' | 'text';
}

export const FN_ARG_SPEC: Record<string, ParamSpec[]> = {
  '*': [{ key: 'fnArg', type: 'field' }],
  ntile: [{ key: 'fnArg', type: 'number' }],
  nth_value: [
    { key: 'fnArg', type: 'field' },
    { key: 'fnArg2', type: 'number' },
  ],
  quantile_cont: [
    { key: 'fnArg', type: 'field' },
    { key: 'fnArg2', type: 'number' },
  ],
  lag: [
    { key: 'fnArg', type: 'field' },
    { key: 'fnArg2', type: 'number' },
  ],
  lead: [
    { key: 'fnArg', type: 'field' },
    { key: 'fnArg2', type: 'number' },
  ],
  offset_diff: [
    { key: 'fnArg', type: 'field' },
    { key: 'fnArg2', type: 'number' },
  ],
  offset_rate: [
    { key: 'fnArg', type: 'field' },
    { key: 'fnArg2', type: 'number' },
  ],
  string_agg: [
    { key: 'fnArg', type: 'field' },
    { key: 'fnArg2', type: 'text' },
  ],
};

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
      scenario: typeof entry.scenario === 'string' ? entry.scenario : undefined,
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

export function exprFromParts(item: CalculationRow): string {
  if (item.type === 'row') return item.expression || '';
  const fn = item.fn || 'sum';
  const partition = item.partitionBy?.filter(Boolean);
  const order = item.orderBy?.filter((o) => o.field);

  function overStr(useOrder: boolean): string {
    const parts: string[] = [];
    if (partition?.length) parts.push(`PARTITION BY [${partition.join('], [')}]`);
    if (useOrder && order?.length)
      parts.push(
        `ORDER BY ${order.map((o) => `[${o.field}]${o.direction === 'desc' ? ' desc' : ''}`).join(', ')}`
      );
    if (item.frameStart && order?.length) {
      const ft = (item.frameType || 'rows').toUpperCase();
      const end = item.frameEnd || 'current row';
      parts.push(`${ft} BETWEEN ${item.frameStart} AND ${end}`);
    }
    if (item.frameExclude && item.frameExclude !== 'no others') {
      parts.push(`EXCLUDE ${item.frameExclude.toUpperCase()}`);
    }
    return parts.length > 0 ? ` OVER (${parts.join(' ')})` : ' OVER ()';
  }

  // Special branches: percentage, period comparison, count_distinct
  // These compile to complex expressions beyond generic fn(args) OVER (...)
  const fieldArg = item.fnArg || '*';
  const wrappedFieldArg = fieldArg === '*' || fieldArg.startsWith('[') ? fieldArg : `[${fieldArg}]`;

  // percentage: [arg] / sum([arg]) OVER (...)  — no ORDER BY
  if (fn === 'percentage') {
    return `${wrappedFieldArg} / sum(${wrappedFieldArg})${overStr(false)}`;
  }

  // Period comparison types
  if (
    fn === 'period_mom_value' ||
    fn === 'period_mom_rate' ||
    fn === 'period_yoy_value' ||
    fn === 'period_yoy_rate'
  ) {
    const offset = fn === 'period_mom_value' || fn === 'period_mom_rate' ? 1 : 12;
    const isRate = fn.endsWith('_rate');
    const lag = `lag(${wrappedFieldArg}, ${offset})${overStr(true)}`;
    if (isRate) return `(${wrappedFieldArg} - ${lag}) / ${lag}`;
    return `${wrappedFieldArg} - ${lag}`;
  }

  // Custom offset types
  if (fn === 'offset_diff' || fn === 'offset_rate') {
    const offset = parseInt(item.fnArg2 || '1', 10);
    const isRate = fn === 'offset_rate';
    const lag = `lag(${wrappedFieldArg}, ${offset})${overStr(true)}`;
    if (isRate) return `(${wrappedFieldArg} - ${lag}) / ${lag}`;
    return `${wrappedFieldArg} - ${lag}`;
  }
  // Time intelligence: ytd_sum, qtd_avg, rolling_year_count, etc.
  const prefix = Object.keys(TIME_WINDOW_DEFS).find((p) => fn.startsWith(p + '_'));
  if (prefix) {
    const def = TIME_WINDOW_DEFS[prefix];
    const agg = fn.slice(prefix.length + 1);
    const dateField = order?.[0]?.field;
    if (!dateField) return `${agg}(${wrappedFieldArg}) OVER ()`;
    const n = def.hasParam ? item.fnArg2 || '1' : '';
    let partitionStr = def.partitions(dateField);
    // Fiscal year: override partition for non-rolling windows
    const fiscalMonth = item.fiscalStartMonth;
    if (prefix === 'ytd' && fiscalMonth && fiscalMonth > 1) {
      partitionStr = `CASE WHEN month([${dateField}]) >= ${fiscalMonth} THEN year([${dateField}]) ELSE year([${dateField}]) - 1 END`;
    }
    const aggFn =
      agg === 'distinct_count'
        ? `count(DISTINCT ${wrappedFieldArg})`
        : `${agg}(${wrappedFieldArg})`;
    const fullPartition = [partitionStr, ...(partition?.map((p) => `[${p}]`) ?? [])]
      .filter(Boolean)
      .join(', ');
    const partitionClause = fullPartition ? `PARTITION BY ${fullPartition} ` : '';
    return `${aggFn} OVER (${partitionClause}ORDER BY [${dateField}] ${def.frame(n)})`;
  }
  // Generic: fn(args) OVER (PARTITION BY ... ORDER BY ...)
  const fnSqlMap: Record<string, string> = {
    var: 'var_pop',
  };
  const noArgFns = new Set(['row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist']);
  let fnCall: string;
  if (noArgFns.has(fn)) {
    fnCall = `${fn}()`;
  } else if (fn === 'count_distinct') {
    fnCall = `count(DISTINCT ${wrappedFieldArg})`;
  } else {
    const sqlFn = fnSqlMap[fn] || fn;
    const specs = FN_ARG_SPEC[fn] || FN_ARG_SPEC['*'];
    const args = specs
      .map((s) => {
        const raw = item[s.key];
        if (!raw) return s.type === 'field' ? '*' : '';
        if (s.type === 'field') return raw.startsWith('[') ? raw : `[${raw}]`;
        return raw;
      })
      .filter((a) => a !== '');
    fnCall = `${sqlFn}(${args.join(', ')})`;
  }
  const over = overStr(true);
  return fnCall + over;
}

export function needsCalculationIdNormalization(
  entries: readonly CalculationConfigEntry[] | null | undefined
): boolean {
  const seenIds = new Set<string>();
  for (const entry of entries ?? []) {
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id || seenIds.has(id)) {
      return true;
    }
    seenIds.add(id);
  }
  return false;
}

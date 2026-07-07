export interface CalculationConfigEntry {
  id?: string;
  field: string;
  expression: string;
  type?: 'row' | 'agg' | 'window' | 'cross';
  action?: 'add' | 'replace';
  fn?: string;
  fnArg?: string;
  fnArg2?: string;
  partitionBy?: string[];
  orderBy?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  frameStart?: string;
  frameEnd?: string;
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
  partitionBy?: string[];
  orderBy?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  frameStart?: string;
  frameEnd?: string;
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
      partitionBy: Array.isArray(entry.partitionBy) ? entry.partitionBy : undefined,
      orderBy: Array.isArray(entry.orderBy) ? entry.orderBy : undefined,
      frameStart: typeof entry.frameStart === 'string' ? entry.frameStart : undefined,
      frameEnd: typeof entry.frameEnd === 'string' ? entry.frameEnd : undefined,
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
      const end = item.frameEnd || 'current row';
      parts.push(`ROWS BETWEEN ${item.frameStart} AND ${end}`);
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

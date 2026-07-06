export interface CalculationConfigEntry {
  id?: string;
  field: string;
  expression: string;
  type?: 'row' | 'agg' | 'window' | 'cross';
  action?: 'add' | 'replace';
  fn?: string;
  fnArg?: string;
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
  partitionBy?: string[];
  orderBy?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  frameStart?: string;
  frameEnd?: string;
}

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
  const arg = item.fnArg || '*';
  const wrappedArg = arg === '*' || arg.startsWith('[') ? arg : `[${arg}]`;
  const partition = item.partitionBy?.filter(Boolean);
  const order = item.orderBy?.filter((o) => o.field);

  function overStr(useOrder: boolean): string {
    const parts: string[] = [];
    if (partition?.length) parts.push(`PARTITION BY [${partition.join('], [')}]`);
    if (useOrder && order?.length)
      parts.push(
        `ORDER BY ${order.map((o) => `[${o.field}]${o.direction === 'desc' ? ' desc' : ''}`).join(', ')}`
      );
    return parts.length ? ` OVER (${parts.join(' ')})` : '';
  }

  // percentage: [arg] / sum([arg]) OVER (PARTITION BY ...)  — no ORDER BY
  if (fn === 'percentage') {
    return `${wrappedArg} / sum(${wrappedArg})${overStr(false)}`;
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
    const lag = `lag(${wrappedArg}, ${offset})${overStr(true)}`;
    if (isRate) return `(${wrappedArg} - ${lag}) / ${lag}`;
    return `${wrappedArg} - ${lag}`;
  }

  // Generic: fn([arg]) OVER (PARTITION BY ... ORDER BY ...)
  const fnCall = fn === 'count_distinct' ? `count(DISTINCT ${wrappedArg})` : `${fn}(${wrappedArg})`;
  const over = overStr(true);
  let result = fnCall + over;
  if (item.type === 'window' && item.frameStart && order?.length) {
    const end = item.frameEnd || 'current row';
    result += ` ROWS BETWEEN ${item.frameStart} AND ${end}`;
  }
  return result;
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

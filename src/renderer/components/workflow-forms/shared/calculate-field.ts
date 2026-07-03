export interface CalculationConfigEntry {
  id?: string;
  field: string;
  expression: string;
  type?: 'row' | 'agg' | 'window';
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
  type?: 'row' | 'agg' | 'window';
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
      type: entry.type === 'agg' || entry.type === 'window' ? entry.type : 'row',
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
  const fnCall = fn === 'count_distinct' ? `count(DISTINCT ${arg})` : `${fn}(${arg})`;
  const parts: string[] = [fnCall];
  const partition = item.partitionBy?.filter(Boolean);
  const order = item.orderBy?.filter((o) => o.field);
  const over: string[] = [];
  if (partition?.length) over.push(`PARTITION BY [${partition.join('], [')}]`);
  if (order?.length)
    over.push(
      `ORDER BY ${order.map((o) => `[${o.field}]${o.direction === 'desc' ? ' desc' : ''}`).join(', ')}`
    );
  parts.push(`OVER (${over.join(' ')})`);
  if (item.type === 'window' && item.frameStart && order?.length) {
    const end = item.frameEnd || 'current row';
    parts.push(`ROWS BETWEEN ${item.frameStart} AND ${end}`);
  }
  return parts.join(' ');
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

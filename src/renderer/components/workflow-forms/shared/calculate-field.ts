export interface CalculationConfigEntry {
  id?: string;
  field: string;
  expression: string;
}

export interface CalculationRow {
  id: string;
  field: string;
  expression: string;
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
    };
  });
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

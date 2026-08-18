export interface CalculationConfigEntry {
  id?: string;
  field: string;
  expression: string;
  action?: 'add' | 'replace';
}

export interface CalculationRow extends CalculationConfigEntry {
  id: string;
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
    action: 'add',
  };
}

/**
 * Normalizes structured calculation config into the unified expression model used
 * by the form. The persisted contract is { id, field, expression, action }.
 */
export function normalizeCalculationEntries(
  entries: readonly CalculationConfigEntry[] | null | undefined,
  sourceFields: readonly string[] = []
): CalculationRow[] {
  const seenIds = new Set<string>();
  const sourceFieldsByName = new Map(
    sourceFields.map((field) => [field.trim().toLowerCase(), field] as const)
  );
  return (entries ?? []).map((entry) => {
    const currentId = typeof entry.id === 'string' ? entry.id.trim() : '';
    const field = typeof entry.field === 'string' ? entry.field : '';
    const expression = typeof entry.expression === 'string' ? entry.expression : '';
    let id = currentId || createCalculationId();
    while (seenIds.has(id)) {
      id = createCalculationId();
    }
    seenIds.add(id);
    const matchingSourceField = sourceFieldsByName.get(field.trim().toLowerCase());
    const action =
      entry.action === 'add' || entry.action === 'replace'
        ? entry.action
        : matchingSourceField
          ? 'replace'
          : 'add';
    return {
      id,
      field: action === 'replace' && matchingSourceField ? matchingSourceField : field,
      action,
      expression,
    };
  });
}

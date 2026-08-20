export type AggregateDateGranularity = 'year' | 'quarter' | 'month' | 'week' | 'day';

export function retainSelectedDateGranularity(
  granularity: Readonly<Record<string, string>> | undefined,
  selectedFields: readonly string[]
): Record<string, string> | undefined {
  if (!granularity) return undefined;
  const retained = Object.fromEntries(
    Object.entries(granularity).filter(([field]) => selectedFields.includes(field))
  );
  return Object.keys(retained).length > 0 ? retained : undefined;
}

export function setDateGranularity(
  granularity: Readonly<Record<string, string>> | undefined,
  field: string,
  value: AggregateDateGranularity | ''
): Record<string, string> | undefined {
  const next = { ...granularity };
  if (value) next[field] = value;
  else delete next[field];
  return Object.keys(next).length > 0 ? next : undefined;
}

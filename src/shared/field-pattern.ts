/** Rule-based column picking for select / unpivot: by type and/or name pattern. */
export type FieldTypeFilter = '' | 'text' | 'number' | 'temporal' | 'boolean';

const TYPE_GROUPS: Record<Exclude<FieldTypeFilter, ''>, readonly string[]> = {
  text: ['text', 'varchar', 'string'],
  number: ['integer', 'float', 'decimal', 'bigint', 'double'],
  temporal: ['date', 'datetime', 'timestamp'],
  boolean: ['boolean'],
};

/**
 * Pattern syntax: `/regex/` (case-insensitive), glob with `*` / `?`, or a
 * plain substring. An empty pattern matches every name.
 */
export function compileFieldPattern(pattern: string): ((name: string) => boolean) | null {
  const text = pattern.trim();
  if (!text) return () => true;
  if (text.length > 2 && text.startsWith('/') && text.endsWith('/')) {
    try {
      const re = new RegExp(text.slice(1, -1), 'i');
      return (name) => re.test(name);
    } catch {
      return null;
    }
  }
  if (/[*?]/.test(text)) {
    const re = new RegExp(
      `^${text
        .split('')
        .map((ch) =>
          ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
        )
        .join('')}$`,
      'i'
    );
    return (name) => re.test(name);
  }
  const lower = text.toLowerCase();
  return (name) => name.toLowerCase().includes(lower);
}

export function matchFields(
  fields: readonly string[],
  columnTypes: Record<string, string> | undefined,
  rule: { type: FieldTypeFilter; pattern: string }
): string[] {
  const byName = compileFieldPattern(rule.pattern);
  if (!byName) return [];
  return fields.filter((field) => {
    if (!byName(field)) return false;
    if (!rule.type) return true;
    const type = (columnTypes?.[field] ?? '').toLowerCase();
    return TYPE_GROUPS[rule.type].includes(type);
  });
}

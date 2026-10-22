import { dataFieldTypeOfSpelling, type DataFieldType } from './data-field-types';
/** Rule-based column picking for select / unpivot: by type and/or name pattern. */
export type FieldTypeFilter = '' | 'text' | 'number' | 'temporal' | 'boolean';

const TYPE_GROUPS: Record<Exclude<FieldTypeFilter, ''>, readonly DataFieldType[]> = {
  text: ['text'],
  number: ['integer', 'float', 'decimal'],
  temporal: ['date', 'datetime'],
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
    const type = dataFieldTypeOfSpelling(columnTypes?.[field]);
    return type !== null && TYPE_GROUPS[rule.type].includes(type);
  });
}

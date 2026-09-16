import { tokenizeExpression } from '../expression-tokenizer';
import { unwrapFieldName } from '../prep-dsl/syntax/fields';

/**
 * Extract field names referenced by an expression string (filter condition,
 * derive expression, aggregate metric, ...). Qualified refs `[a].[b]` yield `b`
 * — side checks are handled separately by the schema validator. Returns an
 * empty list for unparseable input; syntax errors are reported separately by
 * the caller.
 */
export function extractExpressionFieldNames(expression: string): string[] {
  try {
    const tokens = tokenizeExpression(expression);
    const names: string[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.type !== 'FieldRef') continue;
      const qualifiedName =
        tokens[index + 1]?.type === 'Dot' && tokens[index + 2]?.type === 'FieldRef'
          ? tokens[index + 2].value
          : token.value;
      if (qualifiedName !== token.value) index += 2;
      const name = unwrapFieldName(qualifiedName);
      if (name) names.push(name);
    }
    return names;
  } catch {
    return [];
  }
}

/** Extract qualified `[source].[field]` references, keyed by source alias. */
export function extractQualifiedFieldRefs(expression: string): { source: string; name: string }[] {
  try {
    const tokens = tokenizeExpression(expression);
    const refs: { source: string; name: string }[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.type !== 'FieldRef') continue;
      if (tokens[index + 1]?.type === 'Dot' && tokens[index + 2]?.type === 'FieldRef') {
        const source = unwrapFieldName(token.value);
        const name = unwrapFieldName(tokens[index + 2].value);
        if (source && name) refs.push({ source, name });
        index += 2;
      }
    }
    return refs;
  } catch {
    return [];
  }
}

export function isExpressionSyntaxValid(expression: string): boolean {
  try {
    tokenizeExpression(expression);
    return true;
  } catch {
    return false;
  }
}

export function normalizePlanColumnType(type: string): string {
  return type.trim().toLowerCase();
}

/** Normalize a physical/DuckDB type name into the DSL type vocabulary. */
export function normalizePlanDslType(type: string): string {
  const normalized = normalizePlanColumnType(type);
  if (['varchar', 'char', 'string', 'text'].includes(normalized)) return 'text';
  if (['int', 'integer', 'bigint', 'smallint', 'tinyint', 'hugeint'].includes(normalized)) {
    return 'integer';
  }
  if (['double', 'float', 'real'].includes(normalized)) return 'float';
  if (normalized === 'number') return 'decimal';
  if (normalized.startsWith('decimal') || normalized.startsWith('numeric')) return 'decimal';
  if (normalized.includes('timestamp') || normalized === 'datetime') return 'datetime';
  if (normalized === 'date') return 'date';
  if (['bool', 'boolean'].includes(normalized)) return 'boolean';
  return normalized;
}

export type PlanTypeFamily = 'numeric' | 'temporal' | 'text' | 'boolean' | 'other';

export function planTypeFamily(type: string | undefined): PlanTypeFamily {
  if (!type) return 'other';
  const normalized = normalizePlanDslType(type);
  if (normalized === 'integer' || normalized === 'float' || normalized === 'decimal') {
    return 'numeric';
  }
  if (normalized === 'date' || normalized === 'datetime') return 'temporal';
  if (normalized === 'text') return 'text';
  if (normalized === 'boolean') return 'boolean';
  return 'other';
}

import {
  quoteIdentifier,
  objectArray,
  isRecord,
  getRightPrefix,
  getConflictAlias,
  lastQualifiedPart,
} from './utils';
import { parseFieldRef } from '../../../shared/prep-dsl/parser';

export function compileSetOpSql(
  output: string,
  left: string,
  right: string,
  config: Record<string, unknown>
): string {
  const operation = String(config.operation ?? 'union').toUpperCase();
  const mode = config.mode === 'all' ? ' ALL' : '';
  const byName = operation === 'UNION' && config.match === 'by_name' ? ' BY NAME' : '';
  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${left} ${operation}${mode}${byName} SELECT * FROM ${right}`;
}

export function compileJoinConditionList(value: unknown): string {
  const conditions = objectArray(value);
  return (
    conditions
      .flatMap((condition) => {
        if (typeof condition.left !== 'string' || typeof condition.right !== 'string') return [];
        const leftRef = parseFieldRef(condition.left);
        const rightRef = parseFieldRef(condition.right);
        const leftName = leftRef?.name ?? lastQualifiedPart(condition.left);
        const rightName = rightRef?.name ?? lastQualifiedPart(condition.right);
        return [`l.${quoteIdentifier(leftName)} = r.${quoteIdentifier(rightName)}`];
      })
      .join(' AND ') || 'true'
  );
}

export function compileJoinProjection(
  keep: unknown,
  leftColumns: string[],
  rightColumns: string[],
  conflict: unknown,
  rightAlias?: string
): string {
  const items = objectArray(keep);
  if (items.length === 0) {
    const isSuffix = isRecord(conflict) && conflict.strategy === 'suffix';
    if (isSuffix) {
      return [
        ...leftColumns.map(
          (column) =>
            `l.${quoteIdentifier(column)} AS ${quoteIdentifier(getConflictAlias(conflict, 'left', column))}`
        ),
        ...rightColumns.map(
          (column) =>
            `r.${quoteIdentifier(column)} AS ${quoteIdentifier(getConflictAlias(conflict, 'right', column))}`
        ),
      ].join(', ');
    }
    const rightPrefix = getRightPrefix(conflict);
    return [
      'l.*',
      ...rightColumns.map(
        (column) => `r.${quoteIdentifier(column)} AS ${quoteIdentifier(`${rightPrefix}${column}`)}`
      ),
    ].join(', ');
  }
  return items
    .flatMap((item) => {
      if (item.side === 'left' && item.wildcard) return ['l.*'];
      if (item.side === 'right' && item.wildcard) return ['r.*'];
      if (typeof item.source !== 'string') return [];
      const ref = parseFieldRef(item.source);
      const fieldName = ref?.name ?? lastQualifiedPart(item.source);
      const side =
        ref?.source && rightAlias && ref.source === rightAlias
          ? 'r'
          : ref?.source
            ? 'l'
            : leftColumns.includes(fieldName)
              ? 'l'
              : 'r';
      const conflictSide = side === 'r' ? 'right' : 'left';
      const alias =
        typeof item.alias === 'string'
          ? (parseFieldRef(item.alias)?.name ?? item.alias)
          : getConflictAlias(conflict, conflictSide, fieldName);
      return [`${side}.${quoteIdentifier(fieldName)} AS ${quoteIdentifier(alias)}`];
    })
    .join(', ');
}

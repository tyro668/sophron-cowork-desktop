import {
  quoteIdentifier,
  objectArray,
  isRecord,
  getRightPrefix,
  getConflictAlias,
  lastQualifiedPart,
} from './utils';
import { parseFieldRef } from '../../../shared/prep-dsl/parser';
import { SetOpConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileSetOpSql(
  output: string,
  left: string,
  right: string,
  config: Record<string, unknown>,
  leftColumns?: string[],
  rightColumns?: string[]
): string {
  const parsed = parseOperatorConfig(SetOpConfigSchema, config);
  const operation = parsed.operation.toUpperCase();
  const mode = parsed.mode === 'all' ? ' ALL' : '';
  const match = parsed.operation === 'union' ? parsed.match : 'by_position';

  if (operation === 'UNION' && match === 'by_name') {
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${left} ${operation}${mode} BY NAME SELECT * FROM ${right}`;
  }

  if (leftColumns && rightColumns && leftColumns.length !== rightColumns.length) {
    throw new Error(
      `${operation} by position requires the same number of columns on both sides (left: ${leftColumns.length}, right: ${rightColumns.length})`
    );
  }

  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${left} ${operation}${mode} SELECT * FROM ${right}`;
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
        item.side === 'right'
          ? 'r'
          : item.side === 'left'
            ? 'l'
            : ref?.source && rightAlias && ref.source === rightAlias
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

import { quoteIdentifier, objectArray, getRightPrefix, lastQualifiedPart } from './utils';

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
      .flatMap((condition) =>
        typeof condition.left === 'string' && typeof condition.right === 'string'
          ? [
              `l.${quoteIdentifier(lastQualifiedPart(condition.left))} = r.${quoteIdentifier(lastQualifiedPart(condition.right))}`,
            ]
          : []
      )
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
      const side =
        rightAlias && item.source.startsWith(`${rightAlias}.`)
          ? 'r'
          : leftColumns.includes(lastQualifiedPart(item.source))
            ? 'l'
            : 'r';
      const alias = typeof item.alias === 'string' ? item.alias : lastQualifiedPart(item.source);
      return [
        `${side}.${quoteIdentifier(lastQualifiedPart(item.source))} AS ${quoteIdentifier(alias)}`,
      ];
    })
    .join(', ');
}

import { quoteIdentifier, objectArray, computeMappingTarget } from './utils';

export function compileFieldMappingSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const sourceToTarget = new Map(
    objectArray(config.mappings).flatMap((mapping) => {
      const source = typeof mapping.source === 'string' ? mapping.source : '';
      const target = computeMappingTarget(mapping);
      return source && target ? [[source, target] as const] : [];
    })
  );
  const projections = columns.map((column) => {
    const target = sourceToTarget.get(column);
    return target
      ? `${quoteIdentifier(column)} AS ${quoteIdentifier(target)}`
      : quoteIdentifier(column);
  });
  return `CREATE TEMP TABLE ${output} AS SELECT ${projections.join(', ')} FROM ${input}`;
}

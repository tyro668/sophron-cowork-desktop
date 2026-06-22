import { quoteIdentifier, objectArray } from './utils';

export function compileFieldMappingSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const mappings = objectArray(config.mappings);
  const sourceToTarget = new Map(
    mappings.flatMap((mapping) =>
      typeof mapping.source === 'string' && typeof mapping.target === 'string'
        ? [[mapping.source, mapping.target] as const]
        : []
    )
  );
  const projections = columns.map((column) => {
    const target = sourceToTarget.get(column);
    return target
      ? `${quoteIdentifier(column)} AS ${quoteIdentifier(target)}`
      : quoteIdentifier(column);
  });
  return `CREATE TEMP TABLE ${output} AS SELECT ${projections.join(', ')} FROM ${input}`;
}

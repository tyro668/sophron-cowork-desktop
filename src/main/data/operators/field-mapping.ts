import { quoteIdentifier, computeMappingTarget } from './utils';
import { FieldMappingConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileFieldMappingSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const { mappings } = parseOperatorConfig(FieldMappingConfigSchema, config);
  const sourceToTarget = new Map(
    mappings.flatMap((mapping) => {
      const source = mapping.source;
      const target = computeMappingTarget(mapping as Record<string, unknown>);
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

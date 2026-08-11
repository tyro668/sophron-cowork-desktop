import { quoteIdentifier, computeMappingTarget } from './utils';
import { FieldMappingConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileFieldMappingSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const { mappings } = parseOperatorConfig(FieldMappingConfigSchema, config);

  const missingSources = mappings
    .map((m) => m.source)
    .filter((source) => source && !columns.includes(source));
  if (missingSources.length > 0) {
    throw new Error(`Field '${missingSources.join("', '")}' does not exist in input schema`);
  }

  const sourceToTarget = new Map(
    mappings.flatMap((mapping) => {
      const source = mapping.source;
      const target = computeMappingTarget(mapping as Record<string, unknown>);
      return source && target ? [[source, target] as const] : [];
    })
  );

  const unmappedColumns = columns.filter((c) => !sourceToTarget.has(c));
  const allTargets = [...sourceToTarget.values()];
  const conflict = unmappedColumns.find((c) => allTargets.includes(c));
  if (conflict) {
    throw new Error(
      `Mapping target '${conflict}' conflicts with existing column '${conflict}' that is not mapped`
    );
  }

  const projections = columns.map((column) => {
    const target = sourceToTarget.get(column);
    return target
      ? `${quoteIdentifier(column)} AS ${quoteIdentifier(target)}`
      : quoteIdentifier(column);
  });
  return `CREATE TEMP TABLE ${output} AS SELECT ${projections.join(', ')} FROM ${input}`;
}

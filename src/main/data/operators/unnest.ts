import { quoteIdentifier, literalToSql } from './utils';

export function compileUnnestSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const column = quoteIdentifier(String(config.column ?? 'items'));
  const alias = quoteIdentifier(String(config.alias ?? 'item'));
  if (config.sourceKind === 'json') {
    const path = literalToSql(config.path ?? '$');
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT base.*, item.value AS ${alias}
      FROM ${input} base, json_each(base.${column}::JSON, ${path}) AS item
    `;
  }
  return `
    CREATE TEMP TABLE ${output} AS
    SELECT base.*, item.${alias} AS ${alias}
    FROM ${input} base, UNNEST(base.${column}) AS item(${alias})
  `;
}

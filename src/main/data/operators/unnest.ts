import { quoteIdentifier, literalToSql } from './utils';
import { UnnestConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

function castToJsonExpr(columnExpr: string): string {
  return `replace(${columnExpr}, '''', '"')::JSON`;
}

export function compileUnnestSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const parsed = parseOperatorConfig(UnnestConfigSchema, config);
  const rawColumn = parsed.column;
  const rawAlias = parsed.alias;
  const column = quoteIdentifier(rawColumn);
  const alias = quoteIdentifier(rawAlias);
  const withIndex = parsed.withIndex;

  const isJson = parsed.sourceKind === 'json';

  // JSON mode — keep json_each (native DuckDB)
  if (isJson) {
    const path = literalToSql(parsed.path);
    const aliasCol = parsed.keepParentNames ? quoteIdentifier(`${rawColumn}_${rawAlias}`) : alias;
    const jsonCol = castToJsonExpr(`base.${column}`);
    const indexSql = withIndex ? `, ROW_NUMBER() OVER () - 1 AS ${quoteIdentifier(withIndex)}` : '';
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT base.*, item.value AS ${aliasCol}${indexSql}
      FROM ${input} base, json_each(${jsonCol}, ${path}) AS item
    `;
  }

  // List mode — auto-cast to JSON[] if not already an array type
  const colExpr = `COALESCE(TRY_CAST(base.${column} AS JSON[]), base.${column}::JSON::JSON[])`;

  const idxCols = withIndex ? `(${alias}, "_ordinal")` : `(${alias})`;
  const idxClause = withIndex ? ' WITH ORDINALITY' : '';
  const idxSelect = withIndex ? `, item."_ordinal" - 1 AS ${quoteIdentifier(withIndex)}` : '';
  return `
    CREATE TEMP TABLE ${output} AS
    SELECT base.*, item.${alias} AS ${alias}${idxSelect}
    FROM ${input} base, UNNEST(${colExpr})${idxClause} AS item${idxCols}
  `;
}

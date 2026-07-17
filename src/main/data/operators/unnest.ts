import { quoteIdentifier, literalToSql } from './utils';

function castToJsonExpr(columnExpr: string): string {
  return `replace(${columnExpr}, '''', '"')::JSON`;
}

export function compileUnnestSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const rawColumn = String(config.column ?? 'items');
  const rawAlias = String(config.alias ?? 'item');
  const column = quoteIdentifier(rawColumn);
  const alias = quoteIdentifier(rawAlias);
  const withIndex = typeof config.withIndex === 'string' ? String(config.withIndex) : undefined;
  const recursive = Boolean(config.recursive);
  const maxDepth = typeof config.maxDepth === 'number' ? (config.maxDepth as number) : undefined;
  const keepParentNames = Boolean(config.keepParentNames);

  const isJson = config.sourceKind === 'json';

  const path = isJson ? literalToSql(config.path ?? '$') : "'$'";
  const aliasCol = keepParentNames && isJson ? quoteIdentifier(`${rawColumn}_${rawAlias}`) : alias;
  const jsonCol = castToJsonExpr(`base.${column}`);

  // JSON mode — keep json_each (native DuckDB)
  if (isJson) {
    const indexSql = withIndex ? `, ROW_NUMBER() OVER () - 1 AS ${quoteIdentifier(withIndex)}` : '';
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT base.*, item.value AS ${aliasCol}${indexSql}
      FROM ${input} base, json_each(${jsonCol}, ${path}) AS item
    `;
  }

  // List mode — native UNNEST (only for native DuckDB arrays)
  if (recursive) {
    const depthLimit = maxDepth != null ? ` AND "_depth" < ${maxDepth}` : '';
    const indexSql = withIndex ? `, ROW_NUMBER() OVER () - 1 AS ${quoteIdentifier(withIndex)}` : '';
    return `
      CREATE TEMP TABLE ${output} AS
      WITH RECURSIVE flatten AS (
        SELECT base.*, u AS "_val", 1 AS "_depth"
        FROM ${input} base, UNNEST(base.${column}) AS t(u)
        UNION ALL
        SELECT flatten.* EXCLUDE ("_val", "_depth"), u AS "_val", flatten."_depth" + 1 AS "_depth"
        FROM flatten, UNNEST(flatten."_val") AS t(u)
        WHERE typeof(flatten."_val") LIKE '%[]%'${depthLimit}
      )
      SELECT * EXCLUDE ("_val", "_depth")${indexSql} FROM flatten
    `;
  }

  const idxCols = withIndex ? `(${alias}, "_ordinal")` : `(${alias})`;
  const idxClause = withIndex ? ' WITH ORDINALITY' : '';
  const idxSelect = withIndex ? `, item."_ordinal" - 1 AS ${quoteIdentifier(withIndex)}` : '';
  return `
    CREATE TEMP TABLE ${output} AS
    SELECT base.*, item.${alias} AS ${alias}${idxSelect}
    FROM ${input} base, UNNEST(base.${column})${idxClause} AS item${idxCols}
  `;
}

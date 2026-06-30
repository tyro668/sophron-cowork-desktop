import { quoteIdentifier, literalToSql } from './utils';

function castToJsonExpr(columnExpr: string): string {
  return `replace(replace(${columnExpr}, '"', '\\"'), '''', '"')::JSON`;
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

  const indexSql = withIndex ? `, ROW_NUMBER() OVER () - 1 AS ${quoteIdentifier(withIndex)}` : '';

  const jsonCol = castToJsonExpr(`base.${column}`);

  if (recursive) {
    const depthLimit = maxDepth != null ? ` AND flatten."_depth" < ${maxDepth}` : '';
    const source = `json_each(${jsonCol}, ${isJson ? path : "'$'"}) AS item`;
    return `
      CREATE TEMP TABLE ${output} AS
      WITH RECURSIVE flatten AS (
        SELECT base.*, item.value AS "_val", 1 AS "_depth"
        FROM ${input} base, ${source}
        UNION ALL
        SELECT flatten.* EXCLUDE ("_val", "_depth"), sub.value AS "_val", flatten."_depth" + 1 AS "_depth"
        FROM flatten, LATERAL json_each(flatten."_val"::JSON, '$') AS sub
        WHERE json_type(flatten."_val") = 'ARRAY'${depthLimit}
      )
      SELECT * EXCLUDE ("_val", "_depth")${indexSql} FROM flatten
    `;
  }

  if (isJson) {
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT base.*, item.value AS ${aliasCol}${indexSql}
      FROM ${input} base, json_each(${jsonCol}, ${path}) AS item
    `;
  }

  return `
    CREATE TEMP TABLE ${output} AS
    SELECT base.*, item.value AS ${alias}${indexSql}
    FROM ${input} base, json_each(${jsonCol}, '$') AS item
  `;
}

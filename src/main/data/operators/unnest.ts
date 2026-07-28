import { quoteIdentifier, literalToSql } from './utils';
import { UnnestConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

function castToJsonExpr(columnExpr: string): string {
  return `${columnExpr}::JSON`;
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

  // JSON OBJECT mode: expand each key into a separate column, return 1 row
  if (parsed.sourceKind === 'json' && config._jsonType === 'OBJECT') {
    const jsonCol = castToJsonExpr(`base.${column}`);
    const keys = (config._jsonKeys as string[]) ?? [];
    const keyCols = keys.map((k) => {
      const fullPath = parsed.path === '$' ? `$.${k}` : `${parsed.path}.${k}`;
      return `json_extract_string(${jsonCol}, ${literalToSql(fullPath)}) AS ${quoteIdentifier(k)}`;
    });
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT base.*${keyCols.length > 0 ? `, ${keyCols.join(', ')}` : ''}
      FROM ${input} base
    `;
  }

  // List mode: UNNEST array into rows (supports both native arrays and JSON strings)
  const target =
    parsed.path === '$'
      ? `base.${column}`
      : `json_extract(base.${column}::JSON, ${literalToSql(parsed.path)})`;
  const unnestExpr = `COALESCE(TRY_CAST(${target} AS JSON[]), ${target}::JSON::JSON[])`;

  const aliasCol = parsed.keepParentNames ? quoteIdentifier(`${rawColumn}_${rawAlias}`) : alias;
  const idxCols = withIndex ? `(${alias}, "_ordinal")` : `(${alias})`;
  const idxClause = withIndex ? ' WITH ORDINALITY' : '';
  const idxSelect = withIndex ? `, item."_ordinal" - 1 AS ${quoteIdentifier(withIndex)}` : '';

  if (parsed.preserveOrder) {
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT base.* EXCLUDE (__rn), item.${alias} AS ${aliasCol}${idxSelect}
      FROM (SELECT *, ROW_NUMBER() OVER () AS __rn FROM ${input} base) base
      LEFT JOIN LATERAL UNNEST(${unnestExpr}) WITH ORDINALITY AS item(${alias}, _ordinal) ON true
      ORDER BY base.__rn, item._ordinal
    `;
  }

  return `
    CREATE TEMP TABLE ${output} AS
    SELECT base.*, item.${alias} AS ${aliasCol}${idxSelect}
    FROM ${input} base
    LEFT JOIN LATERAL UNNEST(${unnestExpr})${idxClause} AS item${idxCols} ON true
  `;
}

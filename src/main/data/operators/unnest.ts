import { quoteIdentifier, literalToSql, uniqueAlias } from './utils';
import { UnnestConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

function castToJsonExpr(columnExpr: string): string {
  return `${columnExpr}::JSON`;
}

function escapeJsonKey(key: string): string {
  return `"${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function compileUnnestSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const parsed = parseOperatorConfig(UnnestConfigSchema, config);
  const rawColumn = parsed.field;
  const rawAlias = parsed.alias;
  const column = quoteIdentifier(rawColumn);
  const alias = quoteIdentifier(rawAlias);
  const withIndex = parsed.withIndex;
  const rn = uniqueAlias('__rn', columns);

  const aliasColName = parsed.keepParentNames ? `${rawColumn}_${rawAlias}` : rawAlias;

  if (parsed.sourceKind === 'json') {
    if (!config._jsonType || config._jsonType === 'NULL') {
      return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input}`;
    }
    if (config._jsonType !== 'OBJECT') {
      throw new Error(`Expand-to-columns requires a JSON object, but found ${config._jsonType}`);
    }

    // JSON OBJECT mode: expand each key into a separate column, return 1 row
    const keys = (config._jsonKeys as string[]) ?? [];
    const baseSet = new Set(columns.map((c) => c.toLowerCase()));
    const conflicts = keys.filter((k) => baseSet.has(k.toLowerCase()));
    if (conflicts.length > 0) {
      throw new Error(`Unnest JSON keys conflict with existing columns: ${conflicts.join(', ')}`);
    }
    const normalized = new Set<string>();
    const duplicates = keys.filter((k) => {
      const norm = k.toLowerCase();
      if (normalized.has(norm)) return true;
      normalized.add(norm);
      return false;
    });
    if (duplicates.length > 0) {
      throw new Error(
        `Unnest JSON keys have duplicates after normalization: ${duplicates.join(', ')}`
      );
    }

    const jsonCol = castToJsonExpr(`base.${column}`);
    const keyCols = keys.map((k) => {
      const fullPath =
        parsed.path === '$' ? `$.${escapeJsonKey(k)}` : `${parsed.path}.${escapeJsonKey(k)}`;
      return `json_extract_string(${jsonCol}, ${literalToSql(fullPath)}) AS ${quoteIdentifier(k)}`;
    });
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT base.*${keyCols.length > 0 ? `, ${keyCols.join(', ')}` : ''}
      FROM ${input} base
    `;
  }

  const baseSet = new Set(columns.map((c) => c.toLowerCase()));
  const conflicts: string[] = [];
  if (baseSet.has(aliasColName.toLowerCase())) {
    conflicts.push(aliasColName);
  }
  if (
    withIndex &&
    baseSet.has(withIndex.toLowerCase()) &&
    withIndex.toLowerCase() !== aliasColName.toLowerCase()
  ) {
    conflicts.push(withIndex);
  }
  if (conflicts.length > 0) {
    throw new Error(`Unnest output fields conflict with existing columns: ${conflicts.join(', ')}`);
  }
  if (withIndex && aliasColName.toLowerCase() === withIndex.toLowerCase()) {
    throw new Error(
      `Unnest alias "${aliasColName}" and index column "${withIndex}" must be different`
    );
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
      SELECT base.* EXCLUDE (${rn}), item.${alias} AS ${aliasCol}${idxSelect}
      FROM (SELECT *, ROW_NUMBER() OVER () AS ${rn} FROM ${input} base) base
      LEFT JOIN LATERAL UNNEST(${unnestExpr}) WITH ORDINALITY AS item(${alias}, _ordinal) ON true
      ORDER BY base.${rn}, item._ordinal
    `;
  }

  return `
    CREATE TEMP TABLE ${output} AS
    SELECT base.*, item.${alias} AS ${aliasCol}${idxSelect}
    FROM ${input} base
    LEFT JOIN LATERAL UNNEST(${unnestExpr})${idxClause} AS item${idxCols} ON true
  `;
}

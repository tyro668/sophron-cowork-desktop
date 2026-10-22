import { quoteIdentifier, literalToSql, uniqueAlias } from './utils';
import { UnpivotConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

function getUnpivotCastType(
  columnTypes: Record<string, string>,
  unpivotColumns: string[]
): string | null {
  const types = [...new Set(unpivotColumns.map((c) => columnTypes[c]).filter(Boolean))] as string[];
  if (types.length <= 1) return null;

  const hasText = types.includes('text');
  const hasNumeric = types.some((t) => t === 'integer' || t === 'float' || t === 'decimal');
  const hasTemporal = types.some((t) => t === 'date' || t === 'datetime');
  const hasBoolean = types.includes('boolean');
  const groups = [hasNumeric, hasTemporal, hasBoolean].filter(Boolean).length;

  if (hasText || groups > 1) return 'VARCHAR';

  if (hasNumeric) {
    if (types.includes('float') || types.includes('decimal')) return 'DOUBLE';
    return null;
  }
  if (hasTemporal) {
    if (types.includes('datetime')) return 'TIMESTAMPTZ';
    return null;
  }
  return null;
}

export function compileUnpivotSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>,
  columnTypes?: Record<string, string>
): string {
  const parsed = parseOperatorConfig(UnpivotConfigSchema, config);
  const configured = parsed.fields;

  const columnSet = new Set(columns.map((c) => c.toLowerCase()));
  const configuredSet = new Set(configured.map((c) => c.toLowerCase()));

  const invalid = configured.filter((c) => !columnSet.has(c.toLowerCase()));
  if (invalid.length > 0) {
    throw new Error(`Unpivot configured columns not found in input: ${invalid.join(', ')}`);
  }

  const unpivotColumns =
    parsed.selection === 'exclude'
      ? columns.filter((c) => !configuredSet.has(c.toLowerCase()))
      : configured.filter((c) => columnSet.has(c.toLowerCase()));
  if (unpivotColumns.length === 0) {
    throw new Error('Unpivot requires at least one column to expand');
  }

  const unpivotSet = new Set(unpivotColumns.map((c) => c.toLowerCase()));
  const keepColumns = columns.filter((c) => !unpivotSet.has(c.toLowerCase()));

  let nameCol = parsed.nameColumn || 'name';
  let valueCol = parsed.valueColumn || 'value';

  nameCol = uniqueAlias(nameCol, [...keepColumns, ...unpivotColumns]);
  valueCol = uniqueAlias(valueCol, [...keepColumns, ...unpivotColumns, nameCol]);

  const castType = columnTypes ? getUnpivotCastType(columnTypes, unpivotColumns) : null;

  if (castType !== null) {
    if (parsed.includeNulls) {
      const branches = unpivotColumns.map((column) => {
        const projection = [
          ...keepColumns.map(quoteIdentifier),
          `${literalToSql(column)} AS ${quoteIdentifier(nameCol)}`,
          `CAST(${quoteIdentifier(column)} AS ${castType}) AS ${quoteIdentifier(valueCol)}`,
        ].join(', ');
        return `SELECT ${projection} FROM ${input}`;
      });
      return `CREATE TEMP TABLE ${output} AS ${branches.join(' UNION ALL ')}`;
    }

    const castColumns = unpivotColumns
      .map((c) => `CAST(${quoteIdentifier(c)} AS ${castType}) AS ${quoteIdentifier(c)}`)
      .join(', ');
    const subQuery = `(SELECT ${[...keepColumns.map(quoteIdentifier), castColumns].join(', ')} FROM ${input})`;
    const onClause = unpivotColumns.map(quoteIdentifier).join(', ');
    return `CREATE TEMP TABLE ${output} AS UNPIVOT ${subQuery} ON ${onClause} INTO NAME ${quoteIdentifier(nameCol)} VALUE ${quoteIdentifier(valueCol)}`;
  }

  if (parsed.includeNulls) {
    const branches = unpivotColumns.map((column) => {
      const projection = [
        ...keepColumns.map(quoteIdentifier),
        `${literalToSql(column)} AS ${quoteIdentifier(nameCol)}`,
        `${quoteIdentifier(column)} AS ${quoteIdentifier(valueCol)}`,
      ].join(', ');
      return `SELECT ${projection} FROM ${input}`;
    });
    return `CREATE TEMP TABLE ${output} AS ${branches.join(' UNION ALL ')}`;
  }

  const onClause = unpivotColumns.map(quoteIdentifier).join(', ');
  return `CREATE TEMP TABLE ${output} AS UNPIVOT ${input} ON ${onClause} INTO NAME ${quoteIdentifier(nameCol)} VALUE ${quoteIdentifier(valueCol)}`;
}

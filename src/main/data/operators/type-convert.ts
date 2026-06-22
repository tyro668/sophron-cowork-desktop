import { requireDataFieldType } from '../../../shared/data-field-types';
import { quoteIdentifier, objectArray, normalizeDuckDbDateFormat, literalToSql } from './utils';
import { duckDbTypeForDataFieldType } from '../../../shared/data-field-types';

export function compileTypeConvertSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const conversions = objectArray(config.conversions);
  const byColumn = new Map(
    conversions.flatMap((conversion) =>
      typeof conversion.column === 'string' && typeof conversion.type === 'string'
        ? [[conversion.column, conversion] as const]
        : []
    )
  );
  const projections = columns.map((column) => {
    const conversion = byColumn.get(column);
    return conversion
      ? `${compileTypeConversionExpression(column, conversion)} AS ${quoteIdentifier(column)}`
      : quoteIdentifier(column);
  });
  return `CREATE TEMP TABLE ${output} AS SELECT ${projections.join(', ')} FROM ${input}`;
}

export function compileTypeConversionExpression(
  column: string,
  conversion: Record<string, unknown>
): string {
  const source = quoteIdentifier(column);
  const targetType = requireDataFieldType(
    typeof conversion.type === 'string' ? conversion.type : 'text',
    'cast target type'
  );
  if (conversion.onError === 'keep') {
    return source;
  }
  const failOnError = conversion.onError === 'fail';
  const storageType = duckDbTypeForDataFieldType(targetType);
  const format = typeof conversion.format === 'string' ? conversion.format.trim() : '';
  if ((targetType === 'date' || targetType === 'datetime') && format) {
    const parser = failOnError ? 'strptime' : 'try_strptime';
    const parsed = `${parser}(CAST(${source} AS VARCHAR), ${literalToSql(
      normalizeDuckDbDateFormat(format)
    )})`;
    return targetType === 'date' ? `CAST(${parsed} AS DATE)` : parsed;
  }
  return `${failOnError ? 'CAST' : 'TRY_CAST'}(${source} AS ${storageType})`;
}

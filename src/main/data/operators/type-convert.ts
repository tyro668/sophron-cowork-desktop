import { requireDataFieldType } from '../../../shared/data-field-types';
import {
  duckDbDecimalTypeForScale,
  duckDbTypeForDataFieldType,
} from '../../../shared/data-field-types';
import { literalToSql, quoteIdentifier } from './utils';
import { TypeConvertConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileTypeConvertSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>,
  columnTypes?: Record<string, string>
): string {
  const { conversions } = parseOperatorConfig(TypeConvertConfigSchema, config);
  const byColumn = new Map(
    conversions.flatMap((conversion) =>
      conversion.column && conversion.type ? [[conversion.column, conversion] as const] : []
    )
  );
  const projections = columns.map((column) => {
    const conversion = byColumn.get(column);
    return conversion
      ? `${compileTypeConversionExpression(column, conversion, columnTypes)} AS ${quoteIdentifier(column)}`
      : quoteIdentifier(column);
  });
  return `CREATE TEMP TABLE ${output} AS SELECT ${projections.join(', ')} FROM ${input}`;
}

function compileTypeConversionExpression(
  column: string,
  conversion: { type?: string; onError?: string; format?: string; scale?: number },
  columnTypes?: Record<string, string>
): string {
  const source = quoteIdentifier(column);
  const targetType = requireDataFieldType(conversion.type || 'text', 'cast target type');
  if (conversion.format && columnTypes) {
    const sourceType = columnTypes[column];
    if (sourceType === 'date' || sourceType === 'datetime') {
      if (sourceType === targetType) {
        return source;
      }
      const failOnError = conversion.onError === 'fail';
      const duckType = targetType === 'date' ? 'DATE' : 'TIMESTAMPTZ';
      return `${failOnError ? 'CAST' : 'TRY_CAST'}(${source} AS ${duckType})`;
    }
  }
  if (conversion.onError === 'keep') {
    return source;
  }
  const failOnError = conversion.onError === 'fail';
  const storageType =
    targetType === 'decimal' && typeof conversion.scale === 'number'
      ? duckDbDecimalTypeForScale(conversion.scale)
      : duckDbTypeForDataFieldType(targetType);
  if (conversion.format && (targetType === 'date' || targetType === 'datetime')) {
    const duckType = targetType === 'date' ? 'DATE' : 'TIMESTAMPTZ';
    if (failOnError) {
      return `CAST(strptime(${source}, ${literalToSql(conversion.format)}) AS ${duckType})`;
    }
    return `TRY_CAST(try_strptime(${source}, ${literalToSql(conversion.format)}) AS ${duckType})`;
  }
  return `${failOnError ? 'CAST' : 'TRY_CAST'}(${source} AS ${storageType})`;
}

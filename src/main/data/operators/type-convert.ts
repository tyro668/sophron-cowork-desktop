import { requireDataFieldType } from '../../../shared/data-field-types';
import { duckDbTypeForDataFieldType } from '../../../shared/data-field-types';
import { literalToSql, quoteIdentifier } from './utils';
import { TypeConvertConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileTypeConvertSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
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
      ? `${compileTypeConversionExpression(column, conversion)} AS ${quoteIdentifier(column)}`
      : quoteIdentifier(column);
  });
  return `CREATE TEMP TABLE ${output} AS SELECT ${projections.join(', ')} FROM ${input}`;
}

function compileTypeConversionExpression(
  column: string,
  conversion: { type?: string; onError?: string; format?: string }
): string {
  const source = quoteIdentifier(column);
  const targetType = requireDataFieldType(conversion.type || 'text', 'cast target type');
  if (conversion.onError === 'keep') {
    return source;
  }
  const failOnError = conversion.onError === 'fail';
  const storageType = duckDbTypeForDataFieldType(targetType);
  if (conversion.format && (targetType === 'date' || targetType === 'datetime')) {
    const cast = failOnError ? 'CAST' : 'TRY_CAST';
    const duckType = targetType === 'date' ? 'DATE' : 'TIMESTAMP';
    return `${cast}(strptime(${source}, ${literalToSql(conversion.format)}) AS ${duckType})`;
  }
  return `${failOnError ? 'CAST' : 'TRY_CAST'}(${source} AS ${storageType})`;
}

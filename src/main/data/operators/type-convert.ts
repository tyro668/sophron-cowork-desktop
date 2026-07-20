import { requireDataFieldType } from '../../../shared/data-field-types';
import { quoteIdentifier } from './utils';
import { duckDbTypeForDataFieldType } from '../../../shared/data-field-types';
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
  conversion: { type?: string; onError?: string }
): string {
  const source = quoteIdentifier(column);
  const targetType = requireDataFieldType(conversion.type || 'text', 'cast target type');
  if (conversion.onError === 'keep') {
    return source;
  }
  const failOnError = conversion.onError === 'fail';
  const storageType = duckDbTypeForDataFieldType(targetType);
  return `${failOnError ? 'CAST' : 'TRY_CAST'}(${source} AS ${storageType})`;
}

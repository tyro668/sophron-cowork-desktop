import { quoteIdentifier, objectArray } from './utils';
import { compileScalarExpression } from './compute';

export function compileCalculateFieldSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const calculations = objectArray(config.calculations);
  const additions = calculations.flatMap((calculation) =>
    typeof calculation.field === 'string' && typeof calculation.expression === 'string'
      ? [
          `${compileScalarExpression(calculation.expression)} AS ${quoteIdentifier(calculation.field)}`,
        ]
      : []
  );
  return `CREATE TEMP TABLE ${output} AS SELECT *${
    additions.length > 0 ? `, ${additions.join(', ')}` : ''
  } FROM ${input}`;
}

import { quoteIdentifier } from './utils';
import { compileScalarExpression } from './compute';
import { CalculateFieldConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';
import { exprFromParts, type CalculationRow } from '../../../shared/calculate-field/index';

export function compileCalculateFieldSql(
  output: string,
  input: string,
  config: Record<string, unknown>,
  inputColumns: string[] = []
): string {
  const { calculations } = parseOperatorConfig(CalculateFieldConfigSchema, config);
  const replaces: string[] = [];
  const additions: string[] = [];
  const existingColumns = new Set(inputColumns.map((column) => column.toLowerCase()));
  for (const calculation of calculations) {
    if (!calculation.field?.trim()) continue;
    let expr: string;
    if (calculation.type !== 'row' && calculation.fn?.trim()) {
      expr = exprFromParts(calculation as CalculationRow);
    } else {
      if (!calculation.expression?.trim()) continue;
      expr = calculation.expression;
    }
    const compiled = `${compileScalarExpression(expr)} AS ${quoteIdentifier(calculation.field)}`;
    if (
      calculation.action === 'replace' ||
      existingColumns.has(calculation.field.trim().toLowerCase())
    ) {
      replaces.push(compiled);
    } else {
      additions.push(compiled);
    }
  }
  let sql = `CREATE TEMP TABLE ${output} AS SELECT *`;
  if (replaces.length > 0) sql += ` REPLACE (${replaces.join(', ')})`;
  if (additions.length > 0) sql += `, ${additions.join(', ')}`;
  sql += ` FROM ${input}`;
  return sql;
}

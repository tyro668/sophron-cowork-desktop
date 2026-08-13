import { quoteIdentifier } from './utils';
import { compileScalarExpression } from './compute';
import { CalculateFieldConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';
import { exprFromParts, type CalculationRow } from '../../../shared/calculate-field/index';
import { expandCalculationDomainExpression } from '../../../shared/calculate-field/domain-dsl';

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
  const generatedFields = new Set<string>();
  for (const calculation of calculations) {
    if (!calculation.field?.trim()) continue;
    const field = calculation.field.trim();
    const normalizedField = field.toLowerCase();
    if (generatedFields.has(normalizedField)) {
      throw new Error(`Calculate field target '${field}' is configured more than once`);
    }
    let expr: string;
    if (calculation.type !== 'row' && calculation.fn?.trim()) {
      expr = exprFromParts(calculation as CalculationRow);
    } else {
      if (!calculation.expression?.trim()) continue;
      expr = calculation.expression;
    }
    const compiled = `${compileScalarExpression(expandCalculationDomainExpression(expr))} AS ${quoteIdentifier(field)}`;
    const fieldExists = existingColumns.has(normalizedField);
    if (calculation.action === 'replace') {
      if (!fieldExists) {
        throw new Error(`Calculate field replacement target '${field}' does not exist`);
      }
      replaces.push(compiled);
    } else if (calculation.action === 'add') {
      if (fieldExists) {
        throw new Error(`Calculate field addition target '${field}' already exists`);
      }
      additions.push(compiled);
    } else if (fieldExists) {
      replaces.push(compiled);
    } else {
      additions.push(compiled);
    }
    generatedFields.add(normalizedField);
  }
  let sql = `CREATE TEMP TABLE ${output} AS SELECT *`;
  if (replaces.length > 0) sql += ` REPLACE (${replaces.join(', ')})`;
  if (additions.length > 0) sql += `, ${additions.join(', ')}`;
  sql += ` FROM ${input}`;
  return sql;
}

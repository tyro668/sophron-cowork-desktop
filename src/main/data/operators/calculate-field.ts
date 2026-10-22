import { quoteIdentifier } from './utils';
import { compileScalarExpression } from './compute';
import { CalculateFieldConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';
import { expandCalculationDomainExpression } from '../../../shared/calculate-field/domain-dsl';
import { inferType, parseExpression } from '../../../shared/expression';

interface Stage {
  replaces: string[];
  additions: string[];
  /** Lower-cased fields produced by this stage. */
  produced: Set<string>;
}

function referencedFields(expression: string): string[] {
  try {
    return inferType(parseExpression(expression)).fields.map((f) => f.toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Calculations run top to bottom: a calculation may reference a field that an
 * earlier row of the same node created or replaced. Rows that depend on the
 * current stage start a new SELECT layer, so independent rows still compile
 * to a single `SELECT * REPLACE (...), ...`.
 */
export function compileCalculateFieldSql(
  output: string,
  input: string,
  config: Record<string, unknown>,
  inputColumns: string[] = []
): string {
  const { calculations } = parseOperatorConfig(CalculateFieldConfigSchema, config);
  const existingColumns = new Set(inputColumns.map((column) => column.toLowerCase()));
  const generatedFields = new Set<string>();
  const stages: Stage[] = [{ replaces: [], additions: [], produced: new Set() }];
  for (const calculation of calculations) {
    if (!calculation.field?.trim()) continue;
    const field = calculation.field.trim();
    const normalizedField = field.toLowerCase();
    if (generatedFields.has(normalizedField)) {
      throw new Error(`Calculate field target '${field}' is configured more than once`);
    }
    const expression = calculation.expression.trim();
    if (!expression) continue;
    const expanded = expandCalculationDomainExpression(expression, { allowLegacySql: true });
    const compiledExpression = compileScalarExpression(expanded);
    const compiled = `${compiledExpression} AS ${quoteIdentifier(field)}`;
    let stage = stages[stages.length - 1];
    if (referencedFields(expanded).some((ref) => stage.produced.has(ref))) {
      stage = { replaces: [], additions: [], produced: new Set() };
      stages.push(stage);
    }
    const fieldExists = existingColumns.has(normalizedField);
    if (calculation.action === 'replace') {
      if (!fieldExists) {
        throw new Error(`Calculate field replacement target '${field}' does not exist`);
      }
      stage.replaces.push(compiled);
    } else if (calculation.action === 'add') {
      if (fieldExists) {
        throw new Error(`Calculate field addition target '${field}' already exists`);
      }
      stage.additions.push(compiled);
    } else if (fieldExists) {
      stage.replaces.push(compiled);
    } else {
      stage.additions.push(compiled);
    }
    stage.produced.add(normalizedField);
    generatedFields.add(normalizedField);
  }
  let from = input;
  stages.forEach((stage, index) => {
    let select = 'SELECT *';
    if (stage.replaces.length > 0) select += ` REPLACE (${stage.replaces.join(', ')})`;
    if (stage.additions.length > 0) select += `, ${stage.additions.join(', ')}`;
    from = index === 0 ? `${select} FROM ${from}` : `${select} FROM (${from}) AS __calc_${index}`;
  });
  return `CREATE TEMP TABLE ${output} AS ${from}`;
}

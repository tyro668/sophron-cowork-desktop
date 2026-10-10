import type { PrepDiagnostic } from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRefExact, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';
import { createOperator, objectArray, type OperatorDslCodec } from './codec';
import { isCompleteCalculation } from '../../operator-completeness';
import { normalizeCalculationDomainExpression } from '../../calculate-field/domain-dsl';

export const calculateFieldCodec: OperatorDslCodec = {
  type: 'calculate_field',
  matches: (text) => text.startsWith('derive '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const calculations = splitTopLevel(text.slice(7)).flatMap((part) =>
      parseCalculation(part, command.line, diagnostics)
    );
    if (calculations.length === 0) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidCalculation', 'Derive requires a complete calculation'),
        line: command.line,
      });
    }
    const normalizedDsl =
      calculations.length > 0 ? `derive ${calculations.map(formatCalculation).join(', ')}` : text;
    return createOperator('calculate_field', normalizedDsl, { calculations });
  },
  format: (config) => {
    const calculations = objectArray(config?.calculations)
      .filter(isCompleteCalculation)
      .map((calculation) =>
        formatCalculation({
          ...calculation,
          expression: normalizeCalculationDomainExpression(
            String(calculation.expression ?? 'null'),
            { allowLegacySql: true }
          ),
        })
      );
    if (calculations.length === 0) return null;
    return `derive ${calculations.join(', ')}`;
  },
};

function parseCalculation(
  part: string,
  line: number,
  diagnostics: PrepDiagnostic[]
): Array<Record<string, unknown>> {
  const equals = part.indexOf('=');
  const field = equals >= 0 ? parseFieldRefExact(part.slice(0, equals)) : null;
  if (equals < 0 || !field || !toFieldName(field).trim()) {
    diagnostics.push({
      ...createPrepDiagnostic('invalidCalculation', `Cannot parse calculation: ${part}`),
      line,
    });
    return [];
  }
  let expression = part.slice(equals + 1).trim();
  if (!expression) {
    diagnostics.push({
      ...createPrepDiagnostic('invalidCalculationExpression', 'Calculation expression is empty'),
      line,
    });
    return [];
  }
  try {
    expression = normalizeCalculationDomainExpression(expression);
  } catch (error) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'invalidCalculationDomainFunction',
        error instanceof Error ? error.message : String(error)
      ),
      line,
    });
    return [{ field: toFieldName(field), expression }];
  }
  return [{ field: toFieldName(field), expression }];
}

function formatCalculation(calculation: Record<string, unknown>): string {
  const target = formatFieldRef(String(calculation.field ?? 'new_field'));
  return `${target} = ${String(calculation.expression ?? 'null')}`;
}

import type { PrepDiagnostic } from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRefExact, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';
import { createOperator, objectArray, stringArray, type OperatorDslCodec } from './codec';
import { isCompleteCalculation } from '../../operator-completeness';
import {
  buildCalculationFunctionDslExpression,
  normalizeCalculationDomainExpression,
} from '../../calculate-field/domain-dsl';
import {
  getCalculationFunction,
  type CalculationFunctionInput,
} from '../../calculate-field/function-registry';
import { type CalculationWindowFrame } from '../../calculate-field/window-frame';

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
      .map(formatCalculation);
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

function formatStructuredDomainCalculation(calculation: Record<string, unknown>): string | null {
  const fn = String(calculation.fn ?? '');
  const definition = getCalculationFunction(fn);
  if (!definition) {
    return null;
  }
  const orderBy = objectArray(calculation.orderBy).map((entry) => ({
    field: String(entry.field ?? ''),
    direction: entry.direction === 'desc' ? ('desc' as const) : ('asc' as const),
  }));
  const frameStart =
    typeof calculation.frameStart === 'string' ? calculation.frameStart : undefined;
  const frameEnd = typeof calculation.frameEnd === 'string' ? calculation.frameEnd : undefined;
  const frameType =
    calculation.frameType === 'range' || calculation.frameType === 'groups'
      ? calculation.frameType
      : 'rows';
  const frameExclude =
    calculation.frameExclude === 'current row' ||
    calculation.frameExclude === 'group' ||
    calculation.frameExclude === 'ties' ||
    calculation.frameExclude === 'no others'
      ? calculation.frameExclude
      : undefined;
  const input: CalculationFunctionInput = {
    functionId: fn,
    value: typeof calculation.fnArg === 'string' ? calculation.fnArg : undefined,
    extraParameter:
      typeof calculation.fnArg2 === 'string' && calculation.fnArg2 !== ''
        ? calculation.fnArg2
        : undefined,
    partitionBy: stringArray(calculation.partitionBy),
    orderBy,
    ...(frameStart && frameEnd
      ? {
          frame: {
            type: frameType as CalculationWindowFrame['type'],
            start: frameStart,
            end: frameEnd,
            ...(frameExclude ? { exclude: frameExclude as CalculationWindowFrame['exclude'] } : {}),
          },
        }
      : {}),
  };
  return buildCalculationFunctionDslExpression(input);
}

function formatCalculation(calculation: Record<string, unknown>): string {
  const target = formatFieldRef(String(calculation.field ?? 'new_field'));
  const structuredDsl = formatStructuredDomainCalculation(calculation);
  if (structuredDsl) return `${target} = ${structuredDsl}`;

  return `${target} = ${String(calculation.expression ?? 'null')}`;
}

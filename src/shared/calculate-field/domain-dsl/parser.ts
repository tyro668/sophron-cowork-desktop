import { splitTopLevel } from '../../prep-dsl/syntax/scanner';
import {
  getCalculationFunctionByDslId,
  MAX_CALCULATION_WINDOW_SIZE,
  MAX_FISCAL_START_MONTH,
  type CalculationFunctionDefinition,
  type CalculationFunctionInput,
} from '../function-registry';
import { parseOrderedPartition, parsePartition } from './ordered-over';
import {
  findMatchingParenToken,
  tokenizeDomainExpression,
  type DomainParseOptions,
} from './token-cursor';
import {
  PERIOD_GRAINS,
  INTERVAL_UNITS,
  TIME_AGGREGATIONS,
  parameterMax,
  positiveInteger,
  requireArgumentCount,
  requireArgumentRange,
  requiredField,
  requiredString,
  requiredValue,
} from './validators';

export function parseDomainExpression(
  expression: string,
  options: DomainParseOptions = {}
): CalculationFunctionInput | null {
  const tokens = tokenizeDomainExpression(expression);
  const functionToken = tokens[0];
  const openToken = tokens[1];
  if (
    !functionToken ||
    functionToken.type !== 'Ident' ||
    !openToken ||
    openToken.type !== 'ParenOpen'
  ) {
    return null;
  }
  const functionId = functionToken.value.toLowerCase();
  const definition = getCalculationFunctionByDslId(functionId);
  if (!definition) return null;

  const closeToken = findMatchingParenToken(tokens, 1);
  if (!closeToken) {
    throw new Error(`Calculation function '${functionId}' has an unclosed argument list`);
  }
  const args = splitTopLevel(expression.slice(openToken.end, closeToken.start)).map((arg) =>
    arg.trim()
  );
  const tail = expression.slice(closeToken.end).trim();

  if (definition.category === 'group_metrics') {
    const partitionBy = parsePartition(tail);
    return parseGroupMetricExpression(definition, functionId, args, partitionBy);
  }
  if (definition.category === 'cumulative') {
    const over = parseOrderedPartition(functionId, tail, options);
    if (over.frame) {
      throw new Error(`Calculation function '${functionId}' does not allow a window frame`);
    }
    requireArgumentCount(functionId, args, 1);
    return {
      functionId: definition.id,
      value: requiredValue(functionId, args[0], 1),
      valueIsExpression: true,
      partitionBy: over.partitionBy,
      orderBy: over.orderBy,
    };
  }
  if (definition.category === 'moving_window') {
    const over = parseOrderedPartition(functionId, tail, options);
    if (!over.frame) {
      throw new Error(`Calculation function '${functionId}' requires a window frame`);
    }
    requireArgumentCount(functionId, args, 1);
    return {
      functionId: definition.id,
      value: requiredValue(functionId, args[0], 1),
      valueIsExpression: true,
      partitionBy: over.partitionBy,
      orderBy: over.orderBy,
      frame: over.frame,
    };
  }

  if (definition.category === 'ranking') {
    const over = parseOrderedPartition(functionId, tail, options);
    if (over.frame) {
      throw new Error(`Calculation function '${functionId}' does not allow a window frame`);
    }
    if (functionId === 'ntile') {
      requireArgumentCount(functionId, args, 1);
      return {
        functionId: definition.id,
        partitionBy: over.partitionBy,
        orderBy: over.orderBy,
        extraParameter: positiveInteger(functionId, args[0], 1, MAX_CALCULATION_WINDOW_SIZE),
      };
    }
    requireArgumentCount(functionId, args, 0);
    return {
      functionId: definition.id,
      partitionBy: over.partitionBy,
      orderBy: over.orderBy,
    };
  }

  if (definition.category === 'offset') {
    const over = parseOrderedPartition(functionId, tail, options);
    const value = requiredValue(functionId, args[0], 1);
    if (over.frame) {
      throw new Error(`Calculation function '${functionId}' does not allow a window frame`);
    }
    if (
      functionId === 'nth_value' ||
      functionId === 'offset_difference' ||
      functionId === 'offset_rate'
    ) {
      requireArgumentCount(functionId, args, 2);
      const offset = positiveInteger(functionId, args[1], 2, MAX_CALCULATION_WINDOW_SIZE);
      return {
        functionId: definition.id,
        value,
        valueIsExpression: true,
        partitionBy: over.partitionBy,
        orderBy: over.orderBy,
        extraParameter: offset,
      };
    }
    if (functionId === 'first_value' || functionId === 'last_value') {
      requireArgumentCount(functionId, args, 1);
      return {
        functionId: definition.id,
        value,
        valueIsExpression: true,
        partitionBy: over.partitionBy,
        orderBy: over.orderBy,
      };
    }
    requireArgumentRange(functionId, args, 1, 2);
    const extraParameter = args[1]?.trim();
    return {
      functionId: definition.id,
      value,
      valueIsExpression: true,
      partitionBy: over.partitionBy,
      orderBy: over.orderBy,
      ...(extraParameter
        ? {
            extraParameter: positiveInteger(
              functionId,
              extraParameter,
              2,
              MAX_CALCULATION_WINDOW_SIZE
            ),
          }
        : {}),
    };
  }

  const partitionBy = parsePartition(tail);

  if (definition.category === 'period_compare') {
    if (functionId.startsWith('previous_')) {
      requireArgumentCount(functionId, args, 2);
      return domainInput(definition.id, requiredValue(functionId, args[0], 1), partitionBy, {
        dateField: requiredField(functionId, args[1], 2),
      });
    }
    if (functionId.startsWith('year_over_year_')) {
      requireArgumentCount(functionId, args, 3);
      const granularity = requiredString(functionId, args[2], 3);
      if (!PERIOD_GRAINS.has(granularity)) {
        throw new Error(
          `Calculation function '${functionId}' has unsupported period '${granularity}'`
        );
      }
      return domainInput(definition.id, requiredValue(functionId, args[0], 1), partitionBy, {
        dateField: requiredField(functionId, args[1], 2),
        granularity,
      });
    }
  }
  return parseTimeExpression(functionId, args, partitionBy);
}

function parseGroupMetricExpression(
  definition: CalculationFunctionDefinition,
  dslId: string,
  args: string[],
  partitionBy: string[]
): CalculationFunctionInput {
  requireArgumentCount(dslId, args, definition.extraParameter ? 2 : 1);

  const value = requiredValue(dslId, args[0], 1);
  const input: CalculationFunctionInput = {
    functionId: definition.id,
    value,
    valueIsExpression: true,
    partitionBy,
  };
  if (definition.extraParameter) {
    if (definition.extraParameter.kind === 'text') {
      input.extraParameter = requiredString(dslId, args[1], 2);
    } else {
      const raw = args[1];
      if (!/^-?\d+(?:\.\d+)?$/.test(raw)) {
        throw new Error(`Calculation function '${dslId}' argument 2 must be a number`);
      }
      input.extraParameter = raw;
    }
  }
  return input;
}

function parseTimeExpression(
  functionId: string,
  args: string[],
  partitionBy: string[]
): CalculationFunctionInput {
  const rolling = functionId === 'rolling_time';
  const minArgs = rolling ? 4 : 2;
  const maxArgs = functionId === 'year_to_date' ? 3 : minArgs;
  if (args.length < minArgs || args.length > maxArgs) {
    const expected = minArgs === maxArgs ? minArgs : `${minArgs} or ${maxArgs}`;
    throw new Error(`Calculation function '${functionId}' expects ${expected} arguments`);
  }

  const aggregate = parseAggregate(functionId, args[0]);
  const parameters: Record<string, string> = {
    aggregation: aggregate.aggregation,
    dateField: requiredField(functionId, args[1], 2),
  };
  if (rolling) {
    parameters.windowSize = positiveInteger(
      functionId,
      args[2],
      3,
      parameterMax(functionId, 'windowSize', MAX_CALCULATION_WINDOW_SIZE)
    );
    parameters.intervalUnit = requiredString(functionId, args[3], 4);
    if (!INTERVAL_UNITS.has(parameters.intervalUnit)) {
      throw new Error(
        `Calculation function '${functionId}' has unsupported interval '${parameters.intervalUnit}'`
      );
    }
  } else if (args[2]) {
    parameters.fiscalStartMonth = positiveInteger(
      functionId,
      args[2],
      3,
      parameterMax(functionId, 'fiscalStartMonth', MAX_FISCAL_START_MONTH)
    );
  }
  return domainInput(functionId, aggregate.value, partitionBy, parameters);
}

function domainInput(
  functionId: string,
  value: string,
  partitionBy: string[],
  parameters: Record<string, string>
): CalculationFunctionInput {
  return { functionId, value, valueIsExpression: true, partitionBy, parameters };
}

function parseAggregate(functionId: string, value: string): { aggregation: string; value: string } {
  const tokens = tokenizeDomainExpression(value);
  const fnToken = tokens[0];
  const openToken = tokens[1];
  if (!fnToken || fnToken.type !== 'Ident' || !openToken || openToken.type !== 'ParenOpen') {
    throw new Error(`Calculation function '${functionId}' requires a supported aggregate call`);
  }
  const aggregation = fnToken.value.toLowerCase();
  if (!TIME_AGGREGATIONS.has(aggregation)) {
    throw new Error(`Calculation function '${functionId}' requires a supported aggregate call`);
  }
  const closeToken = findMatchingParenToken(tokens, 1);
  if (!closeToken) {
    throw new Error(`Calculation function '${functionId}' requires a supported aggregate call`);
  }
  const closeIndex = tokens.indexOf(closeToken);
  const hasTrailingContent = tokens.slice(closeIndex + 1).some((token) => token.type !== 'EOF');
  if (hasTrailingContent) {
    throw new Error(`Calculation function '${functionId}' requires a supported aggregate call`);
  }
  const argument = value.slice(openToken.end, closeToken.start).trim();

  if (aggregation === 'count' && argument) {
    const argumentTokens = tokenizeDomainExpression(argument);
    if (
      argumentTokens[0]?.type === 'Ident' &&
      argumentTokens[0].value.toLowerCase() === 'distinct'
    ) {
      const distinctValue = argument.slice(argumentTokens[0].end).trim();
      requiredField(functionId, distinctValue, 1);
      return { aggregation: 'count_distinct', value: distinctValue };
    }
  }
  if (!argument || (argument === '*' && aggregation !== 'count')) {
    throw new Error(`Calculation function '${functionId}' has an invalid aggregate argument`);
  }
  return { aggregation, value: argument };
}

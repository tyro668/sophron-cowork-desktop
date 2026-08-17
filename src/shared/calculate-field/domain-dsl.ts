import { parseFieldRefExact, toFieldName } from '../prep-dsl/syntax/fields';
import { parseLiteral, quoteString } from '../prep-dsl/syntax/literals';
import { splitTopLevel } from '../prep-dsl/syntax/scanner';
import { tokenizeExpression, type ExprToken } from '../expression-tokenizer';
import {
  buildCalculationFunctionExpression,
  buildExtraParameter,
  formatCalculationField,
  getCalculationFunction,
  getCalculationParameter,
  MAX_CALCULATION_WINDOW_SIZE,
  MAX_FISCAL_START_MONTH,
  type CalculationFunctionDefinition,
  type CalculationFunctionInput,
  type CalculationOrderField,
  type CalculationWindowFrame,
} from './function-registry';

const GROUP_METRIC_DSL_TO_REGISTRY: Record<string, string> = {
  group_sum: 'sum',
  group_avg: 'avg',
  group_min: 'min',
  group_max: 'max',
  group_median: 'median',
  group_stddev: 'stddev',
  group_var: 'var',
  group_mode: 'mode',
  group_bool_and: 'bool_and',
  group_bool_or: 'bool_or',
  group_count: 'count',
  group_quantile_cont: 'quantile_cont',
  group_string_agg: 'string_agg',
  percentage: 'percentage',
  count_distinct: 'count_distinct',
};

const GROUP_METRIC_REGISTRY_TO_DSL: Record<string, string> = Object.fromEntries(
  Object.entries(GROUP_METRIC_DSL_TO_REGISTRY).map(([dsl, registry]) => [registry, dsl])
) as Record<string, string>;

const CUMULATIVE_FUNCTION_IDS = new Set([
  'cumulative_sum',
  'cumulative_avg',
  'cumulative_count',
  'cumulative_min',
  'cumulative_max',
  'cumulative_product',
]);

const MOVING_FUNCTION_IDS = new Set([
  'moving_sum',
  'moving_avg',
  'moving_count',
  'moving_min',
  'moving_max',
]);

const RANKING_FUNCTION_IDS = new Set([
  'row_number',
  'rank',
  'dense_rank',
  'percent_rank',
  'cume_dist',
  'ntile',
]);

const DOMAIN_FUNCTION_IDS = new Set([
  'lag',
  'lead',
  'first_value',
  'last_value',
  'nth_value',
  'offset_difference',
  'offset_rate',
  'previous_value',
  'previous_difference',
  'previous_rate',
  'year_over_year_value',
  'year_over_year_difference',
  'year_over_year_rate',
  'year_to_date',
  'quarter_to_date',
  'month_to_date',
  'week_to_date',
  'rolling_time',
  ...Object.keys(GROUP_METRIC_DSL_TO_REGISTRY),
  ...CUMULATIVE_FUNCTION_IDS,
  ...MOVING_FUNCTION_IDS,
  ...RANKING_FUNCTION_IDS,
]);

const PERIOD_GRAINS = new Set(['year', 'quarter', 'month', 'week', 'day']);
const INTERVAL_UNITS = new Set(['day', 'week', 'month', 'quarter', 'year']);
const TIME_AGGREGATIONS = new Set(['sum', 'avg', 'count', 'min', 'max']);

const OFFSET_FUNCTION_IDS = new Set([
  'lag',
  'lead',
  'first_value',
  'last_value',
  'nth_value',
  'offset_difference',
  'offset_rate',
]);

function tokenizeDomainExpression(expression: string): ExprToken[] {
  return tokenizeExpression(expression);
}

function isIntegerString(value: string): boolean {
  return /^\d+$/.test(value);
}

class DomainTokenCursor {
  readonly tokens: ExprToken[];
  private position = 0;

  constructor(expression: string) {
    this.tokens = tokenizeDomainExpression(expression);
  }

  get eof(): boolean {
    return this.position >= this.tokens.length;
  }

  peek(offset = 0): ExprToken | undefined {
    return this.tokens[this.position + offset];
  }

  consume(): ExprToken | undefined {
    const token = this.peek();
    if (token) this.position += 1;
    return token;
  }

  matchIdentifier(keyword: string): boolean {
    const token = this.peek();
    if (!token || token.type !== 'Ident' || token.value.toLowerCase() !== keyword) return false;
    this.position += 1;
    return true;
  }
}

export function buildCalculationFunctionDslExpression(input: CalculationFunctionInput): string {
  const definition = getCalculationFunction(input.functionId);
  if (!definition) throw new Error(`Unknown calculation function '${input.functionId}'`);
  if (!isDomainFunction(definition)) return buildCalculationFunctionExpression(input);

  validateDomainFunctionInput(definition, input);

  const canonicalId = canonicalDomainFunctionId(definition);
  if (definition.category === 'ranking') {
    const args =
      definition.id === 'ntile' ? [buildExtraParameter(definition, input.extraParameter)] : [];
    return `${canonicalId}(${args.join(', ')})${formatOrderedPartition(input.partitionBy, input.orderBy)}`;
  }
  const value = formatValue(definition, input);
  if (definition.category === 'group_metrics') {
    return formatGroupMetricDslExpression(definition, input, canonicalId, value);
  }
  if (definition.category === 'cumulative') {
    return `${canonicalId}(${value})${formatOrderedPartition(input.partitionBy, input.orderBy)}`;
  }
  if (definition.category === 'moving_window') {
    return `${canonicalId}(${value})${formatMovingWindowOver(input)}`;
  }
  if (definition.category === 'offset') {
    const args = [value];
    const extraParameter = input.extraParameter;
    if (extraParameter) args.push(buildExtraParameter(definition, extraParameter));
    const orderedOver = formatOrderedPartition(input.partitionBy, input.orderBy);
    return `${canonicalId}(${args.join(', ')})${orderedOver}`;
  }
  const over = formatPartition(input.partitionBy);
  const date = formatCalculationField(requiredParameter(input, 'dateField'));
  if (definition.category === 'period_compare') {
    const args = [value, date];
    if (input.functionId.startsWith('year_over_year_')) {
      const granularity = parameterDefault(definition, 'granularity', 'month');
      args.push(quoteString(input.parameters?.granularity || granularity));
    }
    return `${canonicalId}(${args.join(', ')})${over}`;
  }

  const aggregation = parameterDefault(definition, 'aggregation', 'sum');
  const aggregate = formatAggregate(input.parameters?.aggregation || aggregation, value);
  if (input.functionId === 'rolling_time') {
    const size = integerParameter(
      input,
      'windowSize',
      parameterDefault(definition, 'windowSize', '7')
    );
    const unit = parameterDefault(definition, 'intervalUnit', 'day');
    const intervalUnit = input.parameters?.intervalUnit || unit;
    if (!INTERVAL_UNITS.has(intervalUnit)) {
      throw new Error(`Unsupported rolling interval unit '${intervalUnit}'`);
    }
    return `rolling_time(${aggregate}, ${date}, ${size}, ${quoteString(intervalUnit)})${over}`;
  }

  const args = [aggregate, date];
  if (input.functionId === 'year_to_date') {
    const fiscalMonth = integerParameter(
      input,
      'fiscalStartMonth',
      parameterDefault(definition, 'fiscalStartMonth', '1')
    );
    if (fiscalMonth !== '1') args.push(fiscalMonth);
  }
  return `${canonicalId}(${args.join(', ')})${over}`;
}

function canonicalDomainFunctionId(definition: CalculationFunctionDefinition): string {
  if (definition.category === 'group_metrics') {
    return GROUP_METRIC_REGISTRY_TO_DSL[definition.id] ?? definition.id;
  }
  return definition.id;
}

function validateDomainFunctionInput(
  definition: CalculationFunctionDefinition,
  input: CalculationFunctionInput
): void {
  if (definition.order === 'required') {
    const orderFields = (input.orderBy ?? []).filter((entry) => entry.field.trim());
    if (orderFields.length === 0) {
      throw new Error(`Calculation function '${definition.id}' requires order fields`);
    }
  }
  if (definition.extraParameter) {
    buildExtraParameter(definition, input.extraParameter);
  }
  if (definition.category === 'offset') {
    if (input.frame) {
      throw new Error(`Calculation function '${definition.id}' does not allow a window frame`);
    }
    const hasExtra =
      input.extraParameter !== undefined &&
      input.extraParameter !== null &&
      input.extraParameter !== '';
    if ((definition.id === 'first_value' || definition.id === 'last_value') && hasExtra) {
      throw new Error(`Calculation function '${definition.id}' does not accept an extra parameter`);
    }
    if (
      (definition.id === 'nth_value' ||
        definition.id === 'offset_difference' ||
        definition.id === 'offset_rate') &&
      !hasExtra
    ) {
      throw new Error(`Calculation function '${definition.id}' requires an extra parameter`);
    }
  }
  if (definition.category === 'cumulative' && input.frame) {
    throw new Error(`Calculation function '${definition.id}' does not allow a window frame`);
  }
  if (definition.category === 'ranking' && input.frame) {
    throw new Error(`Calculation function '${definition.id}' does not allow a window frame`);
  }
  if (definition.category === 'group_metrics' && input.frame) {
    throw new Error(`Calculation function '${definition.id}' does not allow a window frame`);
  }
}

function formatGroupMetricDslExpression(
  definition: CalculationFunctionDefinition,
  input: CalculationFunctionInput,
  canonicalId: string,
  value: string
): string {
  const args = [value];
  if (definition.extraParameter) {
    if (definition.extraParameter.kind === 'text') {
      const raw =
        input.extraParameter === undefined || input.extraParameter === ''
          ? definition.extraParameter.defaultValue
          : input.extraParameter;
      args.push(quoteString(raw));
    } else {
      args.push(buildExtraParameter(definition, input.extraParameter));
    }
  }
  return `${canonicalId}(${args.join(', ')})${formatPartition(input.partitionBy)}`;
}

function formatMovingWindowOver(input: CalculationFunctionInput): string {
  const frame = input.frame;
  if (!frame) {
    throw new Error(`Calculation function '${input.functionId}' requires a window frame`);
  }
  if (!isFrameStartBeforeOrEqual(frame.start, frame.end)) {
    throw new Error(`Calculation function '${input.functionId}' has an invalid window frame`);
  }

  const baseOver = formatOrderedPartition(input.partitionBy, input.orderBy);
  const baseClauses = baseOver ? baseOver.slice(' over('.length, -1) : '';
  const exclude = frame.exclude && frame.exclude !== 'no others' ? ` exclude ${frame.exclude}` : '';
  const frameClause = `${frame.type} between ${formatDslFrameBound(frame.start)} and ${formatDslFrameBound(frame.end)}${exclude}`;
  return ` over(${[baseClauses, frameClause].filter(Boolean).join(' ')})`;
}

function formatDslFrameBound(bound: string): string {
  const interval = /^interval (\d+) (day|week|month|quarter|year) (preceding|following)$/i.exec(
    bound.trim()
  );
  if (interval) {
    return `interval ${interval[1]} ${quoteString(interval[2].toLowerCase())} ${interval[3].toLowerCase()}`;
  }
  return bound.trim().toLowerCase();
}

interface DomainParseOptions {
  allowBareIdentifiers?: boolean;
}

export function expandCalculationDomainExpression(expression: string): string {
  const parsed = parseDomainExpression(expression, {
    allowBareIdentifiers: true,
  });
  return parsed ? buildCalculationFunctionExpression(parsed) : expression;
}

export function normalizeCalculationDomainExpression(expression: string): string {
  const parsed = parseDomainExpression(expression);
  return parsed ? buildCalculationFunctionDslExpression(parsed) : expression;
}

function parseDomainExpression(
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
  if (!DOMAIN_FUNCTION_IDS.has(functionId)) return null;

  const closeToken = findMatchingParenToken(tokens, 1);
  if (!closeToken) {
    throw new Error(`Calculation function '${functionId}' has an unclosed argument list`);
  }
  const args = splitTopLevel(expression.slice(openToken.end, closeToken.start)).map((arg) =>
    arg.trim()
  );
  const tail = expression.slice(closeToken.end).trim();

  const groupRegistryId = GROUP_METRIC_DSL_TO_REGISTRY[functionId];
  if (groupRegistryId) {
    const partitionBy = parsePartition(tail);
    return parseGroupMetricExpression(groupRegistryId, functionId, args, partitionBy);
  }
  if (CUMULATIVE_FUNCTION_IDS.has(functionId)) {
    const over = parseOrderedPartition(functionId, tail, options);
    if (over.frame) {
      throw new Error(`Calculation function '${functionId}' does not allow a window frame`);
    }
    requireArgumentCount(functionId, args, 1);
    return {
      functionId,
      value: requiredValue(functionId, args[0], 1),
      valueIsExpression: true,
      partitionBy: over.partitionBy,
      orderBy: over.orderBy,
    };
  }
  if (MOVING_FUNCTION_IDS.has(functionId)) {
    const over = parseOrderedPartition(functionId, tail, options);
    if (!over.frame) {
      throw new Error(`Calculation function '${functionId}' requires a window frame`);
    }
    requireArgumentCount(functionId, args, 1);
    return {
      functionId,
      value: requiredValue(functionId, args[0], 1),
      valueIsExpression: true,
      partitionBy: over.partitionBy,
      orderBy: over.orderBy,
      frame: over.frame,
    };
  }

  if (RANKING_FUNCTION_IDS.has(functionId)) {
    const over = parseOrderedPartition(functionId, tail, options);
    if (over.frame) {
      throw new Error(`Calculation function '${functionId}' does not allow a window frame`);
    }
    if (functionId === 'ntile') {
      requireArgumentCount(functionId, args, 1);
      return {
        functionId,
        partitionBy: over.partitionBy,
        orderBy: over.orderBy,
        extraParameter: positiveInteger(functionId, args[0], 1, MAX_CALCULATION_WINDOW_SIZE),
      };
    }
    requireArgumentCount(functionId, args, 0);
    return {
      functionId,
      partitionBy: over.partitionBy,
      orderBy: over.orderBy,
    };
  }

  if (OFFSET_FUNCTION_IDS.has(functionId)) {
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
        functionId,
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
        functionId,
        value,
        valueIsExpression: true,
        partitionBy: over.partitionBy,
        orderBy: over.orderBy,
      };
    }
    requireArgumentRange(functionId, args, 1, 2);
    const extraParameter = args[1]?.trim();
    return {
      functionId,
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

  if (functionId.startsWith('previous_')) {
    requireArgumentCount(functionId, args, 2);
    return domainInput(functionId, requiredValue(functionId, args[0], 1), partitionBy, {
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
    return domainInput(functionId, requiredValue(functionId, args[0], 1), partitionBy, {
      dateField: requiredField(functionId, args[1], 2),
      granularity,
    });
  }
  return parseTimeExpression(functionId, args, partitionBy);
}

function parseGroupMetricExpression(
  registryId: string,
  dslId: string,
  args: string[],
  partitionBy: string[]
): CalculationFunctionInput {
  const definition = getCalculationFunction(registryId);
  if (!definition) throw new Error(`Unknown calculation function '${registryId}'`);
  requireArgumentCount(dslId, args, definition.extraParameter ? 2 : 1);

  const value = requiredValue(dslId, args[0], 1);
  const input: CalculationFunctionInput = {
    functionId: registryId,
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

function findMatchingParenToken(tokens: ExprToken[], openIndex: number): ExprToken | undefined {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'ParenOpen') depth += 1;
    else if (token.type === 'ParenClose') {
      depth -= 1;
      if (depth === 0) return token;
    }
  }
  return undefined;
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

function isDomainFunction(definition: CalculationFunctionDefinition): boolean {
  return (
    definition.category === 'group_metrics' ||
    definition.category === 'ranking' ||
    definition.category === 'cumulative' ||
    definition.category === 'moving_window' ||
    definition.category === 'period_compare' ||
    definition.category === 'time_intelligence' ||
    definition.category === 'offset'
  );
}

function formatValue(
  definition: CalculationFunctionDefinition,
  input: CalculationFunctionInput
): string {
  const value = input.value?.trim() || (definition.valueArgument === 'field-or-star' ? '*' : '');
  if (!value) throw new Error(`Calculation function '${definition.id}' requires a value field`);
  if (input.valueIsExpression || value === '*') return value;
  return formatCalculationField(value);
}

function formatPartition(partitionBy: string[] | undefined): string {
  const fields = (partitionBy ?? []).filter(Boolean).map(formatCalculationField);
  return fields.length ? ` over(partition by ${fields.join(', ')})` : '';
}

function formatOrderedPartition(
  partitionBy: string[] | undefined,
  orderBy: CalculationOrderField[] | undefined
): string {
  const clauses: string[] = [];
  const partition = (partitionBy ?? []).filter(Boolean).map(formatCalculationField);
  if (partition.length > 0) clauses.push(`partition by ${partition.join(', ')}`);
  const order = (orderBy ?? []).filter((entry) => entry.field.trim());
  if (order.length > 0) {
    clauses.push(
      `order by ${order
        .map(
          ({ field, direction }) =>
            `${formatCalculationField(field)}${direction === 'desc' ? ' desc' : ''}`
        )
        .join(', ')}`
    );
  }
  return clauses.length > 0 ? ` over(${clauses.join(' ')})` : '';
}

function formatAggregate(aggregation: string, value: string): string {
  if (aggregation === 'count_distinct') return `count(distinct ${value})`;
  if (!TIME_AGGREGATIONS.has(aggregation)) {
    throw new Error(`Unsupported time aggregation '${aggregation}'`);
  }
  return `${aggregation}(${value})`;
}

function parsePartition(tail: string): string[] {
  if (!tail) return [];
  const cursor = new DomainTokenCursor(tail);
  if (!cursor.matchIdentifier('over')) {
    throw new Error('Calculation domain functions only allow over(partition by ...)');
  }
  if (cursor.peek()?.type !== 'ParenOpen') {
    throw new Error('Calculation domain functions only allow over(partition by ...)');
  }
  cursor.consume();
  if (!cursor.matchIdentifier('partition')) {
    throw new Error('Calculation domain functions only allow over(partition by ...)');
  }
  if (!cursor.matchIdentifier('by')) {
    throw new Error('Calculation domain functions only allow over(partition by ...)');
  }

  const fields: string[] = [];
  let expectsField = true;
  while (!cursor.eof) {
    const token = cursor.peek();
    if (token?.type === 'EOF') break;
    if (token?.type === 'ParenClose') {
      if (expectsField) {
        throw new Error('Calculation domain partition contains a misplaced comma');
      }
      cursor.consume();
      break;
    }
    if (token?.type === 'Comma') {
      if (expectsField) {
        throw new Error('Calculation domain partition contains a misplaced comma');
      }
      expectsField = true;
      cursor.consume();
      continue;
    }
    if (!expectsField) {
      throw new Error('Calculation domain partition fields must be separated by commas');
    }
    if (token?.type === 'Ident' && token.value.toLowerCase() === 'order') {
      throw new Error('Calculation domain functions only allow over(partition by ...)');
    }
    const field = requiredField('over', token?.value ?? '', 1);
    fields.push(field);
    expectsField = false;
    cursor.consume();
  }
  if (cursor.peek()?.type !== 'EOF') {
    throw new Error('Calculation domain functions only allow over(partition by ...)');
  }
  if (fields.length === 0) throw new Error('Calculation domain partition cannot be empty');
  return fields;
}

function parseOrderedPartition(
  functionId: string,
  tail: string,
  options: DomainParseOptions = {}
): { partitionBy: string[]; orderBy: CalculationOrderField[]; frame?: CalculationWindowFrame } {
  if (!tail) throw new Error('Ordered functions require over(... order by ...)');
  const cursor = new DomainTokenCursor(tail);
  if (!cursor.matchIdentifier('over')) {
    throw new Error('Ordered functions require over(... order by ...)');
  }
  if (cursor.peek()?.type !== 'ParenOpen') {
    throw new Error('Ordered functions require over(... order by ...)');
  }
  cursor.consume();

  const partitionBy: string[] = [];
  if (cursor.matchIdentifier('partition')) {
    if (!cursor.matchIdentifier('by')) {
      throw new Error('Ordered functions require over(partition by ...)');
    }
    let expectsField = true;
    while (!cursor.eof) {
      const token = cursor.peek();
      if (token?.type === 'EOF') break;
      if (token?.type === 'ParenClose') break;
      if (token?.type === 'Ident' && token.value.toLowerCase() === 'order') {
        break;
      }
      if (token?.type === 'Comma') {
        if (expectsField) {
          throw new Error('Ordered functions have a misplaced comma in partition');
        }
        expectsField = true;
        cursor.consume();
        continue;
      }
      if (!expectsField) {
        throw new Error('Ordered functions partition fields must be separated by commas');
      }
      if (!token) {
        throw new Error('Ordered functions require over(... order by ...)');
      }
      partitionBy.push(parseOrderedFieldToken(functionId, token, options));
      expectsField = false;
      cursor.consume();
    }
    if (partitionBy.length === 0) {
      throw new Error('Ordered functions partition cannot be empty');
    }
  }

  if (!cursor.matchIdentifier('order')) {
    throw new Error('Ordered functions require over(... order by ...)');
  }
  if (!cursor.matchIdentifier('by')) {
    throw new Error('Ordered functions require over(... order by ...)');
  }

  const orderBy: CalculationOrderField[] = [];
  let frame: CalculationWindowFrame | undefined;
  let expectsField = true;
  while (!cursor.eof) {
    const token = cursor.peek();
    if (token?.type === 'EOF') break;
    if (token?.type === 'ParenClose') {
      if (expectsField) {
        throw new Error('Ordered functions have a misplaced comma in order by');
      }
      cursor.consume();
      break;
    }
    if (token?.type === 'Comma') {
      if (expectsField) {
        throw new Error('Ordered functions have a misplaced comma in order by');
      }
      expectsField = true;
      cursor.consume();
      continue;
    }
    if (!token) {
      throw new Error('Ordered functions require over(... order by ...)');
    }
    const lower = token.value.toLowerCase();
    if (lower === 'rows' || lower === 'range' || lower === 'groups') {
      frame = parseFrameFromCursor(cursor);
      break;
    }
    if (!expectsField) {
      throw new Error('Ordered functions order fields must be separated by commas');
    }
    const field = parseOrderedFieldToken(functionId, token, options);
    cursor.consume();
    let direction: 'asc' | 'desc' = 'asc';
    const next = cursor.peek();
    if (
      next?.type === 'Ident' &&
      (next.value.toLowerCase() === 'asc' || next.value.toLowerCase() === 'desc')
    ) {
      direction = next.value.toLowerCase() as 'asc' | 'desc';
      cursor.consume();
    }
    orderBy.push({ field, direction });
    expectsField = false;
  }
  if (cursor.peek()?.type !== 'EOF') {
    throw new Error('Ordered functions require over(... order by ...)');
  }

  if (orderBy.length === 0) throw new Error('Ordered functions require at least one order field');
  return { partitionBy, orderBy, frame };
}

function parseFrameFromCursor(cursor: DomainTokenCursor): CalculationWindowFrame {
  const typeToken = cursor.consume();
  if (
    !typeToken ||
    (typeToken.value.toLowerCase() !== 'rows' &&
      typeToken.value.toLowerCase() !== 'range' &&
      typeToken.value.toLowerCase() !== 'groups')
  ) {
    throw new Error(`Unsupported window frame type '${typeToken?.value ?? ''}'`);
  }
  const frameType = typeToken.value.toLowerCase() as CalculationWindowFrame['type'];

  if (!cursor.matchIdentifier('between')) {
    throw new Error('Window frame requires "between"');
  }

  const start = parseFrameBoundFromCursor(cursor);
  if (!cursor.matchIdentifier('and')) {
    throw new Error('Window frame requires "and"');
  }
  const end = parseFrameBoundFromCursor(cursor);

  let exclude: CalculationWindowFrame['exclude'];
  if (cursor.matchIdentifier('exclude')) {
    // "current row" / "no others" are multi-word; consume remaining tokens up to the closing paren.
    const excludeText = consumeUntilParen(cursor);
    const normalized = excludeText.trim().toLowerCase();
    if (
      normalized !== 'current row' &&
      normalized !== 'group' &&
      normalized !== 'ties' &&
      normalized !== 'no others'
    ) {
      throw new Error(`Unsupported window frame exclusion '${excludeText.trim()}'`);
    }
    exclude = normalized;
  } else if (cursor.peek()?.type === 'ParenClose') {
    cursor.consume();
  } else {
    throw new Error('Window frame is not terminated by ")"');
  }

  if (!isFrameStartBeforeOrEqual(start, end)) {
    throw new Error('Invalid window frame order in over(...)');
  }

  return { type: frameType, start, end, ...(exclude ? { exclude } : {}) };
}

function parseFrameBoundFromCursor(cursor: DomainTokenCursor): string {
  const first = cursor.peek();
  if (!first) throw new Error('Invalid window frame bound');
  const lower = first.value.toLowerCase();

  if (lower === 'unbounded') {
    cursor.consume();
    const second = cursor.peek();
    if (second?.type === 'Ident' && second.value.toLowerCase() === 'preceding') {
      cursor.consume();
      return 'unbounded preceding';
    }
    if (second?.type === 'Ident' && second.value.toLowerCase() === 'following') {
      cursor.consume();
      return 'unbounded following';
    }
    throw new Error('Invalid unbounded frame bound');
  }

  if (lower === 'current') {
    cursor.consume();
    if (!cursor.matchIdentifier('row')) {
      throw new Error('Invalid current row frame bound');
    }
    return 'current row';
  }

  if (lower === 'interval') {
    cursor.consume();
    const sizeToken = cursor.peek();
    if (!sizeToken || sizeToken.type !== 'Number') {
      throw new Error('Invalid interval frame bound');
    }
    cursor.consume();
    const unitToken = cursor.peek();
    if (!unitToken || unitToken.type !== 'StringLiteral') {
      throw new Error('Invalid interval frame unit');
    }
    cursor.consume();
    const directionToken = cursor.peek();
    if (
      !directionToken ||
      directionToken.type !== 'Ident' ||
      (directionToken.value.toLowerCase() !== 'preceding' &&
        directionToken.value.toLowerCase() !== 'following')
    ) {
      throw new Error('Invalid interval frame direction');
    }
    cursor.consume();
    const unit = String(parseLiteral(unitToken.value));
    return `interval ${sizeToken.value} ${unit} ${directionToken.value.toLowerCase()}`;
  }

  if (first.type === 'Number') {
    cursor.consume();
    const directionToken = cursor.peek();
    if (
      !directionToken ||
      directionToken.type !== 'Ident' ||
      (directionToken.value.toLowerCase() !== 'preceding' &&
        directionToken.value.toLowerCase() !== 'following')
    ) {
      throw new Error('Invalid numeric frame bound');
    }
    cursor.consume();
    return `${first.value} ${directionToken.value.toLowerCase()}`;
  }

  throw new Error(`Invalid window frame bound '${first.value}'`);
}

function consumeUntilParen(cursor: DomainTokenCursor): string {
  const parts: string[] = [];
  while (!cursor.eof) {
    const token = cursor.peek();
    if (token?.type === 'ParenClose') {
      cursor.consume();
      break;
    }
    parts.push(token?.value ?? '');
    cursor.consume();
  }
  return parts.join(' ');
}

function parseOrderedFieldToken(
  functionId: string,
  token: ExprToken,
  options: DomainParseOptions = {}
): string {
  if (token.type === 'FieldRef') return requiredField(functionId, token.value, 1);
  if (token.type === 'Ident' && options.allowBareIdentifiers) return token.value;
  throw new Error(
    `Calculation function '${functionId}' requires field references in over(...) as [field], got '${token.value}'`
  );
}

function isFrameStartBeforeOrEqual(start: string | undefined, end: string | undefined): boolean {
  if (!start || !end) return true;
  const startBound = parseFrameBoundForOrder(start);
  const endBound = parseFrameBoundForOrder(end);
  if (startBound === null || endBound === null) return true;
  if (startBound.category !== endBound.category) return startBound.category < endBound.category;

  if (startBound.category === 1 || startBound.category === 3) {
    const startOffset = startBound.offset ?? 0;
    const endOffset = endBound.offset ?? 0;
    if (startBound.category === 1) {
      return startOffset >= endOffset;
    }
    return startOffset <= endOffset;
  }
  return true;
}

function parseFrameBoundForOrder(bound: string): { category: number; offset?: number } | null {
  const lower = bound.toLowerCase();
  if (lower === 'unbounded preceding') return { category: 0 };
  if (lower === 'unbounded following') return { category: 4 };
  if (lower === 'current row') return { category: 2 };
  const singlePreceding = /^(\d+) preceding$/.exec(lower);
  if (singlePreceding) {
    return { category: 1, offset: Number(singlePreceding[1]) };
  }
  const singleFollowing = /^(\d+) following$/.exec(lower);
  if (singleFollowing) {
    return { category: 3, offset: Number(singleFollowing[1]) };
  }
  const interval = /^interval (\d+) (day|week|month|quarter|year) (preceding|following)$/.exec(
    lower
  );
  if (interval) {
    return {
      category: interval[3] === 'preceding' ? 1 : 3,
      offset: Number(interval[1]),
    };
  }
  return null;
}

function requireArgumentCount(functionId: string, args: string[], expected: number): void {
  if (args.length !== expected) {
    throw new Error(`Calculation function '${functionId}' expects ${expected} arguments`);
  }
}

function requireArgumentRange(functionId: string, args: string[], min: number, max: number): void {
  if (args.length < min || args.length > max) {
    throw new Error(`Calculation function '${functionId}' expects ${min} to ${max} arguments`);
  }
}

function requiredValue(functionId: string, value: string, position: number): string {
  if (!value.trim()) {
    throw new Error(`Calculation function '${functionId}' requires argument ${position}`);
  }
  return value.trim();
}

function requiredField(functionId: string, value: string, position: number): string {
  const field = parseFieldRefExact(value);
  if (!field) {
    throw new Error(`Calculation function '${functionId}' argument ${position} must be a field`);
  }
  return toFieldName(field);
}

function requiredString(functionId: string, value: string, position: number): string {
  if (!(value.startsWith('"') && value.endsWith('"'))) {
    throw new Error(
      `Calculation function '${functionId}' argument ${position} must be a double-quoted string`
    );
  }
  return String(parseLiteral(value));
}

function positiveInteger(functionId: string, value: string, position: number, max: number): string {
  if (!isIntegerString(value)) {
    throw new Error(`Calculation function '${functionId}' argument ${position} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(
      `Calculation function '${functionId}' argument ${position} is outside its range`
    );
  }
  return String(parsed);
}

function requiredParameter(input: CalculationFunctionInput, key: string): string {
  const value = input.parameters?.[key]?.trim();
  if (!value) throw new Error(`Calculation function '${input.functionId}' requires '${key}'`);
  return value;
}

function parameterDefault(
  definition: CalculationFunctionDefinition,
  key: string,
  fallback: string
): string {
  return getCalculationParameter(definition, key)?.defaultValue ?? fallback;
}

function parameterMax(functionId: string, key: string, fallback: number): number {
  const definition = getCalculationFunction(functionId);
  return definition ? (getCalculationParameter(definition, key)?.max ?? fallback) : fallback;
}

function integerParameter(input: CalculationFunctionInput, key: string, fallback: string): string {
  const definition = getCalculationFunction(input.functionId);
  const parameter = definition ? getCalculationParameter(definition, key) : undefined;
  const min = parameter?.min ?? 1;
  const max = parameter?.max ?? MAX_CALCULATION_WINDOW_SIZE;
  const raw = input.parameters?.[key]?.trim() || fallback;
  if (!isIntegerString(raw)) throw new Error(`Calculation parameter '${key}' must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Calculation parameter '${key}' is outside its range`);
  }
  return String(value);
}

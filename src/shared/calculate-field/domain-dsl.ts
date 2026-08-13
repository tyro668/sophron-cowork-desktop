import { parseFieldRefExact, toFieldName } from '../prep-dsl/syntax/fields';
import { parseLiteral, quoteString } from '../prep-dsl/syntax/literals';
import { splitTopLevel } from '../prep-dsl/syntax/scanner';
import { tokenizeExpression, type ExprToken } from '../expression-tokenizer';
import {
  buildCalculationFunctionExpression,
  formatCalculationField,
  getCalculationFunction,
  getCalculationParameter,
  MAX_CALCULATION_WINDOW_SIZE,
  MAX_FISCAL_START_MONTH,
  type CalculationFunctionDefinition,
  type CalculationFunctionInput,
} from './function-registry';

const DOMAIN_FUNCTION_IDS = new Set([
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
]);

const PERIOD_GRAINS = new Set(['year', 'quarter', 'month', 'week', 'day']);
const INTERVAL_UNITS = new Set(['day', 'week', 'month', 'quarter', 'year']);
const TIME_AGGREGATIONS = new Set(['sum', 'avg', 'count', 'min', 'max']);

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

  const value = formatValue(definition, input);
  const date = formatCalculationField(requiredParameter(input, 'dateField'));
  const over = formatPartition(input.partitionBy);
  if (definition.category === 'period_compare') {
    const args = [value, date];
    if (input.functionId.startsWith('year_over_year_')) {
      const granularity = parameterDefault(definition, 'granularity', 'month');
      args.push(quoteString(input.parameters?.granularity || granularity));
    }
    return `${input.functionId}(${args.join(', ')})${over}`;
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
  return `${input.functionId}(${args.join(', ')})${over}`;
}

export function expandCalculationDomainExpression(expression: string): string {
  const parsed = parseDomainExpression(expression);
  return parsed ? buildCalculationFunctionExpression(parsed) : expression;
}

export function normalizeCalculationDomainExpression(expression: string): string {
  const parsed = parseDomainExpression(expression);
  return parsed ? buildCalculationFunctionDslExpression(parsed) : expression;
}

function parseDomainExpression(expression: string): CalculationFunctionInput | null {
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
  const partitionBy = parsePartition(expression.slice(closeToken.end).trim());

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
  return definition.category === 'period_compare' || definition.category === 'time_intelligence';
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

function requireArgumentCount(functionId: string, args: string[], expected: number): void {
  if (args.length !== expected) {
    throw new Error(`Calculation function '${functionId}' expects ${expected} arguments`);
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

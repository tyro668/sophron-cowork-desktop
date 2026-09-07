import { buildExtraParameter, formatCalculationField } from './expression-format';
import {
  integerParameter,
  INTERVAL_UNITS,
  requiredParameter,
  validateCalculationFunctionInput,
  validateTimeAggregation,
} from './function-input';
import { validateWindowFrame } from './window-frame';
import {
  getCalculationFunction,
  type CalculationFunctionDefinition,
  type CalculationFunctionInput,
} from './function-registry';

export function buildCalculationFunctionExpression(input: CalculationFunctionInput): string {
  const definition = getCalculationFunction(input.functionId);
  if (!definition) throw new Error(`Unknown calculation function '${input.functionId}'`);
  validateCalculationFunctionInput(definition, input);

  const value = input.valueIsExpression
    ? requireDomainValueExpression(definition, input.value)
    : buildValueArgument(definition, input.value);
  const extraParameter = buildExtraParameter(definition, input.extraParameter);
  const over = buildOverClause(definition, input);
  const nativeFunction = nativeFunctionName(definition);
  const args = [value, extraParameter].filter((argument) => argument !== '').join(', ');

  if (definition.category === 'period_compare') {
    return buildPeriodComparisonExpression(definition.id, value, input);
  }
  if (definition.category === 'time_intelligence') {
    return buildTimeIntelligenceExpression(definition.id, value, input);
  }

  switch (definition.expressionKind) {
    case 'count-distinct':
      return `count(DISTINCT ${value})${over}`;
    case 'percentage':
      return `${value} / sum(${value})${over}`;
    case 'offset-diff': {
      const previous = `lag(${value}, ${extraParameter})${over}`;
      return `${value} - ${previous}`;
    }
    case 'offset-rate': {
      const previous = `lag(${value}, ${extraParameter})${over}`;
      return `(${value} - ${previous}) / nullif(${previous}, 0)`;
    }
    default:
      return `${nativeFunction}(${args})${over}`;
  }
}

function requireDomainValueExpression(
  definition: CalculationFunctionDefinition,
  rawValue: string | undefined
): string {
  const value = rawValue?.trim() || '';
  if (!value)
    throw new Error(`Calculation function '${definition.id}' requires a value expression`);
  if (value === '*' && definition.valueArgument !== 'field-or-star') {
    throw new Error(`Calculation function '${definition.id}' does not accept '*'`);
  }
  return value;
}

function buildPeriodComparisonExpression(
  functionId: string,
  value: string,
  input: CalculationFunctionInput
): string {
  const date = formatCalculationField(requiredParameter(input, 'dateField'));
  const partition = (input.partitionBy ?? []).filter(Boolean).map(formatCalculationField);
  if (functionId.startsWith('previous_')) {
    const over = ` OVER (${[
      partition.length ? `PARTITION BY ${partition.join(', ')}` : '',
      `ORDER BY ${date}`,
    ]
      .filter(Boolean)
      .join(' ')})`;
    return comparisonResult(functionId, value, `lag(${value})${over}`);
  }

  const granularity = input.parameters?.granularity || 'month';
  const year =
    granularity === 'week' ? `extract('isoyear' FROM ${date})` : `extract('year' FROM ${date})`;
  const naturalKeys = periodNaturalKeys(granularity, date);
  const partitionKeys = [...partition, ...naturalKeys];
  const over = ` OVER (${[
    partitionKeys.length ? `PARTITION BY ${partitionKeys.join(', ')}` : '',
    `ORDER BY ${year}`,
  ]
    .filter(Boolean)
    .join(' ')})`;
  const previous = `lag(${value})${over}`;
  const previousYear = `lag(${year})${over}`;
  const guardedPrevious = `CASE WHEN (${year} - ${previousYear}) = 1 THEN ${previous} ELSE NULL END`;
  return comparisonResult(functionId, value, guardedPrevious);
}

function comparisonResult(functionId: string, value: string, previous: string): string {
  if (functionId.endsWith('_value')) return previous;
  if (functionId.endsWith('_difference')) return `${value} - (${previous})`;
  return `(${value} - (${previous})) / nullif((${previous}), 0)`;
}

function periodNaturalKeys(granularity: string, date: string): string[] {
  if (granularity === 'year') return [];
  if (granularity === 'quarter') return [`extract('quarter' FROM ${date})`];
  if (granularity === 'month') return [`extract('month' FROM ${date})`];
  if (granularity === 'week') return [`extract('week' FROM ${date})`];
  if (granularity === 'day') {
    return [`extract('month' FROM ${date})`, `extract('day' FROM ${date})`];
  }
  throw new Error(`Unsupported period granularity '${granularity}'`);
}

function buildTimeIntelligenceExpression(
  functionId: string,
  value: string,
  input: CalculationFunctionInput
): string {
  const date = formatCalculationField(requiredParameter(input, 'dateField'));
  const aggregation = input.parameters?.aggregation || 'sum';
  const aggregate = buildTimeAggregate(aggregation, value);
  const userPartition = (input.partitionBy ?? []).filter(Boolean).map(formatCalculationField);
  if (functionId === 'rolling_time') {
    const size = integerParameter(input, 'windowSize', '7');
    const unit = input.parameters?.intervalUnit || 'day';
    if (!INTERVAL_UNITS.has(unit)) {
      throw new Error(`Unsupported rolling interval unit '${unit}'`);
    }
    return `${aggregate} OVER (${[
      userPartition.length ? `PARTITION BY ${userPartition.join(', ')}` : '',
      `ORDER BY ${date}`,
      `RANGE BETWEEN INTERVAL ${size} ${unit.toUpperCase()} PRECEDING AND CURRENT ROW`,
    ]
      .filter(Boolean)
      .join(' ')})`;
  }

  const periodPartition = timePeriodPartition(functionId, date, input);
  return `${aggregate} OVER (PARTITION BY ${[periodPartition, ...userPartition].join(', ')} ORDER BY ${date} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`;
}

function buildTimeAggregate(aggregation: string, value: string): string {
  validateTimeAggregation(aggregation, value);
  if (aggregation === 'count_distinct') {
    return `count(DISTINCT ${value})`;
  }
  return `${aggregation}(${value})`;
}

function timePeriodPartition(
  functionId: string,
  date: string,
  input: CalculationFunctionInput
): string {
  const year =
    functionId === 'week_to_date'
      ? `extract('isoyear' FROM ${date})`
      : `extract('year' FROM ${date})`;
  if (functionId === 'year_to_date') {
    const fiscalMonth = integerParameter(input, 'fiscalStartMonth', '1');
    if (fiscalMonth === '1') return year;
    return `CASE WHEN extract('month' FROM ${date}) >= ${fiscalMonth} THEN ${year} ELSE ${year} - 1 END`;
  }
  if (functionId === 'quarter_to_date') {
    return `${year}, extract('quarter' FROM ${date})`;
  }
  if (functionId === 'month_to_date') return `${year}, extract('month' FROM ${date})`;
  if (functionId === 'week_to_date') return `${year}, extract('week' FROM ${date})`;
  throw new Error(`Unsupported time intelligence function '${functionId}'`);
}

function nativeFunctionName(definition: CalculationFunctionDefinition): string {
  const prefix = definition.category === 'cumulative' ? 'cumulative_' : 'moving_';
  if (definition.id.startsWith(prefix)) return definition.id.slice(prefix.length);
  return definition.id === 'var' ? 'var_pop' : definition.id;
}

function buildValueArgument(
  definition: CalculationFunctionDefinition,
  rawValue: string | undefined
): string {
  if (definition.valueArgument === 'none') return '';
  const value = rawValue?.trim() || (definition.valueArgument === 'field-or-star' ? '*' : '');
  if (!value) throw new Error(`Calculation function '${definition.id}' requires a value field`);
  if (value === '*') {
    if (definition.valueArgument !== 'field-or-star') {
      throw new Error(`Calculation function '${definition.id}' does not accept '*'`);
    }
    return value;
  }
  return formatCalculationField(value);
}

function buildOverClause(
  definition: CalculationFunctionDefinition,
  input: CalculationFunctionInput
): string {
  const orderBy =
    definition.order === 'required'
      ? (input.orderBy ?? []).filter((entry) => entry.field.trim())
      : [];
  if (definition.order === 'required' && orderBy.length === 0) {
    throw new Error(`Calculation function '${definition.id}' requires order fields`);
  }

  const clauses: string[] = [];
  const partitionBy = (input.partitionBy ?? []).filter((field) => field.trim());
  if (partitionBy.length > 0) {
    clauses.push(`PARTITION BY ${partitionBy.map(formatCalculationField).join(', ')}`);
  }
  if (orderBy.length > 0) {
    clauses.push(
      `ORDER BY ${orderBy
        .map(
          ({ field, direction }) =>
            `${formatCalculationField(field)}${direction === 'desc' ? ' desc' : ''}`
        )
        .join(', ')}`
    );
  }

  if (definition.frame === 'cumulative') {
    clauses.push('ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW');
  } else if (definition.category === 'offset') {
    clauses.push('ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING');
  } else if (definition.frame === 'custom') {
    const frame = input.frame;
    if (!frame) throw new Error(`Calculation function '${definition.id}' requires a window frame`);
    validateWindowFrame(definition.id, frame, orderBy.length);
    clauses.push(
      `${frame.type.toUpperCase()} BETWEEN ${frame.start.toUpperCase()} AND ${frame.end.toUpperCase()}`
    );
    if (frame.exclude && frame.exclude !== 'no others') {
      clauses.push(`EXCLUDE ${frame.exclude.toUpperCase()}`);
    }
  }

  return ` OVER (${clauses.join(' ')})`;
}

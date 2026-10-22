import { quoteSqlString as quoteString } from '../../prep-dsl/syntax/literals';
import { buildExtraParameter, formatCalculationField } from '../expression-format';
import {
  integerParameter,
  INTERVAL_UNITS,
  parameterDefault,
  requiredParameter,
  TIME_AGGREGATIONS,
  validateCalculationFunctionInput,
} from '../function-input';
import {
  calculationOperationDslId,
  calculationSceneDslId,
  getCalculationFunction,
  type CalculationFunctionDefinition,
  type CalculationFunctionInput,
  type CalculationOrderField,
} from '../function-registry';
import { parseWindowFrameBound, validateWindowFrameOrder } from '../window-frame';

export function buildCalculationFunctionDslExpression(input: CalculationFunctionInput): string {
  const definition = getCalculationFunction(input.functionId);
  if (!definition) throw new Error(`Unknown calculation function '${input.functionId}'`);

  validateCalculationFunctionInput(definition, input);

  const canonicalId = canonicalDomainFunctionId(definition);
  if (definition.category === 'ranking') {
    const args =
      definition.id === 'ntile' ? [buildExtraParameter(definition, input.extraParameter)] : [];
    return (
      wrapScene(definition, `${canonicalId}(${args.join(', ')})`) +
      formatOrderedPartition(input.partitionBy, input.orderBy)
    );
  }
  const value = formatValue(definition, input);
  if (definition.category === 'group_metrics') {
    return formatGroupMetricDslExpression(definition, input, canonicalId, value);
  }
  if (definition.category === 'cumulative') {
    return (
      wrapScene(definition, `${canonicalId}(${value})`) +
      formatOrderedPartition(input.partitionBy, input.orderBy)
    );
  }
  if (definition.category === 'moving_window') {
    return wrapScene(definition, `${canonicalId}(${value})`) + formatMovingWindowOver(input);
  }
  if (definition.category === 'offset') {
    const args = [value];
    const extraParameter = input.extraParameter;
    if (extraParameter) args.push(buildExtraParameter(definition, extraParameter));
    const orderedOver = formatOrderedPartition(input.partitionBy, input.orderBy);
    return wrapScene(definition, `${canonicalId}(${args.join(', ')})`) + orderedOver;
  }
  const over = formatPartition(input.partitionBy);
  const date = formatCalculationField(requiredParameter(input, 'dateField'));
  if (definition.category === 'period_compare') {
    const args = [value, date];
    if (input.functionId.startsWith('year_over_year_')) {
      const granularity = parameterDefault(definition, 'granularity', 'month');
      args.push(quoteString(input.parameters?.granularity || granularity));
    }
    const result = input.functionId.endsWith('_value')
      ? 'value'
      : input.functionId.endsWith('_difference')
        ? 'difference'
        : 'change_rate';
    args.push(quoteString(result));
    return wrapScene(definition, `${canonicalId}(${args.join(', ')})`) + over;
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
    return (
      wrapScene(
        definition,
        `rolling_time(${aggregate}, ${date}, ${size}, ${quoteString(intervalUnit)})`
      ) + over
    );
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
  return wrapScene(definition, `${canonicalId}(${args.join(', ')})`) + over;
}

function canonicalDomainFunctionId(definition: CalculationFunctionDefinition): string {
  return calculationOperationDslId(definition);
}

function wrapScene(definition: CalculationFunctionDefinition, operation: string): string {
  return `${calculationSceneDslId(definition.category)}(${operation})`;
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
  return (
    wrapScene(definition, `${canonicalId}(${args.join(', ')})`) + formatPartition(input.partitionBy)
  );
}

function formatMovingWindowOver(input: CalculationFunctionInput): string {
  const frame = input.frame;
  if (!frame) {
    throw new Error(`Calculation function '${input.functionId}' requires a window frame`);
  }
  if (
    !validateWindowFrameOrder(parseWindowFrameBound(frame.start), parseWindowFrameBound(frame.end))
  ) {
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

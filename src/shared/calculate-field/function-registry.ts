import { isTemporalDataFieldType } from '../data-field-types';
import { formatCalculationStringLiteral } from './index';

export type CalculationFunctionCategory =
  | 'group_metrics'
  | 'ranking'
  | 'cumulative'
  | 'offset'
  | 'moving_window'
  | 'period_compare'
  | 'time_intelligence';

export type CalculationValueArgument = 'none' | 'field' | 'field-or-star';
export type CalculationOrderRequirement = 'none' | 'required';
export type CalculationFrameMode = 'none' | 'cumulative' | 'custom';

export interface CalculationExtraParameter {
  kind: 'integer' | 'number' | 'text';
  defaultValue: string;
  min?: number;
  max?: number;
  labelKey: string;
}

export interface CalculationFunctionDefinition {
  id: string;
  category: CalculationFunctionCategory;
  labelKey: string;
  valueArgument: CalculationValueArgument;
  order: CalculationOrderRequirement;
  frame: CalculationFrameMode;
  extraParameter?: CalculationExtraParameter;
  expressionKind?: 'native' | 'count-distinct' | 'percentage' | 'offset-diff' | 'offset-rate';
  parameters?: CalculationFunctionParameter[];
}

export interface CalculationFunctionParameter {
  key: string;
  kind: 'temporal-field' | 'option' | 'integer';
  labelKey: string;
  defaultValue?: string;
  min?: number;
  max?: number;
  options?: Array<{ value: string; labelKey: string }>;
}

export const MAX_CALCULATION_WINDOW_SIZE = 1_000_000;
export const MIN_FISCAL_START_MONTH = 1;
export const MAX_FISCAL_START_MONTH = 12;

export function getCalculationParameter(
  definition: CalculationFunctionDefinition,
  key: string
): CalculationFunctionParameter | undefined {
  return definition.parameters?.find((parameter) => parameter.key === key);
}

export interface CalculationOrderField {
  field: string;
  direction: 'asc' | 'desc';
}

export interface CalculationWindowFrame {
  type: 'rows' | 'range' | 'groups';
  start: string;
  end: string;
  exclude?: 'current row' | 'group' | 'ties' | 'no others';
}

export interface CalculationFunctionInput {
  functionId: string;
  value?: string;
  extraParameter?: string;
  partitionBy?: string[];
  orderBy?: CalculationOrderField[];
  frame?: CalculationWindowFrame;
  parameters?: Record<string, string>;
  valueIsExpression?: boolean;
}

export function usesTemporalCalculationRangeUnit(
  frameType: CalculationWindowFrame['type'],
  orderBy: CalculationOrderField[],
  columnTypes?: Record<string, string>
): boolean {
  const configuredOrderBy = orderBy.filter((item) => item.field.trim());
  return (
    frameType === 'range' &&
    configuredOrderBy.length > 0 &&
    isTemporalDataFieldType(columnTypes?.[configuredOrderBy[0].field])
  );
}

const groupMetricFunctions: CalculationFunctionDefinition[] = [
  ...['sum', 'avg', 'min', 'max', 'median', 'stddev', 'var', 'mode', 'bool_and', 'bool_or'].map(
    (id): CalculationFunctionDefinition => ({
      id,
      category: 'group_metrics',
      labelKey: `calcFieldFn_${id}`,
      valueArgument: 'field',
      order: 'none',
      frame: 'none',
    })
  ),
  {
    id: 'count',
    category: 'group_metrics',
    labelKey: 'calcFieldFn_count',
    valueArgument: 'field-or-star',
    order: 'none',
    frame: 'none',
  },
  {
    id: 'count_distinct',
    category: 'group_metrics',
    labelKey: 'calcFieldFn_count_distinct',
    valueArgument: 'field',
    order: 'none',
    frame: 'none',
    expressionKind: 'count-distinct',
  },
  {
    id: 'quantile_cont',
    category: 'group_metrics',
    labelKey: 'calcFieldFn_quantile_cont',
    valueArgument: 'field',
    order: 'none',
    frame: 'none',
    extraParameter: {
      kind: 'number',
      defaultValue: '0.5',
      min: 0,
      max: 1,
      labelKey: 'calcFieldPlaceholderQuantile',
    },
  },
  {
    id: 'string_agg',
    category: 'group_metrics',
    labelKey: 'calcFieldFn_string_agg',
    valueArgument: 'field',
    order: 'none',
    frame: 'none',
    extraParameter: {
      kind: 'text',
      defaultValue: ', ',
      labelKey: 'calcFieldPlaceholderDelimiter',
    },
  },
  {
    id: 'percentage',
    category: 'group_metrics',
    labelKey: 'calcFieldFn_percentage',
    valueArgument: 'field',
    order: 'none',
    frame: 'none',
    expressionKind: 'percentage',
  },
];

const rankingFunctions: CalculationFunctionDefinition[] = [
  ...['row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist'].map(
    (id): CalculationFunctionDefinition => ({
      id,
      category: 'ranking',
      labelKey: `calcFieldFn_${id}`,
      valueArgument: 'none',
      order: 'required',
      frame: 'none',
    })
  ),
  {
    id: 'ntile',
    category: 'ranking',
    labelKey: 'calcFieldFn_ntile',
    valueArgument: 'none',
    order: 'required',
    frame: 'none',
    extraParameter: {
      kind: 'integer',
      defaultValue: '4',
      min: 1,
      max: MAX_CALCULATION_WINDOW_SIZE,
      labelKey: 'calcFieldPlaceholderBuckets',
    },
  },
];

const cumulativeFunctions = ['sum', 'avg', 'count', 'min', 'max', 'product'].map(
  (id): CalculationFunctionDefinition => ({
    id: `cumulative_${id}`,
    category: 'cumulative',
    labelKey: `calcFieldFn_${id}`,
    valueArgument: id === 'count' ? 'field-or-star' : 'field',
    order: 'required',
    frame: 'cumulative',
  })
);

const offsetFunctions: CalculationFunctionDefinition[] = [
  ...['first_value', 'last_value'].map(
    (id): CalculationFunctionDefinition => ({
      id,
      category: 'offset',
      labelKey: `calcFieldFn_${id}`,
      valueArgument: 'field',
      order: 'required',
      frame: 'none',
    })
  ),
  {
    id: 'nth_value',
    category: 'offset',
    labelKey: 'calcFieldFn_nth_value',
    valueArgument: 'field',
    order: 'required',
    frame: 'none',
    extraParameter: {
      kind: 'integer',
      defaultValue: '2',
      min: 1,
      max: MAX_CALCULATION_WINDOW_SIZE,
      labelKey: 'calcFieldPlaceholderNth',
    },
  },
  ...['lag', 'lead'].map(
    (id): CalculationFunctionDefinition => ({
      id,
      category: 'offset',
      labelKey: `calcFieldFn_${id}`,
      valueArgument: 'field',
      order: 'required',
      frame: 'none',
      extraParameter: {
        kind: 'integer',
        defaultValue: '1',
        min: 0,
        max: MAX_CALCULATION_WINDOW_SIZE,
        labelKey: 'calcFieldPlaceholderOffset',
      },
    })
  ),
  ...(['offset_diff', 'offset_rate'] as const).map(
    (id): CalculationFunctionDefinition => ({
      id,
      category: 'offset',
      labelKey: `calcFieldFn_${id}`,
      valueArgument: 'field',
      order: 'required',
      frame: 'none',
      expressionKind: id === 'offset_diff' ? 'offset-diff' : 'offset-rate',
      extraParameter: {
        kind: 'integer',
        defaultValue: '1',
        min: 1,
        max: MAX_CALCULATION_WINDOW_SIZE,
        labelKey: 'calcFieldPlaceholderOffset',
      },
    })
  ),
];

const movingWindowFunctions = ['sum', 'avg', 'count', 'min', 'max'].map(
  (id): CalculationFunctionDefinition => ({
    id: `moving_${id}`,
    category: 'moving_window',
    labelKey: `calcFieldFn_${id}`,
    valueArgument: id === 'count' ? 'field-or-star' : 'field',
    order: 'required',
    frame: 'custom',
  })
);

const dateFieldParameter: CalculationFunctionParameter = {
  key: 'dateField',
  kind: 'temporal-field',
  labelKey: 'calcFieldDateColumn',
};
const aggregationParameter: CalculationFunctionParameter = {
  key: 'aggregation',
  kind: 'option',
  labelKey: 'calcFieldTimeAgg',
  defaultValue: 'sum',
  options: ['sum', 'avg', 'count', 'count_distinct', 'min', 'max'].map((value) => ({
    value,
    labelKey: `calcFieldTimeAgg_${value}`,
  })),
};

const periodCompareFunctions: CalculationFunctionDefinition[] = [
  ...(['previous_value', 'previous_difference', 'previous_rate'] as const).map((id) => ({
    id,
    category: 'period_compare' as const,
    labelKey: `calcFieldFn_${id}`,
    valueArgument: 'field' as const,
    order: 'none' as const,
    frame: 'none' as const,
    parameters: [dateFieldParameter],
  })),
  ...(['year_over_year_value', 'year_over_year_difference', 'year_over_year_rate'] as const).map(
    (id) => ({
      id,
      category: 'period_compare' as const,
      labelKey: `calcFieldFn_${id}`,
      valueArgument: 'field' as const,
      order: 'none' as const,
      frame: 'none' as const,
      parameters: [
        dateFieldParameter,
        {
          key: 'granularity',
          kind: 'option' as const,
          labelKey: 'calcFieldPeriodGranularity',
          defaultValue: 'month',
          options: ['year', 'quarter', 'month', 'week', 'day'].map((value) => ({
            value,
            labelKey: `calcFieldGranularity_${value}`,
          })),
        },
      ],
    })
  ),
];

const timeIntelligenceFunctions: CalculationFunctionDefinition[] = [
  ...(['year_to_date', 'quarter_to_date', 'month_to_date', 'week_to_date'] as const).map((id) => ({
    id,
    category: 'time_intelligence' as const,
    labelKey: `calcFieldFn_${id}`,
    valueArgument: 'field-or-star' as const,
    order: 'none' as const,
    frame: 'none' as const,
    parameters: [
      aggregationParameter,
      dateFieldParameter,
      ...(id === 'year_to_date'
        ? [
            {
              key: 'fiscalStartMonth',
              kind: 'integer' as const,
              labelKey: 'calcFieldFiscalStart',
              defaultValue: '1',
              min: MIN_FISCAL_START_MONTH,
              max: MAX_FISCAL_START_MONTH,
            },
          ]
        : []),
    ],
  })),
  {
    id: 'rolling_time',
    category: 'time_intelligence',
    labelKey: 'calcFieldFn_rolling_time',
    valueArgument: 'field-or-star',
    order: 'none',
    frame: 'none',
    parameters: [
      aggregationParameter,
      dateFieldParameter,
      {
        key: 'windowSize',
        kind: 'integer',
        labelKey: 'calcFieldWindowSize',
        defaultValue: '7',
        min: 1,
        max: MAX_CALCULATION_WINDOW_SIZE,
      },
      {
        key: 'intervalUnit',
        kind: 'option',
        labelKey: 'calcFieldIntervalUnit',
        defaultValue: 'day',
        options: ['day', 'week', 'month', 'quarter', 'year'].map((value) => ({
          value,
          labelKey: `calcFieldInterval_${value}`,
        })),
      },
    ],
  },
];

export const CALCULATION_FUNCTIONS: readonly CalculationFunctionDefinition[] = [
  ...groupMetricFunctions,
  ...rankingFunctions,
  ...cumulativeFunctions,
  ...offsetFunctions,
  ...movingWindowFunctions,
  ...periodCompareFunctions,
  ...timeIntelligenceFunctions,
];

export const CALCULATION_FUNCTION_CATEGORIES: readonly CalculationFunctionCategory[] = [
  'group_metrics',
  'ranking',
  'cumulative',
  'offset',
  'moving_window',
  'period_compare',
  'time_intelligence',
];

export function calculationFunctionsByCategory(
  category: CalculationFunctionCategory
): CalculationFunctionDefinition[] {
  return CALCULATION_FUNCTIONS.filter((definition) => definition.category === category);
}

export function getCalculationFunction(
  functionId: string
): CalculationFunctionDefinition | undefined {
  return CALCULATION_FUNCTIONS.find((definition) => definition.id === functionId);
}

export function buildCalculationFunctionExpression(input: CalculationFunctionInput): string {
  const definition = getCalculationFunction(input.functionId);
  if (!definition) throw new Error(`Unknown calculation function '${input.functionId}'`);

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

function requiredParameter(input: CalculationFunctionInput, key: string): string {
  const value = input.parameters?.[key]?.trim();
  if (!value) throw new Error(`Calculation function '${input.functionId}' requires '${key}'`);
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
    const size = validateIntegerParameter(input, 'windowSize', 1, MAX_CALCULATION_WINDOW_SIZE, '7');
    const unit = input.parameters?.intervalUnit || 'day';
    if (!['day', 'week', 'month', 'quarter', 'year'].includes(unit)) {
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
  if (aggregation === 'count_distinct') {
    if (value === '*') throw new Error("Time aggregation 'count_distinct' requires a value field");
    return `count(DISTINCT ${value})`;
  }
  if (!['sum', 'avg', 'count', 'min', 'max'].includes(aggregation)) {
    throw new Error(`Unsupported time aggregation '${aggregation}'`);
  }
  if (value === '*' && aggregation !== 'count') {
    throw new Error(`Time aggregation '${aggregation}' does not accept '*'`);
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
    const fiscalMonth = validateIntegerParameter(input, 'fiscalStartMonth', 1, 12, '1');
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

function validateIntegerParameter(
  input: CalculationFunctionInput,
  key: string,
  min: number,
  max: number,
  fallback: string
): string {
  const raw = input.parameters?.[key]?.trim() || fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`Calculation parameter '${key}' must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Calculation parameter '${key}' is outside its range`);
  }
  return String(value);
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

function buildExtraParameter(
  definition: CalculationFunctionDefinition,
  rawValue: string | undefined
): string {
  const parameter = definition.extraParameter;
  if (!parameter) return '';
  if (parameter.kind === 'text') {
    const value = rawValue === undefined || rawValue === '' ? parameter.defaultValue : rawValue;
    return formatCalculationStringLiteral(value);
  }
  const value = rawValue?.trim() || parameter.defaultValue;
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`Calculation function '${definition.id}' requires a numeric parameter`);
  }
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    (parameter.kind === 'integer' && !Number.isSafeInteger(parsed)) ||
    (parameter.min !== undefined && parsed < parameter.min) ||
    (parameter.max !== undefined && parsed > parameter.max)
  ) {
    throw new Error(`Calculation function '${definition.id}' parameter is outside its range`);
  }
  return String(parsed);
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

interface ParsedFrameBound {
  position:
    | 'unbounded-preceding'
    | 'preceding'
    | 'current-row'
    | 'following'
    | 'unbounded-following';
  offset?: number;
  unit?: string;
}

function validateWindowFrame(
  functionId: string,
  frame: CalculationWindowFrame,
  orderFieldCount: number
): void {
  const start = parseFrameBound(functionId, frame.start);
  const end = parseFrameBound(functionId, frame.end);
  if (
    frame.type === 'range' &&
    (isOffsetFrameBound(start) || isOffsetFrameBound(end)) &&
    orderFieldCount !== 1
  ) {
    throw new Error(
      `Calculation function '${functionId}' requires exactly one order field for a RANGE offset`
    );
  }
  if (!isFrameStartBeforeOrEqual(start, end)) {
    throw new Error(`Calculation function '${functionId}' frame start must not be after its end`);
  }
}

function parseFrameBound(functionId: string, bound: string): ParsedFrameBound {
  const normalized = bound.trim();
  if (/^unbounded preceding$/i.test(normalized)) return { position: 'unbounded-preceding' };
  if (/^current row$/i.test(normalized)) return { position: 'current-row' };
  if (/^unbounded following$/i.test(normalized)) return { position: 'unbounded-following' };

  const numeric = /^(\d+) (preceding|following)$/i.exec(normalized);
  if (numeric) {
    return {
      position: numeric[2].toLowerCase() as 'preceding' | 'following',
      offset: Number(numeric[1]),
    };
  }

  const interval = /^interval (\d+) (day|week|month|quarter|year) (preceding|following)$/i.exec(
    normalized
  );
  if (interval) {
    return {
      position: interval[3].toLowerCase() as 'preceding' | 'following',
      offset: Number(interval[1]),
      unit: interval[2].toLowerCase(),
    };
  }

  throw new Error(`Calculation function '${functionId}' has an invalid window frame bound`);
}

function isOffsetFrameBound(bound: ParsedFrameBound): boolean {
  return bound.position === 'preceding' || bound.position === 'following';
}

function isFrameStartBeforeOrEqual(start: ParsedFrameBound, end: ParsedFrameBound): boolean {
  if (start.position === 'unbounded-following' || end.position === 'unbounded-preceding') {
    return false;
  }

  const positionRank: Record<ParsedFrameBound['position'], number> = {
    'unbounded-preceding': 0,
    preceding: 1,
    'current-row': 2,
    following: 3,
    'unbounded-following': 4,
  };
  const startRank = positionRank[start.position];
  const endRank = positionRank[end.position];
  if (startRank !== endRank) return startRank < endRank;

  const comparableOffsets = start.unit === end.unit;
  if (!comparableOffsets || start.offset === undefined || end.offset === undefined) return true;
  if (start.position === 'preceding') return start.offset >= end.offset;
  if (start.position === 'following') return start.offset <= end.offset;
  return true;
}

export function formatCalculationField(value: string): string {
  const field = value.replace(/^\[|\]$/g, '');
  if (!/[\]`\\]/.test(field)) return `[${field}]`;
  const escaped = field.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  return '[`' + escaped + '`]';
}

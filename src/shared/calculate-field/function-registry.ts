import { isTemporalDataFieldType } from '../data-field-types';
import { formatCalculationStringLiteral } from './index';

export type CalculationFunctionCategory =
  | 'group_metrics'
  | 'ranking'
  | 'cumulative'
  | 'offset'
  | 'moving_window';

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
      max: 1_000_000,
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
      max: 1_000_000,
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
        max: 1_000_000,
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
        max: 1_000_000,
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

export const CALCULATION_FUNCTIONS: readonly CalculationFunctionDefinition[] = [
  ...groupMetricFunctions,
  ...rankingFunctions,
  ...cumulativeFunctions,
  ...offsetFunctions,
  ...movingWindowFunctions,
];

export const CALCULATION_FUNCTION_CATEGORIES: readonly CalculationFunctionCategory[] = [
  'group_metrics',
  'ranking',
  'cumulative',
  'offset',
  'moving_window',
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

  const value = buildValueArgument(definition, input.value);
  const extraParameter = buildExtraParameter(definition, input.extraParameter);
  const over = buildOverClause(definition, input);
  const nativeFunction = nativeFunctionName(definition);
  const args = [value, extraParameter].filter((argument) => argument !== '').join(', ');

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

import { isTemporalDataFieldType } from '../data-field-types';
import type { CalculationWindowFrame } from './window-frame';

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
  domainDslId?: string;
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
      domainDslId: `group_${id}`,
      valueArgument: 'field',
      order: 'none',
      frame: 'none',
    })
  ),
  {
    id: 'count',
    category: 'group_metrics',
    labelKey: 'calcFieldFn_count',
    domainDslId: 'group_count',
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
    domainDslId: 'group_quantile_cont',
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
    domainDslId: 'group_string_agg',
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
      defaultValue: '2',
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
        min: 1,
        max: MAX_CALCULATION_WINDOW_SIZE,
        labelKey: 'calcFieldPlaceholderOffset',
      },
    })
  ),
  ...(['offset_difference', 'offset_rate'] as const).map(
    (id): CalculationFunctionDefinition => ({
      id,
      category: 'offset',
      labelKey: `calcFieldFn_${id}`,
      valueArgument: 'field',
      order: 'required',
      frame: 'none',
      expressionKind: id === 'offset_difference' ? 'offset-diff' : 'offset-rate',
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

export function calculationFunctionDslId(definition: CalculationFunctionDefinition): string {
  return definition.domainDslId ?? definition.id;
}

export function getCalculationFunctionByDslId(
  dslId: string
): CalculationFunctionDefinition | undefined {
  return CALCULATION_FUNCTIONS.find(
    (definition) => (definition.domainDslId ?? definition.id) === dslId
  );
}

export const DOMAIN_FUNCTION_IDS: ReadonlySet<string> = new Set(
  CALCULATION_FUNCTIONS.map((definition) => calculationFunctionDslId(definition))
);

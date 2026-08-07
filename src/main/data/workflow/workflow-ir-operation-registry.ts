import { DataCommandError } from '../data-command-types';
import type { WorkflowOperationIr } from './workflow-model';
import {
  getWorkflowAggregateCapabilityPrompt,
  getWorkflowAggregateFunctionDefinition,
  getWorkflowAggregateFunctionTypeScriptType,
  normalizeWorkflowAggregateFunction,
  WORKFLOW_AGGREGATE_FUNCTION_REGISTRY,
} from './workflow-aggregate-registry';
import {
  getWorkflowExpressionFunctionDefinition,
  isWorkflowDecimalScale,
  isWorkflowExpressionCastType,
  WORKFLOW_DECIMAL_SCALE_MAX,
  WORKFLOW_DECIMAL_SCALE_MIN,
  WORKFLOW_BINARY_EXPRESSION_OPERATORS,
  WORKFLOW_EXPRESSION_FUNCTION_NAMES,
  WORKFLOW_UNARY_EXPRESSION_OPERATORS,
  WORKFLOW_EXPRESSION_CAST_REGISTRY,
  WORKFLOW_EXPRESSION_CAST_TYPES,
  workflowExpressionArityDescription,
  workflowExpressionArityIsValid,
} from './workflow-expression-registry';
import { isAiPrepDslOperationEnabled } from './prep-dsl-capability-profile';

type WorkflowIrOperationType = WorkflowOperationIr['type'];

export interface WorkflowIrOperationDefinition {
  irType: WorkflowIrOperationType;
  promptSignature: string;
  typescriptPayload: string;
  validatePayload(operation: Record<string, unknown>, at: string): void;
}

/**
 * Payload definitions for the generated JavaScript operation surface.
 *
 * An operation is exposed to the model only when the AI-owned Prep DSL
 * compatibility profile also enables it. The registry then drives the accepted
 * IR payload validation while the sandbox bridge remains operation-agnostic.
 * Expression capabilities live in workflow-expression-registry.ts and do not
 * belong here because they do not create workflow operation nodes.
 */
export const WORKFLOW_IR_OPERATION_REGISTRY = [
  irOperation(
    'filter',
    'workflow.step(input, "filter", { condition: expr(row => booleanExpression) })',
    '{ condition: WorkflowNativeExpression<boolean> }',
    (op, at) => {
      validateExpression(op.condition, `${at}.condition`);
    }
  ),
  irOperation(
    'select',
    'workflow.step(input, "select", { columns: ["field"] })',
    '{ columns: WorkflowNonEmptyStringArray }',
    (op, at) => {
      assertStringArray(op.columns, `${at}.columns`, true);
    }
  ),
  irOperation(
    'drop',
    'workflow.step(input, "drop", { columns: ["field"] })',
    '{ columns: WorkflowNonEmptyStringArray }',
    (op, at) => {
      assertStringArray(op.columns, `${at}.columns`, true);
    }
  ),
  irOperation(
    'rename',
    'workflow.step(input, "rename", { source: "source", target: "target" })',
    '{ source: string; target: string }',
    (op, at) => {
      assertString(op.source, `${at}.source`);
      assertString(op.target, `${at}.target`);
    }
  ),
  irOperation(
    'derive',
    'workflow.step(input, "derive", { column: "field", expression: expr(row => valueExpression) })',
    '{ column: string; expression: WorkflowNativeExpression<unknown> }',
    (op, at) => {
      assertString(op.column, `${at}.column`);
      validateExpression(op.expression, `${at}.expression`);
    }
  ),
  irOperation(
    'derive_window',
    'workflow.step(input, "derive_window", { column, function, expression?, parameters?, offset?, defaultValue?, buckets?, nth?, partitionBy, orderBy, frame? }). Aggregate windows use a canonical aggregate function plus expression/parameters. Ranking functions row_number|rank|dense_rank|percent_rank|cume_dist use no expression. ntile uses buckets. lag|lead use expression plus optional offset/defaultValue. first_value|last_value use expression; nth_value also uses nth. frame is { type: "rows|range|groups", start, end, exclude? } with structured bounds such as { type: "preceding", offset: 2 } or { type: "preceding", offset: 7, unit: "day" }. Use empty partitionBy and orderBy for an all-rows total',
    'WorkflowDeriveWindowPayload',
    validateDeriveWindow
  ),
  irOperation(
    'convert_type',
    'workflow.step(input, "convert_type", { column: "field", targetType: "integer|float|decimal|text|boolean|date|datetime|timestamp", options: { onError?: "null|fail", removePrefix?: string, removeChars?: string[], scale?: decimal-only } })',
    'WorkflowConvertTypePayload',
    (op, at) => {
      assertString(op.column, `${at}.column`);
      const targetType = assertString(op.targetType, `${at}.targetType`);
      if (!isWorkflowExpressionCastType(targetType)) {
        fail(`${at}.targetType must be one of ${WORKFLOW_EXPRESSION_CAST_TYPES.join(', ')}`);
      }
      const options = assertRecord(op.options, `${at}.options`);
      if (options.onError !== undefined)
        assertEnum(options.onError, ['null', 'fail'], `${at}.options.onError`);
      if (options.removePrefix !== undefined)
        assertString(options.removePrefix, `${at}.options.removePrefix`);
      if (options.removeChars !== undefined)
        assertStringArray(options.removeChars, `${at}.options.removeChars`);
      if (options.scale !== undefined) {
        if (targetType !== 'decimal') {
          fail(`${at}.options.scale is only supported when targetType is decimal`);
        }
        if (!isWorkflowDecimalScale(options.scale)) {
          fail(
            `${at}.options.scale must be an integer from ${WORKFLOW_DECIMAL_SCALE_MIN} to ${WORKFLOW_DECIMAL_SCALE_MAX}`
          );
        }
      }
    }
  ),
  irOperation(
    'sort',
    'workflow.step(input, "sort", { keys: [{ field: "primary", direction: "asc|desc", nulls?: "first|last" }, { field: "secondary", direction: "asc|desc" }] })',
    '{ keys: readonly [WorkflowSortKey, ...WorkflowSortKey[]] } | { column: WorkflowNativeExpression<unknown>; direction: "asc" | "desc" }',
    (op, at) => {
      if (op.keys !== undefined) {
        validateSortKeys(op.keys, `${at}.keys`, true);
        return;
      }
      // Compatibility with workflows generated before multi-key sort was exposed.
      validateExpression(op.column, `${at}.column`);
      assertEnum(op.direction, ['asc', 'desc'], `${at}.direction`);
    }
  ),
  irOperation(
    'aggregate',
    'workflow.step(input, "aggregate", { groupBy: [expr(row => row["field"])], metrics: [{ fn: canonicalAggregate, expression: expr(row => row["field"]) | "*", alias: "metric", parameters?: [literal] }] })',
    'WorkflowAggregatePayload',
    validateAggregate
  ),
  irOperation(
    'deduplicate',
    'workflow.step(input, "deduplicate", { config: { columns, keep: "first", orderBy } })',
    '{ config: WorkflowDeduplicateConfig }',
    validateDeduplicate
  ),
  irOperation(
    'missing_value',
    'workflow.step(input, "missing_value", { config: { strategy: "drop_empty_rows" } | { strategy: "drop_rows_by_nulls", columns: ["field"], condition: "any_null|all_null" } | { strategy: "by_column", rules: [{ column: "field", method: "skip|drop|nullify_values|literal_fill", values?: ["text marker"], value?: literal }] } })',
    '{ config: WorkflowMissingValueConfig }',
    validateMissingValue
  ),
  irOperation(
    'limit',
    'workflow.step(input, "limit", { config: { mode: "limit" or "random", limit: positiveCountOrPercent, unit: "rows|percent", offset: 0, orderBy: [], groupBy?: ["field"], ties?: boolean, method?: "system|bernoulli", seed?: integer } }). Use mode limit plus orderBy for top/bottom, groupBy for per-group top/percent, and mode random for sampling. bernoulli is valid only for percent sampling. ties requires orderBy and is supported only for percent or grouped limits; never request ungrouped row-count ties',
    '{ config: WorkflowLimitConfig }',
    validateLimit
  ),
  irOperation(
    'pivot',
    'workflow.step(input, "pivot", { config: { on: ["pivotField"], values: ["fixedValue1", "fixedValue2"], using: [{ function: canonicalAggregate, expression: expr(row => row["metricField"]) | "*", alias: "metric", parameters?: [literal] }, ...moreMetrics], groupBy: ["groupField"] } }). on contains exactly one raw column-name string; values are fixed literals; using is non-empty and may contain multiple metrics; groupBy contains raw column names; never use expr(...) in on or groupBy; only using[].expression uses expr(...)',
    '{ config: WorkflowPivotConfig }',
    validatePivot
  ),
  irOperation(
    'unpivot',
    'workflow.step(input, "unpivot", { config: { mode, columns, nameColumn, valueColumn, includeNulls } })',
    '{ config: WorkflowUnpivotConfig }',
    validateUnpivot
  ),
  irOperation(
    'unnest',
    'workflow.step(input, "unnest", { config: { sourceKind, column, alias, recursive, keepParentNames, ...options } })',
    '{ config: WorkflowUnnestConfig }',
    validateUnnest
  ),
] as const satisfies readonly WorkflowIrOperationDefinition[];

export const WORKFLOW_IR_OPERATION_TYPES = new Set<WorkflowIrOperationType>(
  WORKFLOW_IR_OPERATION_REGISTRY.filter((definition) =>
    isAiPrepDslOperationEnabled(definition.irType)
  ).map((definition) => definition.irType)
);

export function getWorkflowJavascriptCapabilityPrompt(): string {
  return [
    WORKFLOW_IR_OPERATION_REGISTRY.filter((definition) =>
      isAiPrepDslOperationEnabled(definition.irType)
    )
      .map((definition) => definition.promptSignature)
      .join(', '),
    getWorkflowAggregateCapabilityPrompt(),
  ].join('. ');
}

export function getWorkflowIrOperationDefinition(
  type: string
): WorkflowIrOperationDefinition | undefined {
  return WORKFLOW_IR_OPERATION_REGISTRY.find(
    (definition) => definition.irType === type && isAiPrepDslOperationEnabled(definition.irType)
  );
}

/** TypeScript façade generated from the same operation entries validated at the IR boundary. */
export function getWorkflowIrOperationTypeScriptDeclarations(): string {
  const stepPayloadEntries = WORKFLOW_IR_OPERATION_REGISTRY.filter((definition) =>
    isAiPrepDslOperationEnabled(definition.irType)
  )
    .map((definition) => `  ${JSON.stringify(definition.irType)}: ${definition.typescriptPayload};`)
    .join('\n');
  const aggregateFunction = getWorkflowAggregateFunctionTypeScriptType();
  const numericAggregates = Object.entries(WORKFLOW_AGGREGATE_FUNCTION_REGISTRY)
    .filter(
      ([, definition]) => definition.argumentType === 'numeric' && !('parameters' in definition)
    )
    .map(([name]) => JSON.stringify(name))
    .join(' | ');
  const nonNumericAggregates = Object.entries(WORKFLOW_AGGREGATE_FUNCTION_REGISTRY)
    .filter(
      ([, definition]) =>
        definition.argumentType !== 'numeric' &&
        !definition.acceptsStar &&
        !('parameters' in definition)
    )
    .map(([name]) => JSON.stringify(name))
    .join(' | ');
  const castTypesWithoutScale = WORKFLOW_EXPRESSION_CAST_TYPES.filter(
    (type) => !WORKFLOW_EXPRESSION_CAST_REGISTRY[type].supportsScale
  )
    .map((type) => JSON.stringify(type))
    .join(' | ');
  return `
type WorkflowLiteral = string | number | boolean | null;
type WorkflowNonEmptyStringArray = readonly [string, ...string[]];
type WorkflowSortKey = { field: string; direction: "asc" | "desc"; nulls?: "first" | "last" };
type WorkflowConvertTypeCommonOptions = { onError?: "null" | "fail"; removePrefix?: string; removeChars?: ReadonlyArray<string> };
type WorkflowConvertTypePayload =
  | { column: string; targetType: "decimal"; options: WorkflowConvertTypeCommonOptions & { scale?: number } }
  | { column: string; targetType: ${castTypesWithoutScale}; options: WorkflowConvertTypeCommonOptions };
type WorkflowAggregateFunction = ${aggregateFunction};
type WorkflowAggregateMetric =
  | { fn: "count"; expression: WorkflowNativeExpression<unknown> | "*"; alias: string; parameters?: never }
  | { fn: ${numericAggregates}; expression: WorkflowNativeExpression<number>; alias: string; parameters?: never }
  | { fn: ${nonNumericAggregates}; expression: WorkflowNativeExpression<unknown>; alias: string; parameters?: never }
  | { fn: "string_agg"; expression: WorkflowNativeExpression<string>; alias: string; parameters: readonly [string] }
  | { fn: "quantile_cont" | "quantile_disc" | "approx_quantile"; expression: WorkflowNativeExpression<number>; alias: string; parameters: readonly [number] };
type WorkflowAggregatePayload = { groupBy: ReadonlyArray<WorkflowNativeExpression<unknown>>; metrics: readonly [WorkflowAggregateMetric, ...WorkflowAggregateMetric[]] };
type WorkflowWindowIntervalUnit = "microsecond" | "millisecond" | "second" | "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
type WorkflowWindowFrameBound =
  | { type: "unbounded_preceding" | "current_row" | "unbounded_following" }
  | { type: "preceding" | "following"; offset: number; unit?: WorkflowWindowIntervalUnit };
type WorkflowWindowFrame = { type: "rows" | "range" | "groups"; start: WorkflowWindowFrameBound; end: WorkflowWindowFrameBound; exclude?: "current_row" | "group" | "ties" };
type WorkflowWindowCommon = { column: string; partitionBy: ReadonlyArray<string>; orderBy: ReadonlyArray<WorkflowSortKey>; frame?: WorkflowWindowFrame };
type WorkflowDeriveWindowPayload =
  | (WorkflowWindowCommon & { function: "count"; expression: WorkflowNativeExpression<unknown> | "*"; parameters?: never })
  | (WorkflowWindowCommon & { function: ${numericAggregates}; expression: WorkflowNativeExpression<number>; parameters?: never })
  | (WorkflowWindowCommon & { function: ${nonNumericAggregates}; expression: WorkflowNativeExpression<unknown>; parameters?: never })
  | (WorkflowWindowCommon & { function: "string_agg"; expression: WorkflowNativeExpression<string>; parameters: readonly [string] })
  | (WorkflowWindowCommon & { function: "quantile_cont" | "quantile_disc" | "approx_quantile"; expression: WorkflowNativeExpression<number>; parameters: readonly [number] })
  | (WorkflowWindowCommon & { function: "row_number" | "rank" | "dense_rank" | "percent_rank" | "cume_dist" })
  | (WorkflowWindowCommon & { function: "ntile"; buckets: number })
  | (WorkflowWindowCommon & { function: "first_value" | "last_value"; expression: WorkflowNativeExpression<unknown> })
  | (WorkflowWindowCommon & { function: "nth_value"; expression: WorkflowNativeExpression<unknown>; nth: number })
  | (WorkflowWindowCommon & { function: "lag" | "lead"; expression: WorkflowNativeExpression<unknown>; offset?: number; defaultValue?: WorkflowLiteral });
type WorkflowDeduplicateConfig = { columns: ReadonlyArray<string>; keep: "first"; orderBy: ReadonlyArray<WorkflowSortKey> };
type WorkflowMissingValueRule =
  | { column: string; method: "skip" | "drop" }
  | { column: string; method: "nullify_values"; values: readonly [string, ...string[]] }
  | { column: string; method: "literal_fill"; value: WorkflowLiteral };
type WorkflowNonEmptyMissingValueRules = readonly [WorkflowMissingValueRule, ...WorkflowMissingValueRule[]];
type WorkflowMissingValueConfig =
  | { strategy: "drop_empty_rows" }
  | { strategy: "drop_rows_by_nulls"; columns: WorkflowNonEmptyStringArray; condition: "any_null" | "all_null" }
  | { strategy: "by_column"; rules: WorkflowNonEmptyMissingValueRules };
type WorkflowLimitConfig =
  | { mode: "limit"; limit: number; unit: "rows" | "percent"; offset: number; orderBy: ReadonlyArray<WorkflowSortKey>; groupBy?: ReadonlyArray<string>; ties?: boolean; method?: never; seed?: never }
  | { mode: "random"; limit: number; unit: "rows"; offset: 0; orderBy: readonly []; groupBy?: never; ties?: never; method?: "system"; seed?: number }
  | { mode: "random"; limit: number; unit: "percent"; offset: 0; orderBy: readonly []; groupBy?: never; ties?: never; method?: "system" | "bernoulli"; seed?: number };
type WorkflowPivotMetric =
  | { function: "count"; expression: WorkflowNativeExpression<unknown> | "*"; alias: string; parameters?: never }
  | { function: ${numericAggregates}; expression: WorkflowNativeExpression<number>; alias: string; parameters?: never }
  | { function: ${nonNumericAggregates}; expression: WorkflowNativeExpression<unknown>; alias: string; parameters?: never }
  | { function: "string_agg"; expression: WorkflowNativeExpression<string>; alias: string; parameters: readonly [string] }
  | { function: "quantile_cont" | "quantile_disc" | "approx_quantile"; expression: WorkflowNativeExpression<number>; alias: string; parameters: readonly [number] };
type WorkflowPivotConfig = { on: readonly [string]; values: readonly [WorkflowLiteral, ...WorkflowLiteral[]]; using: readonly [WorkflowPivotMetric, ...WorkflowPivotMetric[]]; groupBy: ReadonlyArray<string> };
type WorkflowUnpivotConfig = { mode: "columns" | "except"; columns: WorkflowNonEmptyStringArray; nameColumn: string; valueColumn: string; includeNulls: boolean };
type WorkflowUnnestConfig = { sourceKind: "list" | "json"; column: string; alias: string; path?: string; withIndex?: string; recursive: boolean; maxDepth?: number; keepParentNames: boolean };
declare const workflowValueBrand: unique symbol;
interface WorkflowValue { readonly [workflowValueBrand]: true }
interface WorkflowStepPayloadMap {
${stepPayloadEntries}
}
interface WorkflowSdk {
  input(tableId: string, options?: { alias?: string }): WorkflowValue;
  step<T extends keyof WorkflowStepPayloadMap>(input: WorkflowValue, type: T, payload: WorkflowStepPayloadMap[T]): WorkflowValue;
  output(input: WorkflowValue, tableName: string, options?: { mode?: "replace" }): WorkflowValue;
}
declare const workflow: WorkflowSdk;
`;
}

export function validateRegisteredWorkflowIrOperation(
  operationValue: Record<string, unknown>,
  index: number
): void {
  const definition = WORKFLOW_IR_OPERATION_REGISTRY.find(
    (candidate) =>
      candidate.irType === operationValue.type && isAiPrepDslOperationEnabled(candidate.irType)
  );
  if (!definition) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Unsupported Workflow IR operation at index ${index}: ${String(operationValue.type)}`
    );
  }
  definition.validatePayload(operationValue, `operations[${index}]`);
}

function irOperation(
  irType: WorkflowIrOperationType,
  promptSignature: string,
  typescriptPayload: string,
  validatePayload: WorkflowIrOperationDefinition['validatePayload']
): WorkflowIrOperationDefinition {
  return {
    irType,
    promptSignature,
    typescriptPayload,
    validatePayload,
  };
}

function validateAggregate(op: Record<string, unknown>, at: string): void {
  assertArray(op.groupBy, `${at}.groupBy`).forEach((value, item) =>
    validateExpression(value, `${at}.groupBy[${item}]`)
  );
  assertArray(op.metrics, `${at}.metrics`, true).forEach((value, item) => {
    const metric = assertRecord(value, `${at}.metrics[${item}]`);
    validateAggregateMetric(metric, 'fn', `${at}.metrics[${item}]`);
  });
}

const WORKFLOW_RANKING_WINDOW_FUNCTIONS = new Set([
  'row_number',
  'rank',
  'dense_rank',
  'percent_rank',
  'cume_dist',
]);
const WORKFLOW_VALUE_WINDOW_FUNCTIONS = new Set(['first_value', 'last_value', 'nth_value']);
const WORKFLOW_OFFSET_WINDOW_FUNCTIONS = new Set(['lag', 'lead']);
const WORKFLOW_WINDOW_INTERVAL_UNITS = new Set([
  'microsecond',
  'millisecond',
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
]);

function validateDeriveWindow(op: Record<string, unknown>, at: string): void {
  assertString(op.column, `${at}.column`);
  const requestedFunction = assertString(op.function, `${at}.function`);
  assertStringArray(op.partitionBy, `${at}.partitionBy`);
  validateSortKeys(op.orderBy, `${at}.orderBy`);
  const aggregateFunction = normalizeWorkflowAggregateFunction(requestedFunction);
  const requiresOrder =
    WORKFLOW_RANKING_WINDOW_FUNCTIONS.has(requestedFunction) ||
    requestedFunction === 'ntile' ||
    WORKFLOW_VALUE_WINDOW_FUNCTIONS.has(requestedFunction) ||
    WORKFLOW_OFFSET_WINDOW_FUNCTIONS.has(requestedFunction);
  if (requiresOrder) assertArray(op.orderBy, `${at}.orderBy`, true);

  if (aggregateFunction) {
    op.function = aggregateFunction;
    validateAggregateMetric(
      {
        expression: op.expression,
        parameters: op.parameters,
        alias: op.column,
        fn: aggregateFunction,
      },
      'fn',
      at
    );
  } else if (WORKFLOW_RANKING_WINDOW_FUNCTIONS.has(requestedFunction)) {
    rejectDefined(op, ['expression', 'parameters', 'offset', 'defaultValue', 'buckets', 'nth'], at);
  } else if (requestedFunction === 'ntile') {
    assertPositiveInteger(op.buckets, `${at}.buckets`);
    rejectDefined(op, ['expression', 'parameters', 'offset', 'defaultValue', 'nth'], at);
  } else if (WORKFLOW_VALUE_WINDOW_FUNCTIONS.has(requestedFunction)) {
    validateExpression(op.expression, `${at}.expression`);
    if (requestedFunction === 'nth_value') assertPositiveInteger(op.nth, `${at}.nth`);
    else if (op.nth !== undefined) fail(`${at}.nth is only valid for nth_value`);
    rejectDefined(op, ['parameters', 'offset', 'defaultValue', 'buckets'], at);
  } else if (WORKFLOW_OFFSET_WINDOW_FUNCTIONS.has(requestedFunction)) {
    validateExpression(op.expression, `${at}.expression`);
    if (op.offset !== undefined) assertPositiveInteger(op.offset, `${at}.offset`);
    if (op.defaultValue !== undefined) assertLiteral(op.defaultValue, `${at}.defaultValue`);
    rejectDefined(op, ['parameters', 'buckets', 'nth'], at);
  } else {
    fail(
      `${at}.function must be an aggregate, ranking, value, or offset window function; received ${JSON.stringify(requestedFunction)}`
    );
  }

  if (op.frame !== undefined) {
    if (
      WORKFLOW_RANKING_WINDOW_FUNCTIONS.has(requestedFunction) ||
      requestedFunction === 'ntile' ||
      WORKFLOW_OFFSET_WINDOW_FUNCTIONS.has(requestedFunction)
    ) {
      fail(`${at}.frame is not supported for ${requestedFunction}`);
    }
    validateWindowFrame(op.frame, `${at}.frame`);
  }
}

function validateDeduplicate(op: Record<string, unknown>, at: string): void {
  const config = assertRecord(op.config, `${at}.config`);
  assertStringArray(config.columns, `${at}.config.columns`);
  assertEnum(config.keep, ['first'], `${at}.config.keep`);
  validateSortKeys(config.orderBy, `${at}.config.orderBy`);
}

function validateMissingValue(op: Record<string, unknown>, at: string): void {
  const config = assertRecord(op.config, `${at}.config`);
  assertEnum(
    config.strategy,
    ['drop_empty_rows', 'drop_rows_by_nulls', 'by_column'],
    `${at}.config.strategy`
  );
  if (config.strategy === 'drop_rows_by_nulls') {
    assertStringArray(config.columns, `${at}.config.columns`, true);
    assertEnum(config.condition, ['any_null', 'all_null'], `${at}.config.condition`);
    return;
  }
  if (config.strategy !== 'by_column') return;
  assertArray(config.rules, `${at}.config.rules`, true).forEach((value, item) => {
    const rule = assertRecord(value, `${at}.config.rules[${item}]`);
    assertString(rule.column, `${at}.config.rules[${item}].column`);
    assertEnum(
      rule.method,
      ['skip', 'drop', 'nullify_values', 'literal_fill'],
      `${at}.config.rules[${item}].method`
    );
    if (rule.method === 'nullify_values') {
      assertStringArray(rule.values, `${at}.config.rules[${item}].values`, true);
    } else if (rule.method === 'literal_fill') {
      if (rule.value === undefined) fail(`${at}.config.rules[${item}].value is required`);
      assertLiteral(rule.value, `${at}.config.rules[${item}].value`);
    }
  });
}

function validateLimit(op: Record<string, unknown>, at: string): void {
  const config = assertRecord(op.config, `${at}.config`);
  assertEnum(config.mode, ['limit', 'top', 'random'], `${at}.config.mode`);
  const limit = assertFiniteNumber(config.limit, `${at}.config.limit`);
  if (limit <= 0) fail(`${at}.config.limit must be greater than zero`);
  assertEnum(config.unit, ['rows', 'percent'], `${at}.config.unit`);
  if (config.unit === 'rows' && !Number.isInteger(limit))
    fail(`${at}.config.limit must be an integer for row limits`);
  if (config.unit === 'percent' && limit > 100)
    fail(`${at}.config.limit cannot exceed 100 for percent limits`);
  const offset = assertFiniteNumber(config.offset, `${at}.config.offset`);
  if (!Number.isInteger(offset) || offset < 0)
    fail(`${at}.config.offset must be a non-negative integer`);
  validateSortKeys(config.orderBy, `${at}.config.orderBy`);
  if (config.groupBy !== undefined) assertStringArray(config.groupBy, `${at}.config.groupBy`);
  if (config.ties !== undefined) assertBoolean(config.ties, `${at}.config.ties`);
  if (config.method !== undefined)
    assertEnum(config.method, ['system', 'bernoulli'], `${at}.config.method`);
  if (config.seed !== undefined) assertInteger(config.seed, `${at}.config.seed`);
  if (config.mode === 'top') {
    if (config.unit !== 'rows') fail(`${at}.config.unit must be rows when mode is top`);
    if (config.offset !== 0) fail(`${at}.config.offset must be 0 when mode is top`);
    assertArray(config.orderBy, `${at}.config.orderBy`, true);
    return;
  }
  if (config.mode === 'random') {
    if (offset !== 0) fail(`${at}.config.offset must be 0 for random sampling`);
    if ((config.orderBy as unknown[]).length > 0)
      fail(`${at}.config.orderBy must be empty for random sampling`);
    if (Array.isArray(config.groupBy) && config.groupBy.length > 0)
      fail(`${at}.config.groupBy is not supported for random sampling`);
    if (config.ties === true) fail(`${at}.config.ties is not supported for random sampling`);
    if (config.unit === 'rows' && config.method === 'bernoulli') {
      fail(`${at}.config.method bernoulli is only supported for percent sampling`);
    }
    return;
  }
  if (config.method !== undefined || config.seed !== undefined) {
    fail(`${at}.config.method and seed are only valid for random sampling`);
  }
  const grouped = Array.isArray(config.groupBy) && config.groupBy.length > 0;
  const ordered = Array.isArray(config.orderBy) && config.orderBy.length > 0;
  if (grouped && offset !== 0) fail(`${at}.config.offset must be 0 for grouped limits`);
  if (grouped && !ordered) fail(`${at}.config.orderBy is required for grouped limits`);
  if (config.ties === true) {
    if (!ordered) fail(`${at}.config.orderBy is required when ties is true`);
    if (!grouped && config.unit === 'rows') {
      fail(`${at}.config.ties is not supported for ungrouped row-count limits`);
    }
  }
}

function validatePivot(op: Record<string, unknown>, at: string): void {
  const config = assertRecord(op.config, `${at}.config`);
  assertStringArray(config.on, `${at}.config.on`, true);
  assertArrayLength(config.on, `${at}.config.on`, 1);
  assertLiteralArray(config.values, `${at}.config.values`, true);
  assertStringArray(config.groupBy, `${at}.config.groupBy`);
  const aliases = new Set<string>();
  assertArray(config.using, `${at}.config.using`, true).forEach((value, item) => {
    const metric = assertRecord(value, `${at}.config.using[${item}]`);
    validateAggregateMetric(metric, 'function', `${at}.config.using[${item}]`);
    const alias = String(metric.alias).toLowerCase();
    if (aliases.has(alias)) fail(`${at}.config.using aliases must be unique`);
    aliases.add(alias);
  });
}

function validateAggregateMetric(
  metric: Record<string, unknown>,
  functionKey: 'fn' | 'function',
  at: string
): void {
  const fn = normalizeAggregateFunction(metric[functionKey], `${at}.${functionKey}`);
  metric[functionKey] = fn;
  assertString(metric.alias, `${at}.alias`);
  const definition = getWorkflowAggregateFunctionDefinition(fn);
  if (metric.expression === '*') {
    if (!definition?.acceptsStar) fail(`${at}.expression cannot be "*" for ${fn}`);
  } else {
    validateExpression(metric.expression, `${at}.expression`);
  }
  const parameters =
    metric.parameters === undefined ? [] : assertArray(metric.parameters, `${at}.parameters`);
  const expected = definition?.parameters ?? [];
  if (parameters.length !== expected.length) {
    fail(`${at}.parameters must contain exactly ${expected.length} item(s) for ${fn}`);
  }
  parameters.forEach((value, index) => {
    assertLiteral(value, `${at}.parameters[${index}]`);
    const parameter = expected[index];
    if (parameter?.type === 'text' && typeof value !== 'string')
      fail(`${at}.parameters[${index}] must be text`);
    if (parameter?.type === 'number') {
      if (typeof value !== 'number') fail(`${at}.parameters[${index}] must be a number`);
      if (parameter.min !== undefined && value < parameter.min)
        fail(`${at}.parameters[${index}] must be at least ${parameter.min}`);
      if (parameter.max !== undefined && value > parameter.max)
        fail(`${at}.parameters[${index}] must be at most ${parameter.max}`);
    }
  });
}

function normalizeAggregateFunction(value: unknown, at: string): string {
  const normalized = normalizeWorkflowAggregateFunction(value);
  if (!normalized) {
    fail(
      `${at} must be one of ${Object.keys(WORKFLOW_AGGREGATE_FUNCTION_REGISTRY).join(', ')}; received ${JSON.stringify(value)}`
    );
  }
  return normalized;
}

function validateUnpivot(op: Record<string, unknown>, at: string): void {
  const config = assertRecord(op.config, `${at}.config`);
  assertEnum(config.mode, ['columns', 'except'], `${at}.config.mode`);
  assertStringArray(config.columns, `${at}.config.columns`, true);
  assertString(config.nameColumn, `${at}.config.nameColumn`);
  assertString(config.valueColumn, `${at}.config.valueColumn`);
  assertBoolean(config.includeNulls, `${at}.config.includeNulls`);
}

function validateUnnest(op: Record<string, unknown>, at: string): void {
  const config = assertRecord(op.config, `${at}.config`);
  assertEnum(config.sourceKind, ['list', 'json'], `${at}.config.sourceKind`);
  assertString(config.column, `${at}.config.column`);
  assertString(config.alias, `${at}.config.alias`);
  assertBoolean(config.recursive, `${at}.config.recursive`);
  assertBoolean(config.keepParentNames, `${at}.config.keepParentNames`);
  if (config.path !== undefined) assertString(config.path, `${at}.config.path`);
  if (config.withIndex !== undefined) assertString(config.withIndex, `${at}.config.withIndex`);
  if (config.maxDepth !== undefined) assertFiniteNumber(config.maxDepth, `${at}.config.maxDepth`);
}

function validateExpression(value: unknown, at: string): void {
  const expr = assertRecord(value, at);
  assertEnum(expr.kind, ['column', 'literal', 'binary', 'unary', 'cast', 'function'], `${at}.kind`);
  if (expr.kind === 'column') assertString(expr.name, `${at}.name`);
  else if (expr.kind === 'literal') assertLiteral(expr.value, `${at}.value`);
  else if (expr.kind === 'binary') {
    assertString(expr.op, `${at}.op`);
    const operator = String(expr.op);
    if (!WORKFLOW_BINARY_EXPRESSION_OPERATORS.has(operator)) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Unsupported expression operator at ${at}.op: ${operator}`
      );
    }
    validateExpression(expr.left, `${at}.left`);
    validateExpression(expr.right, `${at}.right`);
  } else if (expr.kind === 'unary') {
    assertString(expr.op, `${at}.op`);
    const operator = String(expr.op);
    if (!WORKFLOW_UNARY_EXPRESSION_OPERATORS.has(operator)) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Unsupported unary expression operator at ${at}.op: ${operator}`
      );
    }
    validateExpression(expr.value, `${at}.value`);
  } else if (expr.kind === 'cast') {
    validateExpression(expr.value, `${at}.value`);
    assertString(expr.targetType, `${at}.targetType`);
    if (!isWorkflowExpressionCastType(String(expr.targetType))) {
      fail(`${at}.targetType is not a supported workflow cast type`);
    }
    const options = assertRecord(expr.options, `${at}.options`);
    if (options.scale !== undefined) {
      if (expr.targetType !== 'decimal') {
        fail(`${at}.options.scale is only supported when targetType is decimal`);
      }
      if (!isWorkflowDecimalScale(options.scale)) {
        fail(
          `${at}.options.scale must be an integer from ${WORKFLOW_DECIMAL_SCALE_MIN} to ${WORKFLOW_DECIMAL_SCALE_MAX}`
        );
      }
    }
  } else if (expr.kind === 'function') {
    assertString(expr.name, `${at}.name`);
    const functionName = String(expr.name);
    if (!WORKFLOW_EXPRESSION_FUNCTION_NAMES.has(functionName)) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Unsupported expression function at ${at}.name: fn.${functionName}`
      );
    }
    const args = assertArray(expr.args, `${at}.args`);
    const definition = getWorkflowExpressionFunctionDefinition(functionName);
    if (definition && !workflowExpressionArityIsValid(definition, args.length)) {
      fail(
        `${at}.args for ${functionName} must contain ${workflowExpressionArityDescription(definition)} item(s); received ${args.length}`
      );
    }
    args.forEach((arg, index) => validateExpression(arg, `${at}.args[${index}]`));
  }
}

function validateWindowFrame(value: unknown, at: string): void {
  const frame = assertRecord(value, at);
  assertEnum(frame.type, ['rows', 'range', 'groups'], `${at}.type`);
  validateWindowFrameBound(frame.start, `${at}.start`, String(frame.type));
  validateWindowFrameBound(frame.end, `${at}.end`, String(frame.type));
  const startType = (frame.start as Record<string, unknown>).type;
  const endType = (frame.end as Record<string, unknown>).type;
  if (startType === 'unbounded_following') fail(`${at}.start cannot be unbounded_following`);
  if (endType === 'unbounded_preceding') fail(`${at}.end cannot be unbounded_preceding`);
  if (frame.exclude !== undefined)
    assertEnum(frame.exclude, ['current_row', 'group', 'ties'], `${at}.exclude`);
}

function validateWindowFrameBound(value: unknown, at: string, frameType: string): void {
  const bound = assertRecord(value, at);
  assertEnum(
    bound.type,
    ['unbounded_preceding', 'preceding', 'current_row', 'following', 'unbounded_following'],
    `${at}.type`
  );
  if (bound.type === 'preceding' || bound.type === 'following') {
    const offset = assertFiniteNumber(bound.offset, `${at}.offset`);
    if (offset < 0) fail(`${at}.offset must be non-negative`);
    if (frameType !== 'range' && !Number.isInteger(offset))
      fail(`${at}.offset must be an integer for ${frameType} frames`);
    if (bound.unit !== undefined) {
      if (frameType !== 'range') fail(`${at}.unit is only valid for range frames`);
      if (typeof bound.unit !== 'string' || !WORKFLOW_WINDOW_INTERVAL_UNITS.has(bound.unit))
        fail(`${at}.unit must be a supported interval unit`);
    }
  } else {
    rejectDefined(bound, ['offset', 'unit'], at);
  }
}

function rejectDefined(value: Record<string, unknown>, keys: string[], at: string): void {
  for (const key of keys) {
    if (value[key] !== undefined) fail(`${at}.${key} is not valid for this function`);
  }
}

function validateSortKeys(value: unknown, at: string, nonEmpty = false): void {
  assertArray(value, at, nonEmpty).forEach((item, index) => {
    const key = assertRecord(item, `${at}[${index}]`);
    assertString(key.field, `${at}[${index}].field`);
    assertEnum(key.direction, ['asc', 'desc'], `${at}[${index}].direction`);
    if (key.nulls !== undefined) assertEnum(key.nulls, ['first', 'last'], `${at}[${index}].nulls`);
  });
}

function assertRecord(value: unknown, at: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${at} must be an object`);
  return value as Record<string, unknown>;
}
function assertArray(value: unknown, at: string, nonEmpty = false): unknown[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0))
    fail(`${at} must be ${nonEmpty ? 'a non-empty' : 'an'} array`);
  return value;
}
function assertArrayLength(value: unknown, at: string, length: number): void {
  if (!Array.isArray(value) || value.length !== length) {
    fail(`${at} must contain exactly ${length} item(s)`);
  }
}
function assertString(value: unknown, at: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${at} must be a non-empty string`);
  return value;
}
function assertStringArray(value: unknown, at: string, nonEmpty = false): void {
  assertArray(value, at, nonEmpty).forEach((item, index) => assertString(item, `${at}[${index}]`));
}
function assertLiteral(value: unknown, at: string): void {
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
    fail(`${at} must be a JSON literal`);
  if (typeof value === 'number' && !Number.isFinite(value)) fail(`${at} must be finite`);
}
function assertLiteralArray(value: unknown, at: string, nonEmpty = false): void {
  assertArray(value, at, nonEmpty).forEach((item, index) => assertLiteral(item, `${at}[${index}]`));
}
function assertFiniteNumber(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${at} must be a finite number`);
  return value;
}
function assertInteger(value: unknown, at: string): number {
  const number = assertFiniteNumber(value, at);
  if (!Number.isInteger(number)) fail(`${at} must be an integer`);
  return number;
}
function assertPositiveInteger(value: unknown, at: string): number {
  const number = assertInteger(value, at);
  if (number <= 0) fail(`${at} must be greater than zero`);
  return number;
}
function assertBoolean(value: unknown, at: string): void {
  if (typeof value !== 'boolean') fail(`${at} must be a boolean`);
}
function assertEnum(value: unknown, allowed: readonly string[], at: string): void {
  if (typeof value !== 'string' || !allowed.includes(value))
    fail(`${at} must be one of ${allowed.join(', ')}; received ${JSON.stringify(value)}`);
}
function fail(message: string): never {
  throw new DataCommandError('VALIDATION_FAILED', `Invalid Workflow IR: ${message}`);
}

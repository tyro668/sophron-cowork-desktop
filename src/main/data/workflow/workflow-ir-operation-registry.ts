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
    'workflow.step(input, "sort", { column: expr(row => row["field"]), direction: "asc|desc" })',
    '{ column: WorkflowNativeExpression<unknown>; direction: "asc" | "desc" }',
    (op, at) => {
      validateExpression(op.column, `${at}.column`);
      assertEnum(op.direction, ['asc', 'desc'], `${at}.direction`);
    }
  ),
  irOperation(
    'aggregate',
    'workflow.step(input, "aggregate", { groupBy: [expr(row => row["field"])], metrics: [{ fn: "sum|avg|min|max|count|count_distinct", expression: expr(row => row["field"]) | "*", alias: "metric" }] })',
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
    'workflow.step(input, "missing_value", { config: { strategy: "drop_empty_rows" } | { strategy: "by_column", rules: [{ column: "field", method: "skip|drop|nullify_values|literal_fill", values?: ["text marker"], value?: literal }] } })',
    '{ config: { strategy: "drop_empty_rows" } | { strategy: "by_column"; rules: WorkflowNonEmptyMissingValueRules } }',
    validateMissingValue
  ),
  irOperation(
    'limit',
    'workflow.step(input, "limit", { config: { mode: "limit", limit: positiveCount, unit: "rows|percent", offset: 0, orderBy: [] } }). For highest/lowest/top/bottom N, use a separate sort step first and then this limit form; never use mode "top"',
    '{ config: WorkflowLimitConfig }',
    validateLimit
  ),
  irOperation(
    'pivot',
    'workflow.step(input, "pivot", { config: { on, values, using, groupBy } })',
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
    .filter(([, definition]) => definition.argumentType === 'numeric')
    .map(([name]) => JSON.stringify(name))
    .join(' | ');
  const nonNumericAggregates = Object.entries(WORKFLOW_AGGREGATE_FUNCTION_REGISTRY)
    .filter(([, definition]) => definition.argumentType !== 'numeric' && !definition.acceptsStar)
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
  | { fn: "count"; expression: WorkflowNativeExpression<unknown> | "*"; alias: string }
  | { fn: ${numericAggregates}; expression: WorkflowNativeExpression<number>; alias: string }
  | { fn: ${nonNumericAggregates}; expression: WorkflowNativeExpression<unknown>; alias: string };
type WorkflowAggregatePayload = { groupBy: ReadonlyArray<WorkflowNativeExpression<unknown>>; metrics: readonly [WorkflowAggregateMetric, ...WorkflowAggregateMetric[]] };
type WorkflowDeduplicateConfig = { columns: ReadonlyArray<string>; keep: "first"; orderBy: ReadonlyArray<WorkflowSortKey> };
type WorkflowMissingValueRule =
  | { column: string; method: "skip" | "drop" }
  | { column: string; method: "nullify_values"; values: readonly [string, ...string[]] }
  | { column: string; method: "literal_fill"; value: WorkflowLiteral };
type WorkflowNonEmptyMissingValueRules = readonly [WorkflowMissingValueRule, ...WorkflowMissingValueRule[]];
type WorkflowLimitConfig = { mode: "limit"; limit: number; unit: "rows" | "percent"; offset: number; orderBy: ReadonlyArray<WorkflowSortKey> };
type WorkflowPivotMetric =
  | { function: "count"; expression: WorkflowNativeExpression<unknown> | "*"; alias: string }
  | { function: ${numericAggregates}; expression: WorkflowNativeExpression<number>; alias: string }
  | { function: ${nonNumericAggregates}; expression: WorkflowNativeExpression<unknown>; alias: string };
type WorkflowPivotConfig = { on: readonly [string]; values: readonly [WorkflowLiteral, ...WorkflowLiteral[]]; using: readonly [WorkflowPivotMetric]; groupBy: ReadonlyArray<string> };
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
    const fn = normalizeAggregateFunction(metric.fn, `${at}.metrics[${item}].fn`);
    metric.fn = fn;
    assertString(metric.alias, `${at}.metrics[${item}].alias`);
    if (metric.expression === '*') {
      if (!getWorkflowAggregateFunctionDefinition(fn)?.acceptsStar) {
        fail(`${at}.metrics[${item}].expression cannot be "*" for ${fn}`);
      }
    } else {
      validateExpression(metric.expression, `${at}.metrics[${item}].expression`);
    }
  });
}

function validateDeduplicate(op: Record<string, unknown>, at: string): void {
  const config = assertRecord(op.config, `${at}.config`);
  assertStringArray(config.columns, `${at}.config.columns`);
  assertEnum(config.keep, ['first'], `${at}.config.keep`);
  validateSortKeys(config.orderBy, `${at}.config.orderBy`);
}

function validateMissingValue(op: Record<string, unknown>, at: string): void {
  const config = assertRecord(op.config, `${at}.config`);
  assertEnum(config.strategy, ['drop_empty_rows', 'by_column'], `${at}.config.strategy`);
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
  assertEnum(config.mode, ['limit', 'top'], `${at}.config.mode`);
  assertFiniteNumber(config.limit, `${at}.config.limit`);
  assertEnum(config.unit, ['rows', 'percent'], `${at}.config.unit`);
  assertFiniteNumber(config.offset, `${at}.config.offset`);
  validateSortKeys(config.orderBy, `${at}.config.orderBy`);
  if (config.mode === 'top') {
    if (config.unit !== 'rows') fail(`${at}.config.unit must be rows when mode is top`);
    if (config.offset !== 0) fail(`${at}.config.offset must be 0 when mode is top`);
    assertArray(config.orderBy, `${at}.config.orderBy`, true);
  }
}

function validatePivot(op: Record<string, unknown>, at: string): void {
  const config = assertRecord(op.config, `${at}.config`);
  assertStringArray(config.on, `${at}.config.on`, true);
  assertArrayLength(config.on, `${at}.config.on`, 1);
  assertLiteralArray(config.values, `${at}.config.values`, true);
  assertStringArray(config.groupBy, `${at}.config.groupBy`);
  assertArrayLength(config.using, `${at}.config.using`, 1);
  assertArray(config.using, `${at}.config.using`, true).forEach((value, item) => {
    const metric = assertRecord(value, `${at}.config.using[${item}]`);
    const fn = normalizeAggregateFunction(metric.function, `${at}.config.using[${item}].function`);
    metric.function = fn;
    assertString(metric.alias, `${at}.config.using[${item}].alias`);
    if (metric.expression === '*') {
      if (!getWorkflowAggregateFunctionDefinition(fn)?.acceptsStar) {
        fail(`${at}.config.using[${item}].expression cannot be "*" for ${fn}`);
      }
    } else {
      validateExpression(metric.expression, `${at}.config.using[${item}].expression`);
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

function validateSortKeys(value: unknown, at: string): void {
  assertArray(value, at).forEach((item, index) => {
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

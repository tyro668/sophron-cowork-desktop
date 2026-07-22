import { DataCommandError } from '../data-command-types';
import type { WorkflowOperationIr } from './workflow-model';

type WorkflowOperationType = WorkflowOperationIr['type'];

export interface WorkflowOperationDefinition {
  irType: WorkflowOperationType;
  promptSignature: string;
  validatePayload(operation: Record<string, unknown>, at: string): void;
}

/**
 * Single source of truth for the generated JavaScript operation surface.
 *
 * Adding an operation here drives the LLM capability prompt, the accepted IR
 * operation types and payload validation. The sandbox
 * bridge is operation-agnostic and never changes when an operation is added.
 * Expression helpers (col/lit/fn/metric) are intentionally SDK primitives and
 * do not belong here because they do not create workflow operation nodes.
 */
export const WORKFLOW_OPERATION_REGISTRY = [
  operation('filter', 'workflow.step(input, "filter", { condition: expr })', (op, at) => {
    validateExpression(op.condition, `${at}.condition`);
  }),
  operation('select', 'workflow.step(input, "select", { columns: ["field"] })', (op, at) => {
    assertStringArray(op.columns, `${at}.columns`, true);
  }),
  operation('drop', 'workflow.step(input, "drop", { columns: ["field"] })', (op, at) => {
    assertStringArray(op.columns, `${at}.columns`, true);
  }),
  operation(
    'rename',
    'workflow.step(input, "rename", { source: "source", target: "target" })',
    (op, at) => {
      assertString(op.source, `${at}.source`);
      assertString(op.target, `${at}.target`);
    }
  ),
  operation(
    'derive',
    'workflow.step(input, "derive", { column: "field", expression: expr })',
    (op, at) => {
      assertString(op.column, `${at}.column`);
      validateExpression(op.expression, `${at}.expression`);
    }
  ),
  operation(
    'convert_type',
    'workflow.step(input, "convert_type", { column: "field", targetType, options: {} })',
    (op, at) => {
      assertString(op.column, `${at}.column`);
      assertString(op.targetType, `${at}.targetType`);
      assertRecord(op.options, `${at}.options`);
    }
  ),
  operation(
    'sort',
    'workflow.step(input, "sort", { column: col("field"), direction: "asc|desc" })',
    (op, at) => {
      validateExpression(op.column, `${at}.column`);
      assertEnum(op.direction, ['asc', 'desc'], `${at}.direction`);
    }
  ),
  operation(
    'aggregate',
    'workflow.step(input, "aggregate", { groupBy, metrics })',
    validateAggregate
  ),
  operation(
    'deduplicate',
    'workflow.step(input, "deduplicate", { config: { columns, keep, orderBy } })',
    validateDeduplicate
  ),
  operation(
    'missing_value',
    'workflow.step(input, "missing_value", { config: { strategy, rules? } })',
    validateMissingValue
  ),
  operation(
    'limit',
    'workflow.step(input, "limit", { config: { mode: "limit", limit, unit, offset, orderBy } })',
    validateLimit
  ),
  operation(
    'limit',
    'workflow.step(input, "limit", { config: { mode: "top", limit, unit: "rows", offset: 0, orderBy } })',
    validateLimit
  ),
  operation(
    'pivot',
    'workflow.step(input, "pivot", { config: { on, values, using, groupBy } })',
    validatePivot
  ),
  operation(
    'unpivot',
    'workflow.step(input, "unpivot", { config: { mode, columns, nameColumn, valueColumn, includeNulls } })',
    validateUnpivot
  ),
  operation(
    'unnest',
    'workflow.step(input, "unnest", { config: { sourceKind, column, alias, recursive, keepParentNames, ...options } })',
    validateUnnest
  ),
] as const satisfies readonly WorkflowOperationDefinition[];

export const WORKFLOW_OPERATION_TYPES = new Set<WorkflowOperationType>(
  WORKFLOW_OPERATION_REGISTRY.map((definition) => definition.irType)
);

export function getWorkflowJavascriptCapabilityPrompt(): string {
  return WORKFLOW_OPERATION_REGISTRY.map((definition) => definition.promptSignature).join(', ');
}

export function validateRegisteredWorkflowOperation(
  operationValue: Record<string, unknown>,
  index: number
): void {
  const definition = WORKFLOW_OPERATION_REGISTRY.find(
    (candidate) => candidate.irType === operationValue.type
  );
  if (!definition) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Unsupported Workflow IR operation at index ${index}: ${String(operationValue.type)}`
    );
  }
  definition.validatePayload(operationValue, `operations[${index}]`);
}

function operation(
  irType: WorkflowOperationType,
  promptSignature: string,
  validatePayload: WorkflowOperationDefinition['validatePayload']
): WorkflowOperationDefinition {
  return {
    irType,
    promptSignature,
    validatePayload,
  };
}

function validateAggregate(op: Record<string, unknown>, at: string): void {
  assertArray(op.groupBy, `${at}.groupBy`).forEach((value, item) =>
    validateExpression(value, `${at}.groupBy[${item}]`)
  );
  assertArray(op.metrics, `${at}.metrics`, true).forEach((value, item) => {
    const metric = assertRecord(value, `${at}.metrics[${item}]`);
    assertString(metric.fn, `${at}.metrics[${item}].fn`);
    assertString(metric.alias, `${at}.metrics[${item}].alias`);
    if (metric.expression !== '*')
      validateExpression(metric.expression, `${at}.metrics[${item}].expression`);
  });
}

function validateDeduplicate(op: Record<string, unknown>, at: string): void {
  const config = assertRecord(op.config, `${at}.config`);
  assertStringArray(config.columns, `${at}.config.columns`);
  assertEnum(config.keep, ['first', 'last'], `${at}.config.keep`);
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
    if (rule.values !== undefined)
      assertLiteralArray(rule.values, `${at}.config.rules[${item}].values`);
    if (rule.value !== undefined) assertLiteral(rule.value, `${at}.config.rules[${item}].value`);
  });
}

function validateLimit(op: Record<string, unknown>, at: string): void {
  const config = assertRecord(op.config, `${at}.config`);
  assertEnum(config.mode, ['limit', 'top'], `${at}.config.mode`);
  assertFiniteNumber(config.limit, `${at}.config.limit`);
  assertEnum(config.unit, ['rows', 'percent'], `${at}.config.unit`);
  assertFiniteNumber(config.offset, `${at}.config.offset`);
  validateSortKeys(config.orderBy, `${at}.config.orderBy`);
}

function validatePivot(op: Record<string, unknown>, at: string): void {
  const config = assertRecord(op.config, `${at}.config`);
  assertStringArray(config.on, `${at}.config.on`, true);
  assertLiteralArray(config.values, `${at}.config.values`, true);
  assertStringArray(config.groupBy, `${at}.config.groupBy`);
  assertArray(config.using, `${at}.config.using`, true).forEach((value, item) => {
    const metric = assertRecord(value, `${at}.config.using[${item}]`);
    assertString(metric.function, `${at}.config.using[${item}].function`);
    assertString(metric.alias, `${at}.config.using[${item}].alias`);
    if (metric.expression !== '*')
      validateExpression(metric.expression, `${at}.config.using[${item}].expression`);
  });
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
  assertEnum(expr.kind, ['column', 'literal', 'binary', 'unary', 'function'], `${at}.kind`);
  if (expr.kind === 'column') assertString(expr.name, `${at}.name`);
  else if (expr.kind === 'literal') assertLiteral(expr.value, `${at}.value`);
  else if (expr.kind === 'binary') {
    assertString(expr.op, `${at}.op`);
    validateExpression(expr.left, `${at}.left`);
    validateExpression(expr.right, `${at}.right`);
  } else if (expr.kind === 'unary') {
    assertEnum(expr.op, ['is_null', 'is_not_null'], `${at}.op`);
    validateExpression(expr.value, `${at}.value`);
  } else if (expr.kind === 'function') {
    assertString(expr.name, `${at}.name`);
    assertArray(expr.args, `${at}.args`).forEach((arg, index) =>
      validateExpression(arg, `${at}.args[${index}]`)
    );
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
    fail(`${at} must be one of ${allowed.join(', ')}`);
}
function fail(message: string): never {
  throw new DataCommandError('VALIDATION_FAILED', `Invalid Workflow IR: ${message}`);
}

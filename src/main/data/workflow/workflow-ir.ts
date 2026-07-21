import { DataCommandError } from '../data-command-types';
import { createHash } from 'node:crypto';
import type {
  WorkflowIr,
  WorkflowOperationIr,
  WorkflowOperationProvenance,
  WorkflowSourceLanguage,
} from './workflow-model';

export const WORKFLOW_IR_VERSION = '1.0' as const;

const WORKFLOW_OPERATION_TYPES = new Set<WorkflowOperationIr['type']>([
  'filter',
  'sort',
  'drop',
  'select',
  'rename',
  'derive',
  'convert_type',
  'aggregate',
  'deduplicate',
  'missing_value',
  'limit',
  'pivot',
  'unpivot',
  'unnest',
]);

export function validateAndNormalizeWorkflowIr(value: unknown): WorkflowIr {
  value = migrateWorkflowIr(value);
  if (!isRecord(value)) {
    throw new DataCommandError('VALIDATION_FAILED', 'Workflow IR must be a JSON object');
  }
  const ir = value as unknown as WorkflowIr;
  if (ir.irVersion !== WORKFLOW_IR_VERSION) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Unsupported Workflow IR version: ${String(ir.irVersion)}`
    );
  }
  if (ir.kind !== 'workflow') {
    throw new DataCommandError('VALIDATION_FAILED', 'Workflow IR kind must be workflow');
  }
  if (ir.sourceLanguage !== 'javascript') {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Unsupported Workflow IR sourceLanguage: ${String(ir.sourceLanguage)}`
    );
  }
  if (!Array.isArray(ir.operations)) {
    throw new DataCommandError('VALIDATION_FAILED', 'Workflow IR operations must be an array');
  }
  if (typeof ir.inputSeen !== 'boolean' || !ir.inputSeen) {
    throw new DataCommandError('VALIDATION_FAILED', 'Workflow IR must declare an input');
  }
  if (typeof ir.outputSeen !== 'boolean' || !ir.outputSeen) {
    throw new DataCommandError('VALIDATION_FAILED', 'Workflow IR must declare an output');
  }

  const suppliedProvenance = validateProvenance(ir.provenance, ir.sourceLanguage);
  if (
    new Set(suppliedProvenance.map((entry) => entry.operationId)).size !== suppliedProvenance.length
  ) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Workflow IR provenance operationId values must be unique'
    );
  }
  const provenanceByOperationId = new Map(
    suppliedProvenance.map((entry) => [entry.operationId, entry] as const)
  );
  const operationIds = new Set<string>();
  const operations = ir.operations.map((operation, index) => {
    if (!isRecord(operation)) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow IR operation at index ${index} must be an object`
      );
    }
    if (!WORKFLOW_OPERATION_TYPES.has(operation.type)) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Unsupported Workflow IR operation at index ${index}: ${String(operation.type)}`
      );
    }
    validateWorkflowOperationPayload(operation, index);
    const operationId = operation.operationId?.trim() || `op_${String(index + 1).padStart(4, '0')}`;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(operationId)) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Invalid Workflow IR operationId at index ${index}: ${operationId}`
      );
    }
    if (operationIds.has(operationId)) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Duplicate Workflow IR operationId: ${operationId}`
      );
    }
    operationIds.add(operationId);
    if (
      operation.inputOperationId !== undefined &&
      typeof operation.inputOperationId !== 'string'
    ) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow IR operation inputOperationId at index ${index} must be a string`
      );
    }
    if (operation.location) {
      provenanceByOperationId.set(operationId, {
        operationId,
        language: ir.sourceLanguage,
        source: validateSourceLocation(operation.location, `operations[${index}].location`),
      });
    }
    return { ...operation, operationId };
  });
  for (const entry of suppliedProvenance) {
    if (!operationIds.has(entry.operationId)) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow IR provenance references unknown operationId: ${entry.operationId}`
      );
    }
  }
  for (const operation of operations) {
    if (
      operation.inputOperationId &&
      operation.inputOperationId !== 'input' &&
      !operationIds.has(operation.inputOperationId)
    ) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow IR operation ${operation.operationId} references unknown inputOperationId: ${operation.inputOperationId}`
      );
    }
  }
  assertAcyclicOperationGraph(operations);
  if (
    ir.outputOperationId &&
    ir.outputOperationId !== 'input' &&
    !operationIds.has(ir.outputOperationId)
  ) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Workflow IR output references unknown operationId: ${ir.outputOperationId}`
    );
  }

  return {
    ...ir,
    operations,
    provenance: [...provenanceByOperationId.values()].filter((entry) =>
      operationIds.has(entry.operationId)
    ),
  };
}

function assertAcyclicOperationGraph(operations: WorkflowOperationIr[]): void {
  const byId = new Map(
    operations
      .filter((operation): operation is WorkflowOperationIr & { operationId: string } =>
        Boolean(operation.operationId)
      )
      .map((operation) => [operation.operationId, operation] as const)
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id) || id === 'input') return;
    if (visiting.has(id)) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow IR operation graph contains a cycle at operationId: ${id}`
      );
    }
    visiting.add(id);
    const inputId = byId.get(id)?.inputOperationId;
    if (inputId) visit(inputId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}
/** Canonical semantic JSON excludes source locations and other diagnostic-only metadata. */
export function canonicalizeWorkflowIr(ir: WorkflowIr): string {
  const normalized = validateAndNormalizeWorkflowIr(ir);
  return stableJson({
    irVersion: normalized.irVersion,
    kind: normalized.kind,
    inputSeen: normalized.inputSeen,
    outputSeen: normalized.outputSeen,
    outputOperationId: normalized.outputOperationId ?? null,
    operations: normalized.operations
      .map(({ location: _location, ...operation }) => operation)
      .sort((left, right) => String(left.operationId).localeCompare(String(right.operationId))),
  });
}

export function computeWorkflowIrSemanticHash(ir: WorkflowIr): string {
  return createHash('sha256').update(canonicalizeWorkflowIr(ir)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Migrates pre-versioned internal IR snapshots to the current wire contract. */
export function migrateWorkflowIr(value: unknown): unknown {
  if (!isRecord(value) || value.irVersion !== undefined) return value;
  if (!Array.isArray(value.operations)) return value;
  return {
    ...value,
    irVersion: WORKFLOW_IR_VERSION,
    kind: value.kind ?? 'workflow',
    sourceLanguage: value.sourceLanguage ?? 'javascript',
    provenance: value.provenance ?? [],
  };
}

function validateWorkflowOperationPayload(operation: Record<string, unknown>, index: number): void {
  const at = `operations[${index}]`;
  switch (operation.type) {
    case 'filter':
      validateExpression(operation.condition, `${at}.condition`);
      return;
    case 'sort':
      validateExpression(operation.column, `${at}.column`);
      assertEnum(operation.direction, ['asc', 'desc'], `${at}.direction`);
      return;
    case 'drop':
    case 'select':
      assertStringArray(operation.columns, `${at}.columns`, true);
      return;
    case 'rename':
      assertString(operation.source, `${at}.source`);
      assertString(operation.target, `${at}.target`);
      return;
    case 'derive':
      assertString(operation.column, `${at}.column`);
      validateExpression(operation.expression, `${at}.expression`);
      return;
    case 'convert_type':
      assertString(operation.column, `${at}.column`);
      assertString(operation.targetType, `${at}.targetType`);
      assertRecord(operation.options, `${at}.options`);
      return;
    case 'aggregate':
      assertArray(operation.groupBy, `${at}.groupBy`).forEach((value, item) =>
        validateExpression(value, `${at}.groupBy[${item}]`)
      );
      assertArray(operation.metrics, `${at}.metrics`, true).forEach((value, item) => {
        const metric = assertRecord(value, `${at}.metrics[${item}]`);
        assertString(metric.fn, `${at}.metrics[${item}].fn`);
        assertString(metric.alias, `${at}.metrics[${item}].alias`);
        if (metric.expression !== '*')
          validateExpression(metric.expression, `${at}.metrics[${item}].expression`);
      });
      return;
    case 'deduplicate': {
      const config = assertRecord(operation.config, `${at}.config`);
      assertStringArray(config.columns, `${at}.config.columns`);
      assertEnum(config.keep, ['first', 'last'], `${at}.config.keep`);
      validateSortKeys(config.orderBy, `${at}.config.orderBy`);
      return;
    }
    case 'missing_value': {
      const config = assertRecord(operation.config, `${at}.config`);
      assertEnum(config.strategy, ['drop_empty_rows', 'by_column'], `${at}.config.strategy`);
      if (config.strategy === 'by_column') {
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
          if (rule.value !== undefined)
            assertLiteral(rule.value, `${at}.config.rules[${item}].value`);
        });
      }
      return;
    }
    case 'limit': {
      const config = assertRecord(operation.config, `${at}.config`);
      assertEnum(config.mode, ['limit', 'top'], `${at}.config.mode`);
      assertFiniteNumber(config.limit, `${at}.config.limit`);
      assertEnum(config.unit, ['rows', 'percent'], `${at}.config.unit`);
      assertFiniteNumber(config.offset, `${at}.config.offset`);
      validateSortKeys(config.orderBy, `${at}.config.orderBy`);
      return;
    }
    case 'pivot': {
      const config = assertRecord(operation.config, `${at}.config`);
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
      return;
    }
    case 'unpivot': {
      const config = assertRecord(operation.config, `${at}.config`);
      assertEnum(config.mode, ['columns', 'except'], `${at}.config.mode`);
      assertStringArray(config.columns, `${at}.config.columns`, true);
      assertString(config.nameColumn, `${at}.config.nameColumn`);
      assertString(config.valueColumn, `${at}.config.valueColumn`);
      assertBoolean(config.includeNulls, `${at}.config.includeNulls`);
      return;
    }
    case 'unnest': {
      const config = assertRecord(operation.config, `${at}.config`);
      assertEnum(config.sourceKind, ['list', 'json'], `${at}.config.sourceKind`);
      assertString(config.column, `${at}.config.column`);
      assertString(config.alias, `${at}.config.alias`);
      assertBoolean(config.recursive, `${at}.config.recursive`);
      assertBoolean(config.keepParentNames, `${at}.config.keepParentNames`);
      if (config.path !== undefined) assertString(config.path, `${at}.config.path`);
      if (config.withIndex !== undefined) assertString(config.withIndex, `${at}.config.withIndex`);
      if (config.maxDepth !== undefined)
        assertFiniteNumber(config.maxDepth, `${at}.config.maxDepth`);
    }
  }
}

function validateExpression(value: unknown, at: string): void {
  const expression = assertRecord(value, at);
  assertEnum(expression.kind, ['column', 'literal', 'binary', 'unary', 'function'], `${at}.kind`);
  if (expression.kind === 'column') assertString(expression.name, `${at}.name`);
  else if (expression.kind === 'literal') assertLiteral(expression.value, `${at}.value`);
  else if (expression.kind === 'binary') {
    assertString(expression.op, `${at}.op`);
    validateExpression(expression.left, `${at}.left`);
    validateExpression(expression.right, `${at}.right`);
  } else if (expression.kind === 'unary') {
    assertEnum(expression.op, ['is_null', 'is_not_null'], `${at}.op`);
    validateExpression(expression.value, `${at}.value`);
  } else if (expression.kind === 'function') {
    assertString(expression.name, `${at}.name`);
    assertArray(expression.args, `${at}.args`).forEach((arg, index) =>
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

function validateProvenance(
  value: unknown,
  language: WorkflowSourceLanguage
): WorkflowOperationProvenance[] {
  return assertArray(value, 'provenance').map((item, index) => {
    const entry = assertRecord(item, `provenance[${index}]`);
    const operationId = assertString(entry.operationId, `provenance[${index}].operationId`);
    const entryLanguage = assertString(entry.language, `provenance[${index}].language`);
    if (entryLanguage !== language) fail(`provenance[${index}].language must match sourceLanguage`);
    return {
      operationId,
      language,
      source: validateSourceLocation(entry.source, `provenance[${index}].source`),
    };
  });
}

function validateSourceLocation(value: unknown, at: string) {
  const location = assertRecord(value, at);
  return {
    functionName: assertString(location.functionName, `${at}.functionName`),
    start: assertFiniteNumber(location.start, `${at}.start`),
    end: assertFiniteNumber(location.end, `${at}.end`),
    line: assertFiniteNumber(location.line, `${at}.line`),
    column: assertFiniteNumber(location.column, `${at}.column`),
  };
}

function assertRecord(value: unknown, at: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${at} must be an object`);
  return value;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const WORKFLOW_IR_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://sophron.local/schemas/workflow-ir-1.0.json',
  title: 'Sophron Workflow IR',
  type: 'object',
  required: [
    'irVersion',
    'kind',
    'sourceLanguage',
    'inputSeen',
    'outputSeen',
    'operations',
    'provenance',
  ],
  properties: {
    irVersion: { const: WORKFLOW_IR_VERSION },
    kind: { const: 'workflow' },
    sourceLanguage: {
      const: 'javascript',
    },
    inputSeen: { type: 'boolean' },
    outputSeen: { type: 'boolean' },
    operations: {
      type: 'array',
      items: {
        oneOf: [
          operationSchema('filter', ['condition']),
          operationSchema('sort', ['column', 'direction']),
          operationSchema('drop', ['columns']),
          operationSchema('select', ['columns']),
          operationSchema('rename', ['source', 'target']),
          operationSchema('derive', ['column', 'expression']),
          operationSchema('convert_type', ['column', 'targetType', 'options']),
          operationSchema('aggregate', ['groupBy', 'metrics']),
          operationSchema('deduplicate', ['config']),
          operationSchema('missing_value', ['config']),
          operationSchema('limit', ['config']),
          operationSchema('pivot', ['config']),
          operationSchema('unpivot', ['config']),
          operationSchema('unnest', ['config']),
        ],
      },
    },
    provenance: {
      type: 'array',
      items: {
        type: 'object',
        required: ['operationId', 'language', 'source'],
        properties: {
          operationId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]*$' },
          language: { const: 'javascript' },
          source: {
            type: 'object',
            required: ['functionName', 'start', 'end', 'line', 'column'],
            properties: {
              functionName: { type: 'string', minLength: 1 },
              start: { type: 'integer', minimum: 0 },
              end: { type: 'integer', minimum: 0 },
              line: { type: 'integer', minimum: 1 },
              column: { type: 'integer', minimum: 1 },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

function operationSchema(type: WorkflowOperationIr['type'], payload: string[]) {
  return {
    type: 'object',
    required: ['operationId', 'type', ...payload],
    properties: {
      operationId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]*$' },
      type: { const: type },
    },
  } as const;
}

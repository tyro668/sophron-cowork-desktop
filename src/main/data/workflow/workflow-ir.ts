import { DataCommandError } from '../data-command-types';
import { createHash } from 'node:crypto';
import type {
  WorkflowIr,
  WorkflowOperationIr,
  WorkflowOperationProvenance,
  WorkflowSourceLanguage,
} from './workflow-model';
import {
  validateRegisteredWorkflowOperation,
  WORKFLOW_OPERATION_TYPES,
} from './workflow-operation-registry';

export const WORKFLOW_IR_VERSION = '1.0' as const;

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
    validateRegisteredWorkflowOperation(operation, index);
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
function assertFiniteNumber(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${at} must be a finite number`);
  return value;
}
function fail(message: string): never {
  throw new DataCommandError('VALIDATION_FAILED', `Invalid Workflow IR: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

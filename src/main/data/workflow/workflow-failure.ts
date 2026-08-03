import { createHash } from 'node:crypto';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import { DataCommandError, type DataCommandErrorCode } from '../data-command-types';
import { isRecord } from './utils';

export type WorkflowFailureStage =
  | 'generation_response'
  | 'javascript_compile'
  | 'sandbox_execution'
  | 'ir_validation'
  | 'workflow_lowering'
  | 'generation_contract'
  | 'dsl_compile'
  | 'node_validation'
  | 'node_execution'
  | 'output_validation'
  | 'resource'
  | 'internal';

export type WorkflowRepairClass = 'function_patch' | 'full_regeneration' | 'none';

export interface WorkflowFailureDiagnostic extends PrepDiagnostic {
  failureStage: WorkflowFailureStage;
  repairClass: WorkflowRepairClass;
  commandErrorCode: DataCommandErrorCode;
  functionName?: string;
  operationId?: string;
  operationType?: string;
  expectedSignature?: string;
  repairHint?: string;
  nodeId?: string;
  nodeType?: string;
}

export interface WorkflowFailureContext {
  failureStage: WorkflowFailureStage;
  commandErrorCode: DataCommandErrorCode;
  repairClass?: WorkflowRepairClass;
}

export interface WorkflowRepairBudget {
  readonly maxAttempts: number;
  attemptsUsed: number;
  readonly attemptedFingerprints: Set<string>;
}

export type WorkflowRepairClaim =
  | { accepted: true; attempt: number; fingerprint: string }
  | { accepted: false; reason: 'duplicate' | 'exhausted'; fingerprint: string };

const FAILURE_STAGES = new Set<WorkflowFailureStage>([
  'generation_response',
  'javascript_compile',
  'sandbox_execution',
  'ir_validation',
  'workflow_lowering',
  'generation_contract',
  'dsl_compile',
  'node_validation',
  'node_execution',
  'output_validation',
  'resource',
  'internal',
]);

const REPAIR_CLASSES = new Set<WorkflowRepairClass>([
  'function_patch',
  'full_regeneration',
  'none',
]);

const COMMAND_ERROR_CODES = new Set<DataCommandErrorCode>([
  'INVALID_ARGUMENT',
  'RESOURCE_NOT_FOUND',
  'RESOURCE_ALREADY_EXISTS',
  'AMBIGUOUS_RESOURCE',
  'FILE_ACCESS_DENIED',
  'GENERATION_FAILED',
  'DSL_PARSE_FAILED',
  'VALIDATION_FAILED',
  'RUN_FAILED',
  'INTERNAL_ERROR',
]);

export function createWorkflowRepairBudget(maxAttempts: number): WorkflowRepairBudget {
  return {
    maxAttempts: Math.max(0, Math.floor(maxAttempts)),
    attemptsUsed: 0,
    attemptedFingerprints: new Set<string>(),
  };
}

export function claimWorkflowRepairAttempt(input: {
  budget: WorkflowRepairBudget;
  javascriptSource: string;
  diagnostics: PrepDiagnostic[];
  repairFunctionName?: string;
}): WorkflowRepairClaim {
  const fingerprint = workflowRepairFingerprint(input);
  if (input.budget.attemptedFingerprints.has(fingerprint)) {
    return { accepted: false, reason: 'duplicate', fingerprint };
  }
  if (input.budget.attemptsUsed >= input.budget.maxAttempts) {
    return { accepted: false, reason: 'exhausted', fingerprint };
  }
  input.budget.attemptedFingerprints.add(fingerprint);
  input.budget.attemptsUsed += 1;
  return {
    accepted: true,
    attempt: input.budget.attemptsUsed,
    fingerprint,
  };
}

export function normalizeWorkflowFailureDiagnostics(
  diagnostics: PrepDiagnostic[],
  context: WorkflowFailureContext
): WorkflowFailureDiagnostic[] {
  const hasScopedFunction = diagnostics.some((diagnostic) =>
    Boolean(stringValue((diagnostic as PrepDiagnostic & Record<string, unknown>).functionName))
  );
  return diagnostics.map((diagnostic) => {
    const record = diagnostic as PrepDiagnostic & Record<string, unknown>;
    const failureStage = isWorkflowFailureStage(record.failureStage)
      ? record.failureStage
      : context.failureStage;
    const commandErrorCode = isDataCommandErrorCode(record.commandErrorCode)
      ? record.commandErrorCode
      : context.commandErrorCode;
    const repairClass = isWorkflowRepairClass(record.repairClass)
      ? record.repairClass
      : (context.repairClass ??
        inferWorkflowRepairClass(diagnostic, failureStage, commandErrorCode, hasScopedFunction));
    return {
      ...diagnostic,
      failureStage,
      repairClass,
      commandErrorCode,
      functionName: stringValue(record.functionName),
      operationId: stringValue(record.operationId),
      operationType: stringValue(record.operationType),
      expectedSignature: stringValue(record.expectedSignature),
      repairHint: stringValue(record.repairHint),
      nodeId: stringValue(record.nodeId),
      nodeType: stringValue(record.nodeType),
    };
  });
}

export function workflowDiagnosticsFromError(
  error: unknown,
  context: WorkflowFailureContext
): WorkflowFailureDiagnostic[] {
  if (error instanceof DataCommandError) {
    const details = error.details;
    const diagnostics =
      isRecord(details) &&
      Array.isArray(details.diagnostics) &&
      details.diagnostics.every(isPrepDiagnosticLike)
        ? details.diagnostics
        : [
            {
              severity: 'error' as const,
              code: error.code,
              message: stripDataCommandErrorPrefix(error.message),
            },
          ];
    return normalizeWorkflowFailureDiagnostics(diagnostics, {
      ...context,
      commandErrorCode: error.code,
    });
  }
  return normalizeWorkflowFailureDiagnostics(
    [
      {
        severity: 'error',
        code: context.commandErrorCode,
        message: error instanceof Error ? error.message : String(error),
      },
    ],
    context
  );
}

export function contextualizeWorkflowError(
  error: unknown,
  context: WorkflowFailureContext
): DataCommandError {
  const code = error instanceof DataCommandError ? error.code : context.commandErrorCode;
  const message =
    error instanceof DataCommandError
      ? stripDataCommandErrorPrefix(error.message)
      : error instanceof Error
        ? error.message
        : String(error);
  const diagnostics = workflowDiagnosticsFromError(error, { ...context, commandErrorCode: code });
  const existingDetails =
    error instanceof DataCommandError && isRecord(error.details) ? error.details : {};
  return new DataCommandError(code, message, {
    ...existingDetails,
    diagnostics,
  });
}

export function isWorkflowDiagnosticRepairable(diagnostic: PrepDiagnostic): boolean {
  const repairClass = (diagnostic as PrepDiagnostic & Record<string, unknown>).repairClass;
  return repairClass === 'function_patch' || repairClass === 'full_regeneration';
}

export function workflowCommandCodeForDiagnostics(
  diagnostics: PrepDiagnostic[],
  fallback: DataCommandErrorCode = 'VALIDATION_FAILED'
): DataCommandErrorCode {
  for (const diagnostic of diagnostics) {
    const commandErrorCode = (diagnostic as PrepDiagnostic & Record<string, unknown>)
      .commandErrorCode;
    if (isDataCommandErrorCode(commandErrorCode)) return commandErrorCode;
  }
  return fallback;
}

function inferWorkflowRepairClass(
  diagnostic: PrepDiagnostic,
  failureStage: WorkflowFailureStage,
  commandErrorCode: DataCommandErrorCode,
  hasScopedFunction: boolean
): WorkflowRepairClass {
  const functionName = stringValue(
    (diagnostic as PrepDiagnostic & Record<string, unknown>).functionName
  );
  const isFunctionScoped = Boolean(functionName) || hasScopedFunction;
  switch (failureStage) {
    case 'generation_response':
      return commandErrorCode === 'VALIDATION_FAILED' ? 'full_regeneration' : 'none';
    case 'javascript_compile':
      if (commandErrorCode === 'RUN_FAILED' && !isFunctionScoped) return 'none';
      return isFunctionScoped ? 'function_patch' : 'full_regeneration';
    case 'sandbox_execution':
      if (isFunctionScoped) return 'function_patch';
      return commandErrorCode === 'VALIDATION_FAILED' ? 'full_regeneration' : 'none';
    case 'ir_validation':
      return isFunctionScoped ? 'function_patch' : 'full_regeneration';
    case 'workflow_lowering':
      return isFunctionScoped ? 'function_patch' : 'none';
    case 'node_validation':
      return isFunctionScoped ? 'function_patch' : 'none';
    case 'node_execution':
      return isFunctionScoped ? 'function_patch' : 'none';
    case 'generation_contract':
    case 'dsl_compile':
    case 'output_validation':
    case 'resource':
    case 'internal':
      return 'none';
  }
}

function workflowRepairFingerprint(input: {
  javascriptSource: string;
  diagnostics: PrepDiagnostic[];
  repairFunctionName?: string;
}): string {
  const diagnosticSummary = input.diagnostics.map((diagnostic) => {
    const record = diagnostic as PrepDiagnostic & Record<string, unknown>;
    return {
      severity: diagnostic.severity,
      code: diagnostic.code ?? null,
      message: diagnostic.message,
      line: diagnostic.line ?? null,
      column: diagnostic.column ?? null,
      failureStage: record.failureStage ?? null,
      repairClass: record.repairClass ?? null,
      functionName: record.functionName ?? null,
      operationId: record.operationId ?? null,
      operationType: record.operationType ?? null,
      expectedSignature: record.expectedSignature ?? null,
      repairHint: record.repairHint ?? null,
      nodeId: record.nodeId ?? null,
    };
  });
  return createHash('sha256')
    .update(input.javascriptSource)
    .update('\0')
    .update(input.repairFunctionName ?? '')
    .update('\0')
    .update(JSON.stringify(diagnosticSummary))
    .digest('hex');
}

function stripDataCommandErrorPrefix(message: string): string {
  return message.replace(/^\[[A-Z_]+\]\s*/, '');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isWorkflowFailureStage(value: unknown): value is WorkflowFailureStage {
  return typeof value === 'string' && FAILURE_STAGES.has(value as WorkflowFailureStage);
}

function isWorkflowRepairClass(value: unknown): value is WorkflowRepairClass {
  return typeof value === 'string' && REPAIR_CLASSES.has(value as WorkflowRepairClass);
}

function isDataCommandErrorCode(value: unknown): value is DataCommandErrorCode {
  return typeof value === 'string' && COMMAND_ERROR_CODES.has(value as DataCommandErrorCode);
}

function isPrepDiagnosticLike(value: unknown): value is PrepDiagnostic {
  return (
    isRecord(value) &&
    (value.severity === 'error' || value.severity === 'warning') &&
    typeof value.message === 'string'
  );
}

/**
 * Diagnostics produced while validating and executing an AI-generated jflow program, tagged with
 * the pipeline stage that failed and the command error code to surface.
 */
import type { WorkflowDiagnostic } from '../../../shared/workflow-diagnostics';
import { DataCommandError, type DataCommandErrorCode } from '../data-command-types';
import { isRecord } from './utils';

export type WorkflowFailureStage =
  'workflow_lowering' | 'node_validation' | 'node_execution' | 'output_validation';

export interface WorkflowFailureDiagnostic extends WorkflowDiagnostic {
  failureStage: WorkflowFailureStage;
  commandErrorCode: DataCommandErrorCode;
  nodeId?: string;
  nodeType?: string;
}

export interface WorkflowFailureContext {
  failureStage: WorkflowFailureStage;
  commandErrorCode: DataCommandErrorCode;
}

const COMMAND_ERROR_CODES = new Set<DataCommandErrorCode>([
  'INVALID_ARGUMENT',
  'RESOURCE_NOT_FOUND',
  'RESOURCE_ALREADY_EXISTS',
  'AMBIGUOUS_RESOURCE',
  'FILE_ACCESS_DENIED',
  'GENERATION_FAILED',
  'ANALYSIS_REQUIRED',
  'ANALYSIS_STALE',
  'CONFIRMATION_REQUIRED',
  'REQUIREMENT_NOT_SUPPORTED',
  'DSL_PARSE_FAILED',
  'VALIDATION_FAILED',
  'RUN_FAILED',
  'INTERNAL_ERROR',
]);

export function normalizeWorkflowFailureDiagnostics(
  diagnostics: WorkflowDiagnostic[],
  context: WorkflowFailureContext
): WorkflowFailureDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    const record = diagnostic as WorkflowDiagnostic & Record<string, unknown>;
    return {
      ...diagnostic,
      failureStage: context.failureStage,
      commandErrorCode: isDataCommandErrorCode(record.commandErrorCode)
        ? record.commandErrorCode
        : context.commandErrorCode,
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
      details.diagnostics.every(isDiagnosticLike)
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

export function workflowCommandCodeForDiagnostics(
  diagnostics: WorkflowDiagnostic[],
  fallback: DataCommandErrorCode = 'VALIDATION_FAILED'
): DataCommandErrorCode {
  for (const diagnostic of diagnostics) {
    const commandErrorCode = (diagnostic as WorkflowDiagnostic & Record<string, unknown>)
      .commandErrorCode;
    if (isDataCommandErrorCode(commandErrorCode)) return commandErrorCode;
  }
  return fallback;
}

function stripDataCommandErrorPrefix(message: string): string {
  return message.replace(/^\[[A-Z_]+\]\s*/, '');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isDataCommandErrorCode(value: unknown): value is DataCommandErrorCode {
  return typeof value === 'string' && COMMAND_ERROR_CODES.has(value as DataCommandErrorCode);
}

function isDiagnosticLike(value: unknown): value is WorkflowDiagnostic {
  return (
    isRecord(value) &&
    (value.severity === 'error' || value.severity === 'warning') &&
    typeof value.message === 'string'
  );
}

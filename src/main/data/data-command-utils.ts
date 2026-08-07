import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import type { PrepDiagnostic } from '../../shared/prep-dsl';
import type {
  DataTaskWorkflow,
  DataWorkflowEdge,
  DataWorkflowEdgeInput,
  DataWorkflowNode,
  DataWorkflowNodeInput,
  DataWorkflowSaveInput,
} from '../../renderer/types';
import { DataCommandError, type WorkflowSaveShape } from './data-command-types';
import { log } from '../utils/logger';
import { isRecord } from './workflow';

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_PREVIEW_LIMIT = 20;
export const MAX_PREVIEW_LIMIT = 100;

export interface CompiledWorkflowCandidate {
  workflow: WorkflowSaveShape;
  diagnostics: PrepDiagnostic[];
}

export function listWindow(
  limit: number | undefined,
  offset: number | undefined
): { limit: number; offset: number } {
  return {
    limit: clampInteger(limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT),
    offset: Math.max(0, Math.floor(Number(offset) || 0)),
  };
}

export function previewLimit(limit: number | undefined): number {
  return clampInteger(limit, DEFAULT_PREVIEW_LIMIT, 1, MAX_PREVIEW_LIMIT);
}

export function previewOffset(offset: number | undefined): number {
  return Math.max(0, Math.floor(Number(offset) || 0));
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(Number(value))));
}

export function normalizeOptionalName(name: string | undefined): string | undefined {
  const normalized = name?.trim();
  return normalized || undefined;
}

export function normalizeRequiredName(name: string, message: string): string {
  const normalized = name.trim();
  if (!normalized) throw new DataCommandError('INVALID_ARGUMENT', message);
  return normalized;
}

export function buildAutomationCloudMirrorInputName(
  tableName: string | undefined,
  tableId: string
): string {
  const baseName = normalizeOptionalName(tableName) || `cloud_table_${tableId.slice(0, 8)}`;
  return `${baseName}_自动化镜像_${tableId.slice(0, 8)}`;
}

export function nextGeneratedTaskVersion(currentVersion: number | null | undefined): number {
  return Number.isFinite(currentVersion) && Number(currentVersion) > 0
    ? Math.floor(Number(currentVersion)) + 1
    : 1;
}

export function findWorkflowNode(workflow: DataTaskWorkflow, nodeId: string): DataWorkflowNode {
  const node = workflow.nodes.find((item) => item.id === nodeId);
  if (!node) {
    const available = workflow.nodes.map((item) => `${item.id} (${item.type})`).join(', ');
    throw new DataCommandError(
      'RESOURCE_NOT_FOUND',
      `Workflow node not found: ${nodeId}${
        available ? `. Available nodes: ${available}` : '. The workflow has no saved nodes.'
      }`
    );
  }
  return node;
}

export function updateWorkflowNode(
  workflow: DataTaskWorkflow,
  nodeId: string,
  updates: Partial<Pick<DataWorkflowNodeInput, 'label' | 'config'>>
): DataWorkflowSaveInput {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: updates.label && node.id === nodeId ? updates.label : node.label,
      x: node.x,
      y: node.y,
      config: node.id === nodeId ? (updates.config ?? node.config) : node.config,
    })),
    edges: workflow.edges.map(toWorkflowEdgeInput),
  };
}

export function toWorkflowSaveShape(workflow: DataTaskWorkflow): DataWorkflowSaveInput {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      x: node.x,
      y: node.y,
      config: node.config,
    })),
    edges: workflow.edges.map(toWorkflowEdgeInput),
  };
}

function toWorkflowEdgeInput(edge: DataWorkflowEdge): DataWorkflowEdgeInput {
  return {
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  };
}

export function diagnosticsWithSeverity(
  diagnostics: PrepDiagnostic[],
  severity: PrepDiagnostic['severity']
): PrepDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === severity);
}

export function summarizeDiagnostics(diagnostics: PrepDiagnostic[]): string {
  if (diagnostics.length === 0) return 'DSL validation failed';
  return diagnostics
    .slice(0, 3)
    .map((diagnostic) => {
      const location =
        diagnostic.line || diagnostic.column
          ? ` at ${diagnostic.line ?? '?'}:${diagnostic.column ?? '?'}`
          : '';
      return `${diagnostic.code ?? diagnostic.severity}${location}: ${diagnostic.message}`;
    })
    .join('\n');
}

export function sanitizeAlias(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  return /^[_\p{L}][_\p{L}\p{N}]*$/u.test(normalized) ? normalized : '';
}

export function escapeDslString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function stringConfigValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function toCommandError(
  error: unknown,
  fallbackCode: DataCommandError['code']
): DataCommandError {
  if (error instanceof DataCommandError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (isRecord(error) && isRecord(error.workflowOrigin)) {
    const origin = error.workflowOrigin;
    return new DataCommandError(fallbackCode, message, {
      diagnostics: [
        {
          severity: 'error',
          code: fallbackCode,
          message,
          functionName: typeof origin.functionName === 'string' ? origin.functionName : undefined,
          operationId: typeof origin.operationId === 'string' ? origin.operationId : undefined,
          operationType:
            typeof origin.operationType === 'string' ? origin.operationType : undefined,
          nodeId: typeof origin.nodeId === 'string' ? origin.nodeId : undefined,
          nodeType: typeof origin.nodeType === 'string' ? origin.nodeType : undefined,
          line: typeof origin.line === 'number' ? origin.line : undefined,
          column: typeof origin.column === 'number' ? origin.column : undefined,
        },
      ],
    });
  }
  if (
    /TransactionContext|transaction is aborted|cannot start a transaction within a transaction/i.test(
      message
    )
  ) {
    return new DataCommandError('RUN_FAILED', message);
  }
  if (
    /source|file|folder|path|unsupported|does not exist/i.test(message) &&
    fallbackCode === 'FILE_ACCESS_DENIED'
  ) {
    return new DataCommandError('FILE_ACCESS_DENIED', message);
  }
  if (/not found|does not exist|not exist/i.test(message)) {
    return new DataCommandError('RESOURCE_NOT_FOUND', message);
  }
  return new DataCommandError(fallbackCode, message || 'Data command failed');
}

export function isDataCommandErrorCode(
  error: unknown,
  code: DataCommandError['code']
): error is DataCommandError {
  return (
    (error instanceof DataCommandError && error.code === code) ||
    (isRecord(error) && error.code === code)
  );
}

export function logDataCommandFallback(
  message: string,
  error: unknown,
  context: Record<string, unknown> = {}
): void {
  const errorDetails =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) };
  log(`[DataCommandService] ${message}`, { ...context, error: errorDetails });
}

export function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashWorkflowGraph(workflow: WorkflowSaveShape): string {
  const nodes = workflow.nodes
    .map((node) => ({
      id: stripWorkflowStorageNamespace(node.id),
      type: node.type,
      config: stripWorkflowCompatibilityMetadata(node.config ?? {}),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = workflow.edges
    .map((edge) => ({
      id: stripWorkflowStorageNamespace(edge.id),
      sourceNodeId: stripWorkflowStorageNamespace(edge.sourceNodeId),
      targetNodeId: stripWorkflowStorageNamespace(edge.targetNodeId),
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return hashText(stableWorkflowJson({ nodes, edges }));
}

function stripWorkflowStorageNamespace(id: string): string {
  const separatorIndex = id.indexOf('__');
  return separatorIndex >= 0 ? id.slice(separatorIndex + 2) : id;
}

function stripWorkflowCompatibilityMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripWorkflowCompatibilityMetadata);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, entryValue]) =>
          key !== 'dsl' && key !== 'generatedOrigin' && entryValue !== undefined
      )
      .map(([key, entryValue]) => [key, stripWorkflowCompatibilityMetadata(entryValue)])
  );
}

function stableWorkflowJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableWorkflowJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableWorkflowJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function hashFile(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

export function cloneCompiledWorkflowCandidate(
  candidate: CompiledWorkflowCandidate
): CompiledWorkflowCandidate {
  return {
    workflow: structuredClone(candidate.workflow),
    diagnostics: structuredClone(candidate.diagnostics),
  };
}

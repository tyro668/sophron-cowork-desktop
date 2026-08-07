import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { TSchema } from '@sinclair/typebox';
import type { AgentRuntimeConfig } from '../../renderer/types';

export type DataToolDefinition = ToolDefinition<TSchema, unknown>;

export interface DataToolPromptContext {
  sessionId: string;
  workspacePath?: string;
  selectedDataTaskId?: string;
  selectedDataTaskName?: string;
  selectedInputTableId?: string;
  selectedInputTableName?: string;
  selectedOutputTableId?: string;
  selectedOutputTableName?: string;
  capabilities: {
    canCreateInputTable: boolean;
    canCreateOutputTable: boolean;
    canCreateTask: boolean;
    canRunTask: boolean;
    canImportLocalFiles: boolean;
  };
}

export interface DataToolExecutionContext {
  sessionId: string;
  currentUserMessageId?: string;
  runtimeConfig?: AgentRuntimeConfig;
  toolCallId?: string;
  signal?: AbortSignal;
}

export interface AnalyzeDataTaskRequirementToolInput {
  inputTableId: string;
  processRequirement: string;
}

export interface GenerateDataTaskFromAnalysisToolInput {
  analysisId: string;
  confirmed: true;
  taskName?: string;
  outputMode: 'create' | 'replace';
  outputTableName?: string;
  outputTableId?: string;
}

export interface DataToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: unknown;
}

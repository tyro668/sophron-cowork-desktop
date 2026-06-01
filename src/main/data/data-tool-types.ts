import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { TSchema } from '@sinclair/typebox';

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

export interface DataToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: unknown;
}

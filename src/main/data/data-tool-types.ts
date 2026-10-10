import type { DataPipelineAuthoringRequest } from '../../shared/data-pipeline-authoring';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import type {
  DataPipelineRequirementConversationEntry,
  AgentRuntimeConfig,
} from '../../shared/contracts';

export type DataToolDefinition = ToolDefinition<TSchema, unknown>;

export interface DataResourceRef {
  kind: 'RawTable' | 'ResultTable' | 'Pipeline';
  id: string;
  name?: string;
  /** true when the id only appeared inside a list result — a candidate, not a selection. */
  listed?: boolean;
}

export interface DataToolPromptContext {
  sessionId: string;
  workspacePath?: string;
  authoringRequest?: DataPipelineAuthoringRequest;
  selectedDataPipelineId?: string;
  selectedDataPipelineName?: string;
  selectedRawTableId?: string;
  selectedRawTableName?: string;
  selectedResultTableId?: string;
  selectedResultTableName?: string;
  /** Resources resolved/created by earlier tool calls in this session. */
  recentResources?: DataResourceRef[];
  /** Cloud tables attached to the current user message. */
  attachedCloudTables?: Array<{ id: string; name?: string }>;
  capabilities: {
    canCreateRawTable: boolean;
    canCreateResultTable: boolean;
    canCreatePipeline: boolean;
    canRunPipeline: boolean;
    canImportLocalFiles: boolean;
  };
}

export interface DataToolExecutionContext {
  sessionId: string;
  currentUserMessageId?: string;
  requirementConversation?: DataPipelineRequirementConversationEntry[];
  authoringRequest?: DataPipelineAuthoringRequest;
  runtimeConfig?: AgentRuntimeConfig;
  toolCallId?: string;
  signal?: AbortSignal;
  onActivity?: () => void;
}

export interface AnalyzeDataPipelineRequirementToolInput {
  rawTableId: string;
  processRequirement: string;
  reusePipelineId?: string;
  startFromNodeId?: string;
}

export interface GenerateDataPipelineFromAnalysisToolInput {
  analysisId: string;
  confirmed: true;
  pipelineName?: string;
  outputMode: 'create' | 'replace';
  resultTableName?: string;
  resultTableId?: string;
}

export interface DataToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: unknown;
}

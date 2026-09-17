/**
 * Cross-process session contracts. Shared by main, preload, and renderer.
 * Must not import from main/, renderer/, or preload/.
 */
import type { PermissionRule as SharedPermissionRule } from '../../permission-policies';

export interface CloudTableChatAttachment {
  id: string;
  tableId: string;
  tableName: string;
  spaceId?: string;
  spaceName?: string;
  projectId?: string;
  projectName?: string;
  datasourceId?: string;
  folderId?: string;
  rowCount?: number;
  columns?: string[];
  sampleRows?: Array<Record<string, unknown>>;
  accessModeLabel?: string;
  connectionLabel?: string;
}

// Session types
export interface Session {
  id: string;
  title: string;
  agentSessionId?: string;
  openaiThreadId?: string;
  status: SessionStatus;
  projectId?: string;
  projectName?: string;
  cwd?: string;
  mountedPaths: MountedPath[];
  allowedTools: string[];
  memoryEnabled: boolean;
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export type SessionStatus = 'idle' | 'running' | 'completed' | 'error';

export interface MountedPath {
  virtual: string;
  real: string;
}

export interface Project {
  id: string;
  name: string | null;
  cwd: string;
  createdAt: number;
  updatedAt: number;
}

// Message types
export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: ContentBlock[];
  timestamp: number;
  api?: string;
  provider?: string;
  model?: string;
  tokenUsage?: TokenUsage;
  localStatus?: 'queued' | 'cancelled';
  executionTimeMs?: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export type ContentBlock =
  | TextContent
  | ImageContent
  | FileAttachmentContent
  | CloudTableAttachmentContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export interface FileAttachmentContent {
  type: 'file_attachment';
  filename: string;
  relativePath: string; // Path relative to session's .tmp folder
  size: number;
  mimeType?: string;
  inlineDataBase64?: string;
}

export interface CloudTableAttachmentContent {
  type: 'cloud_table_attachment';
  tables: CloudTableChatAttachment[];
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  displayName?: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
  images?: Array<{
    data: string; // base64 encoded image data
    mimeType: string; // e.g., 'image/png'
  }>;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

// Trace types for visualization
export interface TraceStep {
  id: string;
  type: TraceStepType;
  status: TraceStepStatus;
  title: string;
  /** Correlates every trace step emitted by one AgentRunner.run() turn. */
  turnId?: string;
  /** Optional parent span, for example a permission step belonging to a tool call. */
  parentId?: string;
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  toolOutputTruncated?: boolean;
  toolOutputLength?: number;
  resultMessageId?: string;
  isError?: boolean;
  error?: TraceError;
  permission?: TracePermission;
  outcome?: TraceOutcome;
  /** Aggregated evaluation metrics for the root span of one agent turn. */
  metrics?: TraceEvaluationMetrics;
  timestamp: number;
  endedAt?: number;
  duration?: number;
}

export interface TraceError {
  stage:
    | 'validation'
    | 'permission'
    | 'execution'
    | 'provider'
    | 'timeout'
    | 'loop_guard'
    | 'sandbox_sync'
    | 'unknown';
  code?: string;
  message: string;
  retriable?: boolean;
  details?: unknown;
}

export interface TracePermission {
  decision:
    | 'rule_allow'
    | 'rule_deny'
    | 'auto_review_allow'
    | 'auto_review_ask'
    | 'user_allow'
    | 'user_deny'
    | 'allow_always'
    | 'request_failed';
  source: 'rule' | 'user' | 'system' | 'auto_review';
  remembered?: boolean;
  reason?: string;
}

export interface TraceEvaluationMetrics {
  provider?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costTotal: number;
  modelCallCount: number;
  toolCallCount: number;
  toolErrorCount: number;
  permissionPromptCount: number;
  totalDurationMs: number;
  firstResponseLatencyMs?: number;
  firstTokenLatencyMs?: number;
  modelDurationMs: number;
  toolDurationMs: number;
  permissionWaitMs: number;
}

export type TraceOutcome =
  | 'responded_without_tool'
  | 'tool_completed'
  | 'tool_failed'
  | 'permission_denied'
  | 'cancelled'
  | 'timed_out'
  | 'provider_failed'
  | 'protocol_violation'
  | 'loop_guard_stopped';

export type TraceStepType = 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'permission';

export type TraceStepStatus = 'pending' | 'running' | 'completed' | 'error';

// Permission types
export interface PermissionRequest {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
}

export type PermissionResult = 'allow' | 'deny' | 'allow_always';

// Sudo password types
export interface SudoPasswordRequest {
  toolUseId: string;
  command: string;
  sessionId: string;
}

// AskUserQuestion display types - kept for rendering historical messages
export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export type PermissionRule = SharedPermissionRule;

// Tool types
export type ToolName =
  | 'read'
  | 'write'
  | 'edit'
  | 'glob'
  | 'grep'
  | 'bash'
  | 'webFetch'
  | 'webSearch';

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

// Execution context
export interface ExecutionContext {
  sessionId: string;
  cwd: string;
  mountedPaths: MountedPath[];
  allowedTools: string[];
}

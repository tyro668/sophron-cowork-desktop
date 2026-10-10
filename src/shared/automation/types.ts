export type AutomationStatus = 'enabled' | 'disabled' | 'paused' | 'running' | 'failed';

export type AutomationRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type AutomationTriggerReason =
  'timer' | 'manual' | 'retry' | 'queued_overlap' | 'file_change' | 'output_change';

export type AutomationDeliveryStatus = 'pending' | 'succeeded' | 'partial' | 'failed' | 'skipped';

export type AutomationTrigger =
  | AutomationTriggerManual
  | AutomationTriggerOnce
  | AutomationTriggerInterval
  | AutomationTriggerDaily
  | AutomationTriggerWeekly
  | AutomationTriggerMonthly
  | AutomationTriggerCron
  | AutomationTriggerFileChange;

export interface AutomationTriggerManual {
  kind: 'manual';
  timezone: string;
}

export interface AutomationTriggerOnce {
  kind: 'once';
  runAt: number;
  timezone: string;
}

export interface AutomationTriggerInterval {
  kind: 'interval';
  every: number;
  unit: 'minute' | 'hour' | 'day';
  startAt: number;
  endAt?: number | null;
  timezone: string;
}

export interface AutomationTriggerDaily {
  kind: 'daily';
  times: string[];
  startAt?: number | null;
  endAt?: number | null;
  timezone: string;
}

export interface AutomationTriggerWeekly {
  kind: 'weekly';
  weekdays: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>;
  times: string[];
  startAt?: number | null;
  endAt?: number | null;
  timezone: string;
}

export interface AutomationTriggerMonthly {
  kind: 'monthly';
  daysOfMonth: number[];
  includeLastDay?: boolean;
  times: string[];
  startAt?: number | null;
  endAt?: number | null;
  timezone: string;
}

export interface AutomationTriggerCron {
  kind: 'cron';
  expression: string;
  startAt?: number | null;
  endAt?: number | null;
  timezone: string;
}

export interface AutomationTriggerFileChange {
  kind: 'file_change';
  projectId?: string | null;
  patterns: string[];
  debounceMs: number;
  timezone: string;
}

export interface AutomationFailurePolicy {
  disableOnFailure: boolean;
  retry: {
    enabled: boolean;
    maxAttempts: number;
    backoffMs: number;
  };
  notifyOnFailure: boolean;
}

export interface AutomationConcurrencyPolicy {
  overlapPolicy: 'skip' | 'queue_once';
}

export interface AutomationActionGraph {
  version: 1;
  nodes: AutomationActionNode[];
  edges: AutomationActionEdge[];
}

export interface AutomationActionNode {
  id: string;
  type: string;
  label?: string;
  enabled: boolean;
  config: Record<string, unknown>;
  failurePolicy?: AutomationActionFailurePolicy;
  inputBindings?: Record<string, AutomationValueRef>;
}

export interface AutomationActionEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  outputKey?: string;
  inputKey?: string;
}

export type AutomationValueRef =
  | { kind: 'literal'; value: unknown }
  | { kind: 'node_output'; nodeId: string; outputKey: string }
  | { kind: 'automation_context'; key: string };

export interface AutomationActionFailurePolicy {
  onFailure: 'stop' | 'continue' | 'skip_downstream';
  emitErrorArtifact: boolean;
}

export type AutomationArtifactKind =
  'text' | 'markdown' | 'table' | 'file' | 'link' | 'session' | 'data_input' | 'data_output';

export interface AutomationArtifact {
  id: string;
  runId: string;
  sourceNodeId?: string;
  kind: AutomationArtifactKind;
  title: string;
  summary?: string;
  mimeType?: string;
  content?: string;
  filePath?: string;
  href?: string;
  dataRef?: {
    kind: 'raw_table' | 'result_table' | 'session';
    id: string;
  };
  createdAt: number;
}

export type AutomationDeliveryChannelType = 'feishu' | 'email' | 'webhook';

export interface AutomationDeliveryConfig {
  enabled: boolean;
  channels: AutomationDeliveryChannel[];
  artifactPolicy: 'summary' | 'links' | 'attachments';
  failureMessage: {
    includeRunLog: boolean;
    includeArtifacts: boolean;
  };
}

export interface AutomationDeliveryChannel {
  id: string;
  type: AutomationDeliveryChannelType;
  enabled: boolean;
  recipient: string;
  templateId?: string | null;
  maxAttachmentBytes?: number | null;
  config: Record<string, unknown>;
}

export interface AutomationOutputBinding {
  resultTableId: string;
  runOnChange: boolean;
}

export interface AutomationGroup {
  id: string;
  name: string;
  createdAt: number;
}

export interface AutomationCreateGroupInput {
  name: string;
}

export interface AutomationRenameGroupInput {
  id: string;
  name: string;
}

export interface AutomationAssignGroupInput {
  ids: string[];
  groupId: string | null;
}

export interface Automation {
  outputBindings?: AutomationOutputBinding[];
  id: string;
  name: string;
  description: string | null;
  projectId: string | null;
  groupId: string | null;
  enabled: boolean;
  status: AutomationStatus;
  trigger: AutomationTrigger;
  actionGraph: AutomationActionGraph;
  delivery: AutomationDeliveryConfig | null;
  failurePolicy: AutomationFailurePolicy;
  concurrencyPolicy: AutomationConcurrencyPolicy;
  nextRunAt: number | null;
  lockedRunId: string | null;
  lastRunAt: number | null;
  lastRunStatus: AutomationRunStatus | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  triggerReason: AutomationTriggerReason;
  queuedAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  error: string | null;
  artifactCount: number;
  deliveryStatus: AutomationDeliveryStatus | null;
  createdSessionId: string | null;
  createdAt: number;
}

export type AutomationJsonSchema = {
  type: 'object';
  required?: string[];
  properties: Record<
    string,
    {
      type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
      title?: string;
      description?: string;
      enum?: Array<string | number | boolean>;
      default?: unknown;
      items?: AutomationJsonSchema['properties'][string];
      properties?: AutomationJsonSchema['properties'];
    }
  >;
};

export interface AutomationActionDefinitionSummary {
  type: string;
  title: string;
  description?: string;
  category: 'conversation' | 'data' | 'artifact' | 'integration' | 'custom';
  icon: string;
  version: number;
  configSchema: AutomationJsonSchema;
}

export interface AutomationListQuery {
  query?: string;
  status?: AutomationStatus | 'all';
  projectId?: string | null;
  limit?: number;
  offset?: number;
  /** When set, only fetch rows for this group (null = ungrouped). Used for "load all". */
  groupId?: string | null;
  /** Max rows to fetch per group for the initial grouped load. */
  perGroupLimit?: number;
}

export interface AutomationListResult {
  automations: Automation[];
  groupCounts: Record<string, number>;
}

export interface AutomationCreateInput {
  outputBindings?: AutomationOutputBinding[];
  name: string;
  description?: string | null;
  projectId?: string | null;
  enabled?: boolean;
  trigger: AutomationTrigger;
  actionGraph: AutomationActionGraph;
  delivery?: AutomationDeliveryConfig | null;
  failurePolicy?: Partial<AutomationFailurePolicy>;
  concurrencyPolicy?: Partial<AutomationConcurrencyPolicy>;
}

export interface AutomationUpdateInput {
  outputBindings?: AutomationOutputBinding[];
  name?: string;
  description?: string | null;
  projectId?: string | null;
  enabled?: boolean;
  trigger?: AutomationTrigger;
  actionGraph?: AutomationActionGraph;
  delivery?: AutomationDeliveryConfig | null;
  failurePolicy?: Partial<AutomationFailurePolicy>;
  concurrencyPolicy?: Partial<AutomationConcurrencyPolicy>;
}

export interface AutomationRunQuery {
  limit?: number;
  offset?: number;
  status?: AutomationRunStatus | 'all';
}

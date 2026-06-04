import type {
  PermissionPolicyId,
  PermissionRule as SharedPermissionRule,
} from '../../shared/permission-policies';

// Session types
export interface Session {
  id: string;
  title: string;
  claudeSessionId?: string;
  openaiThreadId?: string;
  status: SessionStatus;
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
    data: string;          // base64 encoded image data
    mimeType: string;      // e.g., 'image/png'
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
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  isError?: boolean;
  timestamp: number;
  duration?: number;
}

export type TraceStepType = 'thinking' | 'text' | 'tool_call' | 'tool_result';
export type TraceStepStatus = 'pending' | 'running' | 'completed' | 'error';

export type ScheduleRepeatUnit = 'minute' | 'hour' | 'day';
export type ScheduleWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DailyScheduleConfig {
  kind: 'daily';
  times: string[];
}

export interface WeeklyScheduleConfig {
  kind: 'weekly';
  weekdays: ScheduleWeekday[];
  times: string[];
}

export type ScheduleConfig = DailyScheduleConfig | WeeklyScheduleConfig;

export interface ScheduleTask {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt: number | null;
  scheduleConfig: ScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: ScheduleRepeatUnit | null;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunSessionId: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleCreateInput {
  title?: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
}

export interface ScheduleUpdateInput {
  title?: string;
  prompt?: string;
  cwd?: string;
  runAt?: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
  lastRunAt?: number | null;
  lastRunSessionId?: string | null;
  lastError?: string | null;
}

// Data workspace types
export type DataTaskStatus = 'running' | 'completed' | 'stopped' | 'draft' | 'pending' | 'failed';

export type DataTaskStatusCounts = Record<DataTaskStatus, number>;

export interface DataCleaningTask {
  id: string;
  name: string;
  status: DataTaskStatus;
  nodeCount: number;
  sourcePath: string | null;
  sourceDatasetId: string | null;
  outputTable: string | null;
  rowCount: number | null;
  columnCount: number | null;
  error: string | null;
  scheduledFor: number | null;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
}

export type DataInputTableSourceKind = 'excel' | 'csv' | 'folder';

export type DataInputTableProcessingStrategy = 'auto' | 'customize';

export interface DataInputTableAutoProcessingConfig {
  strategy: 'auto';
}

export type DataNormalizerRuntime =
  | { language: 'python'; pythonVersion?: string; environment: 'system' | 'venv'; executable?: string }
  | { language: 'node'; nodeVersion?: string; environment: 'system' | 'npm'; executable?: string };

export interface DataNormalizerEntrypoint {
  cwd?: string;
  command: string[];
}

export interface DataNormalizerDependencyPrepareConfig {
  steps: Array<{
    cwd?: string;
    command: string[];
  }>;
  preparedRuntime?: string;
  lockFiles: string[];
}

export interface DataNormalizerProjectFile {
  path: string;
  content: string;
}

export type DataNormalizerLanguage = 'python' | 'node';
export type DataNormalizerArtifactVersionStatus = 'draft' | 'published' | 'archived';

export interface DataNormalizerDependencySpec {
  name: string;
  version?: string;
  manager?: 'pip' | 'npm';
  source?: string;
}

export interface DataInputTableNormalizerArtifact {
  id: string;
  name: string;
  description?: string | null;
  sourceKind: DataInputTableSourceKind;
  primaryLanguage: DataNormalizerLanguage;
  activeVersionId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DataInputTableNormalizerArtifactVersion {
  id: string;
  artifactId: string;
  version: number;
  status: DataNormalizerArtifactVersionStatus;
  files: DataNormalizerProjectFile[];
  fileTreeHash: string;
  rulePrompt: string;
  sourceSummaryHash?: string | null;
  entrypoint: DataNormalizerEntrypoint;
  dependencyPrepare?: DataNormalizerDependencyPrepareConfig;
  runtime: DataNormalizerRuntime;
  dependencies: DataNormalizerDependencySpec[];
  dependencyLockHash?: string | null;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number | null;
}

export interface DataSaveInputTableNormalizerDraftInput {
  artifactId?: string | null;
  name: string;
  description?: string | null;
  sourceKind: DataInputTableSourceKind;
  primaryLanguage: DataNormalizerLanguage;
  rulePrompt: string;
  files: DataNormalizerProjectFile[];
  fileTreeHash: string;
  sourceSummaryHash?: string | null;
  entrypoint: DataNormalizerEntrypoint;
  dependencyPrepare?: DataNormalizerDependencyPrepareConfig;
  runtime: DataNormalizerRuntime;
  dependencies?: DataNormalizerDependencySpec[];
  dependencyLockHash?: string | null;
}

export interface DataInputTableNormalizerVersionSaveResult {
  artifact: DataInputTableNormalizerArtifact;
  version: DataInputTableNormalizerArtifactVersion;
}

export interface DataPublishInputTableNormalizerVersionInput {
  versionId: string;
}

export interface DataDeleteInputTableNormalizerVersionInput {
  versionId: string;
}

export interface DataDeleteInputTableNormalizerVersionResult {
  success: boolean;
}

export interface DataListInputTableNormalizerVersionsInput {
  artifactId: string;
}

export interface DataListInputTableNormalizerVersionsResult {
  versions: DataInputTableNormalizerArtifactVersion[];
}

export interface DataGenerateInputTableNormalizerDraftInput {
  artifactId?: string | null;
  name: string;
  description?: string | null;
  sourcePath: string;
  sourceKind?: DataInputTableSourceKind;
  config?: DataInputTableConfig;
  rulePrompt: string;
  primaryLanguage?: DataNormalizerLanguage;
  progressId?: string;
}

export interface DataGenerateInputTableNormalizerDraftResult {
  artifact: DataInputTableNormalizerArtifact;
  version: DataInputTableNormalizerArtifactVersion;
  summary: DataInputTableSourceSummary;
}

export type DataInputTableNormalizerDraftProgressPhase =
  | 'source_summary'
  | 'source_analysis'
  | 'code_generation'
  | 'saving'
  | 'complete'
  | 'error';

export interface DataInputTableNormalizerDraftProgressEvent {
  progressId: string;
  phase: DataInputTableNormalizerDraftProgressPhase;
  kind: 'message' | 'delta';
  text: string;
}

export interface DataPreviewInputTableNormalizerVersionInput {
  versionId: string;
  sourcePath: string;
  sourceKind?: DataInputTableSourceKind;
  config?: DataInputTableConfig;
  prepareDependencies?: boolean;
  limit?: number;
  offset?: number;
}

export interface DataSummarizeInputTableSourceInput {
  sourcePath: string;
  sourceKind?: DataInputTableSourceKind;
  config?: DataInputTableConfig;
  maxFiles?: number;
  maxSheetsPerFile?: number;
  maxRowsPerSheet?: number;
  maxColumnsPerRow?: number;
}

export interface DataInputTableSourceSummary {
  sourcePath: string;
  sourceKind: DataInputTableSourceKind;
  generatedAt: number;
  hash: string;
  fileCount: number;
  sampledFileCount: number;
  truncated: boolean;
  notes: string[];
  files: DataInputTableSourceFileSummary[];
}

export interface DataInputTableSourceFileSummary {
  path: string;
  name: string;
  relativePath: string;
  extension: string;
  kind: 'excel' | 'csv' | 'other';
  sizeBytes: number;
  modifiedAt: number;
  sheets?: DataInputTableExcelSheetSummary[];
  sampleRows?: string[][];
  delimiter?: string;
  warning?: string;
}

export interface DataInputTableExcelSheetSummary {
  name: string;
  range: string | null;
  mergeCount: number;
  mergedCells?: DataInputTableExcelMergedCellSummary[];
  rowCountEstimate: number;
  columnCountEstimate: number;
  headerCandidates: DataInputTableHeaderCandidate[];
  sampleRows: string[][];
}

export interface DataInputTableExcelMergedCellSummary {
  range: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  value: string;
}

export interface DataInputTableHeaderCandidate {
  rowNumber: number;
  nonEmptyCellCount: number;
  values: string[];
}

export interface DataInputTableCustomizeProcessingConfig {
  strategy: 'customize';
  rulePrompt: string;
  artifactId?: string;
  artifactVersionId?: string;
  artifactVersionStatus?: 'draft' | 'published' | 'archived';
  fileTreeHash?: string;
  dependencyLockHash?: string;
  runtime?: DataNormalizerRuntime;
  entrypoint?: DataNormalizerEntrypoint;
  dependencyPrepare?: DataNormalizerDependencyPrepareConfig;
  projectFiles?: DataNormalizerProjectFile[];
  sourceSummaryHash?: string;
}

export type DataInputTableProcessingConfig =
  | DataInputTableAutoProcessingConfig
  | DataInputTableCustomizeProcessingConfig;

export interface DataInputTableProcessingFields {
  dataProcessing: DataInputTableProcessingConfig;
}

export interface DataInputTableExcelConfig {
  sourceKind: 'excel';
  sheetName: string | null;
  sheetNames: string[];
  headerMode: 'auto' | 'manual';
  headerRow: number;
  dataProcessing?: DataInputTableProcessingConfig;
}

export interface DataInputTableCsvConfig {
  sourceKind: 'csv';
  header: 'auto';
  dataRegion: 'auto';
  encoding: 'auto';
  delimiter: 'auto';
  dataProcessing?: DataInputTableProcessingConfig;
}

export interface DataInputTableFolderConfig {
  sourceKind: 'folder';
  mergeMode: 'append_same_schema';
  schemaStrategy: 'align_by_name';
  fileRange: 'excel_csv' | 'excel' | 'csv';
  skipEmptyFiles: boolean;
  keepSourceFileName: boolean;
  dataProcessing?: DataInputTableProcessingConfig;
}

export type DataInputTableConfig =
  | DataInputTableExcelConfig
  | DataInputTableCsvConfig
  | DataInputTableFolderConfig;

export interface DataDataset {
  id: string;
  name: string;
  sourcePath: string;
  sourceKind: DataInputTableSourceKind;
  inputConfig: DataInputTableConfig;
  fileCount: number;
  relatedTaskNames: string[];
  tableName: string;
  rowCount: number;
  columnCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface DataOutputTable {
  id: string;
  name: string;
  sourceDatasetId: string | null;
  tableName: string;
  rowCount: number;
  columnCount: number;
  relatedTaskNames: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DataDashboardSummary {
  taskCount: number;
  workflowNodeCount: number;
  runningCount: number;
  todayScheduleCount: number;
  statusCounts: DataTaskStatusCounts;
}

export interface DataDashboard {
  summary: DataDashboardSummary;
  tasks: DataCleaningTask[];
  datasets: DataDataset[];
  outputTables: DataOutputTable[];
  totalTasks: number;
  totalDatasets: number;
  totalOutputTables: number;
}

export interface DataDashboardQuery {
  query?: string;
  includeSummary?: boolean;
  includeTasks?: boolean;
  includeDatasets?: boolean;
  includeOutputTables?: boolean;
  taskOffset?: number;
  taskLimit?: number;
  datasetOffset?: number;
  datasetLimit?: number;
  outputOffset?: number;
  outputLimit?: number;
  datasetSourceKind?: DataInputTableSourceKind | 'all';
}

export interface DataCreateTaskInput {
  name: string;
  sourcePath?: string | null;
  sourceDatasetId?: string | null;
  outputTableId?: string | null;
}

export interface DataUpdateTaskInput {
  id: string;
  name?: string;
}

export interface DataRunTaskInput {
  sourcePath?: string | null;
  workflow?: DataWorkflowSaveInput | null;
  outputMode?: 'persisted' | 'temporary';
}

export interface DataImportDatasetInput {
  filePath: string;
  name?: string;
  sourceKind?: DataInputTableSourceKind;
  config?: DataInputTableConfig;
}

export interface DataUpdateDatasetInput {
  id: string;
  filePath?: string;
  name?: string;
  sourceKind?: DataInputTableSourceKind;
  config?: DataInputTableConfig;
}

export interface DataCreateOutputTableInput {
  name?: string;
}

export interface DataUpdateOutputTableInput {
  id: string;
  name?: string;
  sourceDatasetId?: string | null;
}

export interface DataPreviewInputTableInput {
  filePath: string;
  sourceKind: DataInputTableSourceKind;
  config: DataInputTableConfig;
  limit?: number;
  offset?: number;
}

export interface DataPreviewDatasetInput {
  id: string;
  limit?: number;
  offset?: number;
}

export interface DataPreviewWorkflowNodeInput {
  taskId: string;
  nodeId: string;
  nodeType: DataWorkflowOperatorType;
  nodeConfig?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface DataInputTablePreview {
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  fileCount: number;
  limit: number;
  offset: number;
  totalRows: number;
}

export interface DataInputTableSourceSelection {
  path: string;
  kind: DataInputTableSourceKind;
}

export type DataWorkflowOperatorType =
  | 'input_source'
  | 'filter'
  | 'field_select'
  | 'deduplicate'
  | 'missing_value'
  | 'type_convert'
  | 'sort'
  | 'join'
  | 'aggregate'
  | 'calculate_field'
  | 'field_mapping'
  | 'limit'
  | 'pivot'
  | 'unpivot'
  | 'set_op'
  | 'unnest'
  | 'output';

export interface DataWorkflowNode {
  id: string;
  taskId: string;
  type: DataWorkflowOperatorType;
  label: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface DataWorkflowEdge {
  id: string;
  taskId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  createdAt: number;
}

export interface DataTaskWorkflow {
  task: DataCleaningTask;
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
}

export interface DataWorkflowNodeInput {
  id: string;
  type: DataWorkflowOperatorType;
  label: string;
  x: number;
  y: number;
  config?: Record<string, unknown>;
}

export interface DataWorkflowEdgeInput {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface DataWorkflowSaveInput {
  nodes: DataWorkflowNodeInput[];
  edges: DataWorkflowEdgeInput[];
}

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'
  | 'unsupported';

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  availableVersion?: string | null;
  percent?: number | null;
  transferred?: number | null;
  total?: number | null;
  bytesPerSecond?: number | null;
  error?: string | null;
  checkedAt?: number | null;
}

// Skills types
export interface Skill {
  id: string;
  name: string;
  description?: string;
  type: SkillType;
  enabled: boolean;
  config?: Record<string, unknown>;
  createdAt: number;
}

export type SkillType = 'builtin' | 'mcp' | 'custom';

export type PluginComponentKind = 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp';

export interface PluginComponentCounts {
  skills: number;
  commands: number;
  agents: number;
  hooks: number;
  mcp: number;
}

export interface PluginComponentEnabledState {
  skills: boolean;
  commands: boolean;
  agents: boolean;
  hooks: boolean;
  mcp: boolean;
}

export interface PluginCatalogItemV2 {
  name: string;
  description?: string;
  version?: string;
  authorName?: string;
  installable: boolean;
  hasManifest: boolean;
  componentCounts: PluginComponentCounts;
  pluginId?: string;
  installCommand?: string;
  detailUrl?: string;
  catalogSource?: 'claude-marketplace';
}

export interface PluginCatalogItem extends PluginCatalogItemV2 {
  skillCount: number;
  hasSkills: boolean;
}

export interface InstalledPlugin {
  pluginId: string;
  name: string;
  description?: string;
  version?: string;
  authorName?: string;
  enabled: boolean;
  sourcePath: string;
  runtimePath: string;
  componentCounts: PluginComponentCounts;
  componentsEnabled: PluginComponentEnabledState;
  installedAt: number;
  updatedAt: number;
}

export interface PluginInstallResultV2 {
  plugin: InstalledPlugin;
  installedSkills: string[];
  warnings: string[];
}

export interface PluginToggleResult {
  success: boolean;
  plugin: InstalledPlugin;
}

export interface PluginInstallResult {
  pluginName: string;
  installedSkills: string[];
  skippedSkills: string[];
  errors: string[];
}

export interface SkillsStorageChangeEvent {
  path: string;
  reason: 'updated' | 'path_changed' | 'fallback' | 'watcher_error';
  message?: string;
}

// Memory types
export interface MemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  metadata: MemoryMetadata;
  createdAt: number;
}

export interface MemoryMetadata {
  source: string;
  timestamp: number;
  tags: string[];
}

export type MemorySearchScope = 'workspace' | 'global' | 'all';
export type MemorySearchKind = 'core' | 'experience_session' | 'experience_chunk' | 'raw_session';

export interface MemoryTranscriptTurn {
  role: string;
  content: string;
  messageId?: string;
  timestamp?: number;
}

export interface ChunkMemoryItem {
  id: string;
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceWorkspaceLabel?: string;
  sourceSessionId: string;
  sourceSessionTitle?: string;
  sourceSessionDate?: string;
  summary: string;
  details: string;
  keywords: string[];
  sourceTurns: number[];
  rawText: string;
  sessionDate: string;
  createdAt: string;
  ingestedAt: string;
  embedding: number[];
}

export interface SessionMemoryItem {
  id: string;
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceWorkspaceLabel?: string;
  sourceSessionId: string;
  sourceSessionTitle?: string;
  sourceSessionDate?: string;
  summary: string;
  keywords: string[];
  chunkIds: string[];
  rawSession: MemoryTranscriptTurn[];
  sessionDate: string;
  createdAt: string;
  ingestedAt: string;
  embedding: number[];
}

export interface MemoryDebugFileInfo {
  kind: 'core' | 'experience' | 'state' | 'artifacts';
  label: string;
  filePath: string;
  exists: boolean;
  sizeBytes: number;
  updatedAt: number | null;
  sessionCount?: number;
  chunkCount?: number;
}

export interface MemoryDebugFileContent {
  kind: MemoryDebugFileInfo['kind'];
  filePath: string;
  text: string;
  parsed: unknown | null;
  sizeBytes: number;
  updatedAt: number | null;
}

export interface MemoryInspectSessionResult {
  sourceWorkspace?: string | null;
  filePath: string;
  session: SessionMemoryItem;
  chunks: ChunkMemoryItem[];
}

export interface MemoryOverview {
  enabled: boolean;
  storageRoot: string;
  coreFilePath: string;
  experienceFilePath: string;
  stateFilePath: string;
  coreCount: number;
  experienceSessionCount: number;
  experienceChunkCount: number;
  sourceWorkspaceCount: number;
  failedSessionCount: number;
  latestIngestionAt: number | null;
  latestError: string | null;
  currentWorkspace?: {
    workspaceKey: string;
    experienceSessionCount: number;
    experienceChunkCount: number;
  };
  topSourceWorkspaces: Array<{
    workspaceKey: string;
    sessionCount: number;
    chunkCount: number;
  }>;
}

export interface MemorySearchResult {
  id: string;
  recordId: string;
  kind: MemorySearchKind;
  title: string;
  summary: string;
  contentPreview: string;
  workspaceKey?: string;
  sourceWorkspace?: string | null;
  sourceWorkspaceLabel?: string;
  sourceSessionId?: string;
  sourceSessionTitle?: string;
  sessionId?: string;
  sessionTitle?: string;
  category?: 'identity' | 'preferences' | 'skills' | 'interests';
  score: number;
  createdAt: number;
  updatedAt?: number;
  keywords?: string[];
  sourceFile?: string;
}

export interface MemoryReadResult extends MemorySearchResult {
  rawText?: string;
  details?: string;
  rawSession?: MemoryTranscriptTurn[];
  sourceTurns?: number[];
  chunkIds?: string[];
  sourceExcerpt?: string;
}

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

// IPC Event types
export type ClientEvent =
  | {
      type: 'session.start';
      payload: {
        title: string;
        prompt: string;
        cwd?: string;
        allowedTools?: string[];
        permissionRules?: PermissionRule[];
        content?: ContentBlock[];
        memoryEnabled?: boolean;
      };
    }
  | {
      type: 'session.continue';
      payload: {
        sessionId: string;
        prompt: string;
        permissionRules?: PermissionRule[];
        content?: ContentBlock[];
      };
    }
  | { type: 'session.stop'; payload: { sessionId: string } }
  | { type: 'session.delete'; payload: { sessionId: string } }
  | { type: 'session.batchDelete'; payload: { sessionIds: string[] } }
  | { type: 'session.list'; payload: Record<string, never> }
  | { type: 'session.getMessages'; payload: { sessionId: string } }
  | { type: 'session.getTraceSteps'; payload: { sessionId: string } }
  | { type: 'permission.response'; payload: { toolUseId: string; result: PermissionResult } }
  | { type: 'sudo.password.response'; payload: { toolUseId: string; password: string | null } }
  | { type: 'settings.update'; payload: Record<string, unknown> }
  | { type: 'folder.select'; payload: Record<string, never> }
  | { type: 'workdir.get'; payload: Record<string, never> }
  | { type: 'workdir.set'; payload: { path: string; sessionId?: string } }
  | { type: 'workdir.select'; payload: { sessionId?: string; currentPath?: string } };

// Sandbox setup types (app startup)
export type SandboxSetupPhase = 
  | 'checking'      // Checking WSL/Lima availability
  | 'creating'      // Creating Lima instance (macOS only)
  | 'starting'      // Starting Lima instance (macOS only)  
  | 'installing_node' // Installing Node.js
  | 'installing_python' // Installing Python
  | 'installing_pip'    // Installing pip
  | 'installing_deps'   // Installing skill dependencies (markitdown, pypdf, etc.)
  | 'ready'         // Ready to use
  | 'skipped'       // No sandbox needed (native mode)
  | 'error';        // Setup failed

export interface SandboxSetupProgress {
  phase: SandboxSetupPhase;
  message: string;
  detail?: string;
  progress?: number; // 0-100
  error?: string;
}

// Sandbox sync types (per-session file sync)
export type SandboxSyncPhase =
  | 'starting_agent'  // Starting WSL/Lima agent
  | 'syncing_files'   // Syncing files to sandbox
  | 'syncing_skills' // Copying skills
  | 'ready'           // Sync complete
  | 'error';          // Sync failed

export interface SandboxSyncStatus {
  sessionId: string;
  phase: SandboxSyncPhase;
  message: string;
  detail?: string;
  fileCount?: number;
  totalSize?: number;
}

export type ServerEvent =
  | { type: 'stream.message'; payload: { sessionId: string; message: Message } }
  | { type: 'stream.partial'; payload: { sessionId: string; delta: string } }
  | { type: 'stream.thinking'; payload: { sessionId: string; delta: string } }
  | { type: 'stream.executionTime'; payload: { sessionId: string; messageId: string; executionTimeMs: number } }
  | { type: 'session.status'; payload: { sessionId: string; status: SessionStatus; error?: string } }
  | { type: 'session.update'; payload: { sessionId: string; updates: Partial<Session> } }
  | { type: 'session.list'; payload: { sessions: Session[] } }
  | { type: 'permission.request'; payload: PermissionRequest }
  | { type: 'permission.dismiss'; payload: { toolUseId: string } }
  | { type: 'sudo.password.request'; payload: SudoPasswordRequest }
  | { type: 'sudo.password.dismiss'; payload: { toolUseId: string } }
  | { type: 'trace.step'; payload: { sessionId: string; step: TraceStep } }
  | { type: 'trace.update'; payload: { sessionId: string; stepId: string; updates: Partial<TraceStep> } }
  | { type: 'folder.selected'; payload: { path: string } }
  | { type: 'config.status'; payload: { isConfigured: boolean; config: AppConfig } }
  | { type: 'sandbox.progress'; payload: SandboxSetupProgress }
  | { type: 'sandbox.sync'; payload: SandboxSyncStatus }
  | { type: 'skills.storageChanged'; payload: SkillsStorageChangeEvent }
  | { type: 'plugins.runtimeApplied'; payload: { sessionId: string; plugins: Array<{ name: string; path: string }> } }
  | { type: 'workdir.changed'; payload: { path: string } }
  | { type: 'session.contextInfo'; payload: { sessionId: string; contextWindow: number } }
  | { type: 'navigate.to'; payload: { page: 'welcome' | 'settings' | 'session'; tab?: string; sessionId?: string } }
  | { type: 'native-theme.changed'; payload: { shouldUseDarkColors: boolean } }
  | { type: 'new-session' }
  | { type: 'navigate'; payload: string }
  | { type: 'scheduled-task.error'; payload: { taskId: string; error: string } }
  | { type: 'error'; payload: { message: string; code?: 'CONFIG_REQUIRED_ACTIVE_SET'; action?: 'open_api_settings' } };

// Settings types
export interface Settings {
  theme: AppTheme;
  apiKey?: string;
  defaultTools: string[];
  permissionPolicy: PermissionPolicyId;
  permissionRules: PermissionRule[];
  globalSkillsPath: string;
  memoryStrategy: 'auto' | 'manual' | 'rolling';
  maxContextTokens: number;
}

// Tool types
export type ToolName = 'read' | 'write' | 'edit' | 'glob' | 'grep' | 'bash' | 'webFetch' | 'webSearch';

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

// App Config types
export type ProviderType =
  | 'openrouter'
  | 'anthropic'
  | 'custom'
  | 'openai'
  | 'deepseek'
  | 'moonshot'
  | 'zai'
  | 'gemini'
  | 'ollama';
export type CustomProtocolType = 'anthropic' | 'openai' | 'gemini';
export type AppTheme = 'dark' | 'light' | 'system';
export type ProviderProfileKey =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'moonshot'
  | 'zai'
  | 'gemini'
  | 'ollama'
  | 'custom:anthropic'
  | 'custom:openai'
  | 'custom:gemini';
export type ConfigSetId = string;

export interface ProviderProfile {
  apiKey: string;
  baseUrl?: string;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ApiConfigSet {
  id: ConfigSetId;
  name: string;
  isSystem?: boolean;
  provider: ProviderType;
  customProtocol: CustomProtocolType;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  enableThinking: boolean;
  updatedAt: string;
}

export interface CreateSetPayload {
  name: string;
  mode: 'blank' | 'clone';
  fromSetId?: string;
}

export interface MemoryModelRuntimeConfig {
  inheritFromActive: boolean;
  provider?: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs: number;
}

export interface MemoryRuntimeConfig {
  llm: MemoryModelRuntimeConfig;
  embedding: MemoryModelRuntimeConfig;
  useEmbedding: boolean;
  maxNavSteps: number;
  ingestionConcurrency: number;
  storageRoot?: string;
  evalEnabled?: boolean;
  evalWorkspaces?: string[];
  evalMaxRounds?: number;
  evalArtifactsRoot?: string;
  promptIterationRounds?: number;
}

export interface AppConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl?: string;
  customProtocol?: CustomProtocolType;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  activeConfigSetId: ConfigSetId;
  configSets: ApiConfigSet[];
  claudeCodePath?: string;
  defaultWorkdir?: string;
  globalSkillsPath?: string;
  theme?: AppTheme;
  sandboxEnabled?: boolean;
  memoryEnabled?: boolean;
  memoryRuntime?: MemoryRuntimeConfig;
  enableThinking?: boolean;
  isConfigured: boolean;
}

export interface ProviderPreset {
  name: string;
  baseUrl: string;
  models: { id: string; name: string }[];
  keyPlaceholder: string;
  keyHint: string;
}

export interface ProviderPresets {
  openrouter: ProviderPreset;
  anthropic: ProviderPreset;
  custom: ProviderPreset;
  openai: ProviderPreset;
  deepseek: ProviderPreset;
  moonshot: ProviderPreset;
  zai: ProviderPreset;
  gemini: ProviderPreset;
  ollama: ProviderPreset;
}

export interface ProviderModelInfo {
  id: string;
  name: string;
}

export interface ApiTestInput {
  provider: AppConfig['provider'];
  apiKey: string;
  baseUrl?: string;
  customProtocol?: AppConfig['customProtocol'];
  model?: string;
  useLiveRequest?: boolean;
  verificationLevel?: DiagnosticVerificationLevel;
}

export interface ApiTestResult {
  ok: boolean;
  latencyMs?: number;
  status?: number;
  errorType?:
    | 'missing_key'
    | 'missing_base_url'
    | 'unauthorized'
    | 'not_found'
    | 'rate_limited'
    | 'server_error'
    | 'network_error'
    | 'ollama_not_running'
    | 'ollama_loading'
    | 'unknown';
  details?: string;
}

// API Diagnostics types
export type DiagnosticStepName = 'dns' | 'tcp' | 'tls' | 'auth' | 'model';
export type DiagnosticStepStatus = 'pending' | 'running' | 'ok' | 'fail' | 'skip';
export type DiagnosticVerificationLevel = 'fast' | 'deep';
export type DiagnosticAdvisoryCode = 'not_deep_verified' | 'model_loading' | 'manual_model';

export interface DiagnosticStep {
  name: DiagnosticStepName;
  status: DiagnosticStepStatus;
  latencyMs?: number;
  error?: string;
  fix?: string;
}

export interface DiagnosticResult {
  steps: DiagnosticStep[];
  overallOk: boolean;
  /** Which step failed first (null if all ok) */
  failedAt?: DiagnosticStepName;
  totalLatencyMs: number;
  verificationLevel?: DiagnosticVerificationLevel;
  advisoryCode?: DiagnosticAdvisoryCode;
  advisoryText?: string;
  /** Present when the run was skipped (e.g. 'concurrent_run') */
  skippedReason?: string;
}

export interface DiagnosticInput {
  provider: AppConfig['provider'];
  apiKey: string;
  baseUrl?: string;
  customProtocol?: AppConfig['customProtocol'];
  model?: string;
  verificationLevel?: DiagnosticVerificationLevel;
}

export interface LocalServiceInfo {
  type: 'ollama';
  baseUrl: string;
  models?: string[];
}

export type LocalOllamaDiscoveryStatus =
  | 'unavailable'
  | 'service_available'
  | 'models_available';

export interface LocalOllamaDiscoveryResult {
  available: boolean;
  baseUrl: string;
  models?: string[];
  status: LocalOllamaDiscoveryStatus;
}

// MCP types
export interface MCPServerInfo {
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
  tools?: MCPToolInfo[];
}

export interface MCPToolInfo {
  name: string;
  description: string;
  serverId: string;
  serverName: string;
}

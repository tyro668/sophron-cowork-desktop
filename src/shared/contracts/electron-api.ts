import type { AutomationTableRef, AutomationTablePolicy } from '../automation/types';
import type { RemoteQrSetupState, RemoteQrChannel } from './remote/qr-setup';
/**
 * @module shared/contracts/electron-api
 *
 * Canonical type contract for the `window.electronAPI` bridge surface that the
 * preload script exposes to the renderer. Both the preload implementation
 * (`satisfies ElectronApi`) and the global Window declaration in
 * `src/preload/electron-api.d.ts` derive from this single definition.
 */
import type {
  ClientEvent,
  ServerEvent,
  AppConfig,
  AppConfigUpdate,
  CreateSetPayload,
  ProviderPresets,
  Skill,
  ApiTestInput,
  ApiTestResult,
  PluginCatalogItemV2,
  InstalledPlugin,
  PluginInstallResultV2,
  PluginToggleResult,
  PluginComponentKind,
  ScheduleTask,
  ScheduleCreateInput,
  ScheduleUpdateInput,
  ProviderModelInfo,
  PersonalAnalysisDatasource,
  LocalOllamaDiscoveryResult,
  MemoryOverview,
  MemorySearchResult,
  MemoryReadResult,
  MemorySearchScope,
  MemoryItemStatus,
  CoreMemoryEntry,
  ProjectMemoryEntry,
  MemoryDebugFileInfo,
  MemoryDebugFileContent,
  MemoryInjectionRecord,
  MemoryInspectSessionResult,
  MemoryRebuildResult,
  DataPipeline,
  DataColumnTypeInfo,
  DataCreateResultTableInput,
  DataCreatePipelineInput,
  DataDashboard,
  DataDashboardQuery,
  DataRawTable,
  DataDeleteRawTableNormalizerVersionInput,
  DataDeleteRawTableNormalizerVersionResult,
  DataGenerateRawTableNormalizerDraftInput,
  DataGenerateRawTableNormalizerDraftResult,
  DataRawTableNormalizerDraftProgressEvent,
  DataRawTablePreview,
  DataRawTableSourceSummary,
  DataRawTableSourceKind,
  DataRawTableSourceSelection,
  DataImportRawTableInput,
  DataRawTableNormalizerVersionSaveResult,
  DataListRawTableNormalizerVersionsInput,
  DataListRawTableNormalizerVersionsResult,
  DataExportTableInput,
  DataExportTableResult,
  DataPreviewRawTableSourceInput,
  DataPreviewRawTableInput,
  DataPreviewRawTableNormalizerVersionInput,
  DataPreviewWorkflowNodeInput,
  DataPublishRawTableNormalizerVersionInput,
  DataRunPipelineInput,
  DataSummarizeRawTableSourceInput,
  DataPipelineWorkflow,
  DataUpdateRawTableInput,
  DataUpdateResultTableInput,
  DataUpdatePipelineInput,
  DataGroup,
  DataGroupScope,
  DataCreateGroupInput,
  DataRenameGroupInput,
  DataAssignGroupInput,
  DataWorkflowSaveInput,
  DataResultTable,
  AppUpdateState,
  Automation,
  AutomationActionDefinitionSummary,
  AutomationArtifact,
  AutomationAssignGroupInput,
  AutomationCreateGroupInput,
  AutomationCreateInput,
  AutomationGroup,
  AutomationListQuery,
  AutomationListResult,
  AutomationRenameGroupInput,
  AutomationRun,
  AutomationRunQuery,
  AutomationUpdateInput,
  DesktopAuthStatus,
  ImportCloudTableInput,
  ImportCloudTableResult,
  ListCloudDriveFilesInput,
  ListCloudDriveFilesResult,
  ListCloudProjectsInput,
  ListCloudProjectsResult,
  ListCloudSpacesInput,
  ListCloudSpacesResult,
  ListCloudTablesInput,
  ListCloudTablesResult,
  PreviewCloudDriveFileInput,
  PreviewCloudDriveFileResult,
  PreviewCloudTableInput,
  PreviewCloudTableResult,
  RefreshCloudRawTableInput,
  RefreshCloudRawTableResult,
  SearchCloudTablesInput,
  SearchCloudTablesResult,
  UploadDataTableToCloudInput,
  UploadDataTableToCloudResult,
  CodexAuthStatus,
  CodexAuthActionResult,
  CodexLoginPromptPayload,
  DiagnosticInput,
  DiagnosticResult,
  RunPipelineResult,
  WorkflowNodeRunStat,
  DataPipelineRun,
  McpServerConfig,
  McpTool,
  McpServerStatus,
  McpPresetsMap,
  RemoteConfig,
  GatewayConfig,
  FeishuChannelConfig,
  DingtalkChannelConfig,
  WecomChannelConfig,
  ChannelType,
  ControllableChannelType,
  RemoteChannelToggleResult,
  PairedUser,
  PairingRequest,
  RemoteSessionMapping,
} from './index';
import type { WorkflowPlanDiagnostic } from '../workflow-plan';

export interface ElectronApi {
  send: (event: ClientEvent) => void;
  on: (callback: (event: ServerEvent) => void) => () => void;
  invoke: <T>(event: ClientEvent) => Promise<T>;
  platform: NodeJS.Platform;
  getSystemTheme: () => Promise<{ shouldUseDarkColors: boolean }>;
  getVersion: () => Promise<string>;
  update: {
    getState: () => Promise<AppUpdateState | null>;
    checkAndInstall: () => Promise<AppUpdateState>;
    onState: (callback: (state: AppUpdateState) => void) => () => void;
  };
  auth: {
    getStatus: () => Promise<DesktopAuthStatus>;
    login: () => Promise<DesktopAuthStatus>;
    cancelLogin: () => Promise<DesktopAuthStatus>;
    logout: () => Promise<DesktopAuthStatus>;
  };
  openExternal: (url: string) => Promise<boolean>;
  showItemInFolder: (filePath: string, cwd?: string) => Promise<boolean>;
  /** Open a local file or folder with the system default application. */
  openPath: (filePath: string, cwd?: string) => Promise<boolean>;
  openGeneratedReport: (filePath: string, cwd?: string) => Promise<boolean>;
  selectFiles: () => Promise<string[]>;
  selectRawTableSource: (
    kind?: DataRawTableSourceKind
  ) => Promise<DataRawTableSourceSelection | null>;
  artifacts: {
    listRecentFiles: (
      cwd: string,
      sinceMs: number,
      limit?: number
    ) => Promise<Array<{ path: string; modifiedAt: number; size: number }>>;
  };
  data: {
    getDashboard: (payload?: DataDashboardQuery) => Promise<DataDashboard>;
    getPipeline: (id: string) => Promise<DataPipeline | null>;
    createPipeline: (payload: DataCreatePipelineInput) => Promise<DataPipeline>;
    updatePipeline: (payload: DataUpdatePipelineInput) => Promise<DataPipeline>;
    listGroups: (scope: DataGroupScope) => Promise<DataGroup[]>;
    createGroup: (payload: DataCreateGroupInput) => Promise<DataGroup>;
    renameGroup: (payload: DataRenameGroupInput) => Promise<{ success: boolean }>;
    deleteGroup: (id: string) => Promise<{ success: boolean }>;
    assignGroup: (payload: DataAssignGroupInput) => Promise<{ success: boolean }>;
    runPipeline: (id: string, payload?: DataRunPipelineInput) => Promise<DataPipeline>;
    runPipelineWithDiagnostics: (
      id: string,
      payload?: DataRunPipelineInput
    ) => Promise<RunPipelineResult>;
    getPipelineWorkflow: (id: string) => Promise<DataPipelineWorkflow>;
    getPipelineNodeStats: (id: string) => Promise<WorkflowNodeRunStat[]>;
    listPipelineRuns: (id: string, limit?: number) => Promise<DataPipelineRun[]>;
    getPipelineRunNodeStats: (id: string, runId: string) => Promise<WorkflowNodeRunStat[]>;
    savePipelineWorkflow: (
      id: string,
      payload: DataWorkflowSaveInput
    ) => Promise<DataPipelineWorkflow>;
    validatePipelineWorkflowPlan: (
      id: string,
      payload: DataWorkflowSaveInput
    ) => Promise<WorkflowPlanDiagnostic[]>;
    importRawTable: (payload: DataImportRawTableInput) => Promise<DataRawTable>;
    getRawTable: (id: string) => Promise<DataRawTable | null>;
    updateRawTable: (payload: DataUpdateRawTableInput) => Promise<DataRawTable>;
    getResultTable: (id: string) => Promise<DataResultTable | null>;
    createResultTable: (payload?: DataCreateResultTableInput) => Promise<DataResultTable>;
    updateResultTable: (payload: DataUpdateResultTableInput) => Promise<DataResultTable>;
    previewRawTableSource: (
      payload: DataPreviewRawTableSourceInput
    ) => Promise<DataRawTablePreview>;
    previewRawTable: (payload: DataPreviewRawTableInput) => Promise<DataRawTablePreview>;
    exportTable: (payload: DataExportTableInput) => Promise<DataExportTableResult>;
    previewWorkflowNode: (payload: DataPreviewWorkflowNodeInput) => Promise<DataRawTablePreview>;
    getWorkflowNodeColumns: (payload: DataPreviewWorkflowNodeInput) => Promise<string[]>;
    getWorkflowNodeColumnTypes: (
      payload: DataPreviewWorkflowNodeInput
    ) => Promise<DataColumnTypeInfo[]>;
    getWorkflowNodeColumnValues: (
      payload: DataPreviewWorkflowNodeInput & { column: string }
    ) => Promise<string[]>;
    summarizeRawTableSource: (
      payload: DataSummarizeRawTableSourceInput
    ) => Promise<DataRawTableSourceSummary>;
    generateRawTableNormalizerDraft: (
      payload: DataGenerateRawTableNormalizerDraftInput
    ) => Promise<DataGenerateRawTableNormalizerDraftResult>;
    onRawTableNormalizerDraftProgress: (
      callback: (event: DataRawTableNormalizerDraftProgressEvent) => void
    ) => () => void;
    previewRawTableNormalizerVersion: (
      payload: DataPreviewRawTableNormalizerVersionInput
    ) => Promise<{ preview: DataRawTablePreview }>;
    publishRawTableNormalizerVersion: (
      payload: DataPublishRawTableNormalizerVersionInput
    ) => Promise<DataRawTableNormalizerVersionSaveResult>;
    deleteRawTableNormalizerVersion: (
      payload: DataDeleteRawTableNormalizerVersionInput
    ) => Promise<DataDeleteRawTableNormalizerVersionResult>;
    listRawTableNormalizerVersions: (
      payload: DataListRawTableNormalizerVersionsInput
    ) => Promise<DataListRawTableNormalizerVersionsResult>;
    deletePipeline: (id: string) => Promise<{ success: boolean }>;
    deleteRawTable: (id: string) => Promise<{ success: boolean }>;
    listCloudSpaces: (payload?: ListCloudSpacesInput) => Promise<ListCloudSpacesResult>;
    listCloudProjects: (payload: ListCloudProjectsInput) => Promise<ListCloudProjectsResult>;
    listCloudTables: (payload: ListCloudTablesInput) => Promise<ListCloudTablesResult>;
    searchCloudTables: (payload: SearchCloudTablesInput) => Promise<SearchCloudTablesResult>;
    previewCloudTable: (payload: PreviewCloudTableInput) => Promise<PreviewCloudTableResult>;
    importCloudRawTable: (payload: ImportCloudTableInput) => Promise<ImportCloudTableResult>;
    refreshCloudRawTable: (
      payload: RefreshCloudRawTableInput
    ) => Promise<RefreshCloudRawTableResult>;
    uploadDataTableToCloud: (
      payload: UploadDataTableToCloudInput
    ) => Promise<UploadDataTableToCloudResult>;
    listCloudDriveFiles: (payload: ListCloudDriveFilesInput) => Promise<ListCloudDriveFilesResult>;
    previewCloudDriveFile: (
      payload: PreviewCloudDriveFileInput
    ) => Promise<PreviewCloudDriveFileResult>;
  };
  config: {
    get: () => Promise<AppConfig>;
    getPresets: () => Promise<ProviderPresets>;
    save: (config: AppConfigUpdate) => Promise<{ success: boolean; config: AppConfig }>;
    createSet: (payload: CreateSetPayload) => Promise<{ success: boolean; config: AppConfig }>;
    renameSet: (payload: {
      id: string;
      name: string;
    }) => Promise<{ success: boolean; config: AppConfig }>;
    deleteSet: (payload: { id: string }) => Promise<{ success: boolean; config: AppConfig }>;
    switchSet: (payload: { id: string }) => Promise<{ success: boolean; config: AppConfig }>;
    updateSet: (payload: {
      id: string;
      updates: AppConfigUpdate;
    }) => Promise<{ success: boolean; config: AppConfig }>;
    selectBuiltinModel: (payload: {
      model: string;
    }) => Promise<{ success: boolean; config: AppConfig }>;
    isConfigured: () => Promise<boolean>;
    test: (config: ApiTestInput) => Promise<ApiTestResult>;
    listModels: (payload: {
      provider: AppConfig['provider'];
      apiKey: string;
      baseUrl?: string;
    }) => Promise<ProviderModelInfo[]>;
    diagnose: (input: DiagnosticInput) => Promise<DiagnosticResult>;
    discoverLocal: (payload?: { baseUrl?: string }) => Promise<LocalOllamaDiscoveryResult>;
    codexAuthStatus: () => Promise<CodexAuthStatus>;
    codexImportCli: () => Promise<CodexAuthActionResult>;
    codexLogin: () => Promise<CodexAuthActionResult>;
    codexSubmitLoginCode: (payload: {
      requestId: string;
      code: string;
    }) => Promise<{ success: boolean }>;
    codexLogout: () => Promise<CodexAuthActionResult>;
    onCodexLoginPrompt: (callback: (payload: CodexLoginPromptPayload) => void) => () => void;
    listPersonalAnalysisDatasources: (payload: {
      apiOrigin?: string;
      apiKey?: string;
      accessToken?: string;
    }) => Promise<PersonalAnalysisDatasource[]>;
  };
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
  mcp: {
    getServers: () => Promise<McpServerConfig[]>;
    getServer: (serverId: string) => Promise<McpServerConfig | undefined>;
    saveServer: (config: McpServerConfig) => Promise<{ success: boolean; error?: string }>;
    deleteServer: (serverId: string) => Promise<{ success: boolean }>;
    getTools: () => Promise<McpTool[]>;
    getServerStatus: () => Promise<McpServerStatus[]>;
    getPresets: () => Promise<McpPresetsMap>;
  };
  skills: {
    getAll: () => Promise<Skill[]>;
    getUsageCounts: (days?: number) => Promise<Record<string, number>>;
    install: (skillPath: string) => Promise<{ success: boolean; skill: Skill }>;
    installFromSkillHub: (slug: string) => Promise<{ success: boolean; skill: Skill }>;
    delete: (skillId: string) => Promise<{ success: boolean }>;
    setEnabled: (skillId: string, enabled: boolean) => Promise<{ success: boolean }>;
    validate: (skillPath: string) => Promise<{ valid: boolean; errors: string[] }>;
    getStoragePath: () => Promise<string>;
    setStoragePath: (
      targetPath: string,
      migrate?: boolean
    ) => Promise<{
      success: boolean;
      path: string;
      migratedCount: number;
      skippedCount: number;
      error?: string;
    }>;
    openStoragePath: () => Promise<{ success: boolean; path: string; error?: string }>;
    openSkillPath: (skillId: string) => Promise<{ success: boolean; path: string; error?: string }>;
  };
  plugins: {
    listCatalog: (options?: {
      installableOnly?: boolean;
      source?: 'skillhub' | 'claude-marketplace' | 'all';
      page?: number;
      pageSize?: number;
    }) => Promise<PluginCatalogItemV2[]>;
    listInstalled: () => Promise<InstalledPlugin[]>;
    install: (pluginName: string) => Promise<PluginInstallResultV2>;
    setEnabled: (pluginId: string, enabled: boolean) => Promise<PluginToggleResult>;
    setComponentEnabled: (
      pluginId: string,
      component: PluginComponentKind,
      enabled: boolean
    ) => Promise<PluginToggleResult>;
    uninstall: (pluginId: string) => Promise<{ success: boolean }>;
  };
  sandbox: {
    getStatus: () => Promise<{
      platform: string;
      mode: string;
      initialized: boolean;
      wsl?: {
        available: boolean;
        distro?: string;
        nodeAvailable?: boolean;
        version?: string;
        pythonAvailable?: boolean;
        pythonVersion?: string;
        pipAvailable?: boolean;
        claudeCodeAvailable?: boolean;
      };
      lima?: {
        available: boolean;
        instanceExists?: boolean;
        instanceRunning?: boolean;
        instanceName?: string;
        nodeAvailable?: boolean;
        version?: string;
        pythonAvailable?: boolean;
        pythonVersion?: string;
        pipAvailable?: boolean;
        claudeCodeAvailable?: boolean;
      };
      error?: string;
    }>;
    checkWSL: () => Promise<{
      available: boolean;
      distro?: string;
      nodeAvailable?: boolean;
      version?: string;
      pythonAvailable?: boolean;
      pythonVersion?: string;
      pipAvailable?: boolean;
      claudeCodeAvailable?: boolean;
    }>;
    checkLima: () => Promise<{
      available: boolean;
      instanceExists?: boolean;
      instanceRunning?: boolean;
      instanceName?: string;
      nodeAvailable?: boolean;
      version?: string;
      pythonAvailable?: boolean;
      pythonVersion?: string;
      pipAvailable?: boolean;
      claudeCodeAvailable?: boolean;
    }>;
    installNodeInWSL: (distro: string) => Promise<boolean>;
    installPythonInWSL: (distro: string) => Promise<boolean>;
    installNodeInLima: () => Promise<boolean>;
    installPythonInLima: () => Promise<boolean>;
    startLimaInstance: () => Promise<boolean>;
    stopLimaInstance: () => Promise<boolean>;
    retrySetup: () => Promise<{ success: boolean; error?: string; result?: unknown }>;
    retryLimaSetup: () => Promise<{ success: boolean; error?: string; result?: unknown }>;
  };
  logs: {
    getPath: () => Promise<string | null>;
    getDirectory: () => Promise<string>;
    getAll: () => Promise<Array<{ name: string; path: string; size: number; mtime: Date }>>;
    export: () => Promise<{ success: boolean; path?: string; size?: number; error?: string }>;
    open: () => Promise<{ success: boolean; error?: string }>;
    clear: () => Promise<{ success: boolean; deletedCount?: number; error?: string }>;
    setEnabled: (
      enabled: boolean
    ) => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
    isEnabled: () => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
    write: (
      level: 'info' | 'warn' | 'error',
      ...args: unknown[]
    ) => Promise<{ success: boolean; error?: string }>;
  };
  remote: {
    beginQrSetup: (id: string, channel: RemoteQrChannel) => Promise<RemoteQrSetupState>;
    getQrSetup: (id: string) => Promise<RemoteQrSetupState>;
    submitQrSetupCode: (id: string, code: string) => Promise<void>;
    cancelQrSetup: (id: string) => Promise<void>;
    getConfig: () => Promise<RemoteConfig>;
    getStatus: () => Promise<{
      running: boolean;
      port?: number;
      publicUrl?: string;
      channels: Array<{ type: string; enabled: boolean; connected: boolean; error?: string }>;
      activeSessions: number;
      pendingPairings: number;
    }>;
    setEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    setChannelEnabled: (
      type: ControllableChannelType,
      enabled: boolean
    ) => Promise<RemoteChannelToggleResult>;
    updateGatewayConfig: (
      config: Partial<GatewayConfig>
    ) => Promise<{ success: boolean; error?: string }>;
    updateFeishuConfig: (
      config: FeishuChannelConfig
    ) => Promise<{ success: boolean; error?: string }>;
    updateDingtalkConfig: (
      config: DingtalkChannelConfig,
      gatewayConfig?: Partial<GatewayConfig>
    ) => Promise<{ success: boolean; error?: string }>;
    updateWecomConfig: (
      config: WecomChannelConfig,
      gatewayConfig?: Partial<GatewayConfig>
    ) => Promise<{ success: boolean; error?: string }>;
    getPairedUsers: () => Promise<PairedUser[]>;
    getPendingPairings: () => Promise<PairingRequest[]>;
    approvePairing: (
      channelType: string,
      userId: string
    ) => Promise<{ success: boolean; error?: string }>;
    revokePairing: (
      channelType: string,
      userId: string
    ) => Promise<{ success: boolean; error?: string }>;
    rejectPairing: (
      channelType: string,
      userId: string
    ) => Promise<{ success: boolean; error?: string }>;
    getRemoteSessions: () => Promise<RemoteSessionMapping[]>;
    clearRemoteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
    getTunnelStatus: () => Promise<{
      connected: boolean;
      url: string | null;
      provider: string;
      error?: string;
    }>;
    getWebhookUrl: (channelType?: ChannelType) => Promise<string | null>;
    restart: () => Promise<{ success: boolean; error?: string }>;
  };
  schedule: {
    list: () => Promise<ScheduleTask[]>;
    create: (payload: ScheduleCreateInput) => Promise<ScheduleTask>;
    update: (id: string, updates: ScheduleUpdateInput) => Promise<ScheduleTask | null>;
    delete: (id: string) => Promise<{ success: boolean }>;
    toggle: (id: string, enabled: boolean) => Promise<ScheduleTask | null>;
    runNow: (id: string) => Promise<ScheduleTask | null>;
  };
  automation: {
    replaceTableAssociation: (
      table: AutomationTableRef,
      previousId: string,
      nextId: string
    ) => Promise<void>;
    getTablePolicy: (table: AutomationTableRef) => Promise<AutomationTablePolicy>;
    setTablePolicy: (
      table: AutomationTableRef,
      patch: Partial<AutomationTablePolicy>
    ) => Promise<AutomationTablePolicy>;
    list: (query?: AutomationListQuery) => Promise<AutomationListResult>;
    get: (id: string) => Promise<Automation | null>;
    create: (payload: AutomationCreateInput) => Promise<Automation>;
    update: (id: string, updates: AutomationUpdateInput) => Promise<Automation | null>;
    delete: (id: string) => Promise<{ success: boolean }>;
    setEnabled: (id: string, enabled: boolean) => Promise<Automation | null>;
    pause: (id: string) => Promise<Automation | null>;
    resume: (id: string) => Promise<Automation | null>;
    runNow: (id: string) => Promise<AutomationRun | null>;
    listRuns: (id: string, query?: AutomationRunQuery) => Promise<AutomationRun[]>;
    listArtifacts: (runId: string) => Promise<AutomationArtifact[]>;
    listActionDefinitions: () => Promise<AutomationActionDefinitionSummary[]>;
    groups: {
      list: () => Promise<AutomationGroup[]>;
      create: (payload: AutomationCreateGroupInput) => Promise<AutomationGroup>;
      rename: (payload: AutomationRenameGroupInput) => Promise<{ success: boolean }>;
      delete: (id: string) => Promise<{ success: boolean }>;
      assign: (payload: AutomationAssignGroupInput) => Promise<{ success: boolean }>;
    };
  };
  memory: {
    getOverview: (cwd?: string) => Promise<MemoryOverview>;
    search: (payload: {
      query: string;
      cwd?: string;
      sourceWorkspace?: string | null;
      scope?: MemorySearchScope;
      limit?: number;
    }) => Promise<MemorySearchResult[]>;
    read: (id: string) => Promise<MemoryReadResult | null>;
    listCoreEntries: () => Promise<CoreMemoryEntry[]>;
    updateCoreEntry: (
      combinedKey: string,
      updates: { key?: string; value?: string; confidence?: number; status?: MemoryItemStatus }
    ) => Promise<CoreMemoryEntry | null>;
    deleteCoreEntry: (combinedKey: string) => Promise<{ success: boolean }>;
    listProjectEntries: (workspaceKey?: string | null) => Promise<ProjectMemoryEntry[]>;
    updateProjectEntry: (
      id: string,
      updates: { key?: string; value?: string; confidence?: number; status?: MemoryItemStatus }
    ) => Promise<ProjectMemoryEntry | null>;
    deleteProjectEntry: (id: string) => Promise<{ success: boolean }>;
    rebuildWorkspace: (cwd: string) => Promise<MemoryRebuildResult & { workspaceKey: string }>;
    clearWorkspace: (cwd: string) => Promise<{ success: boolean; workspaceKey: string }>;
    clearCoreMemory: () => Promise<{ success: boolean }>;
    rebuildAll: () => Promise<MemoryRebuildResult & { workspaceCount: number }>;
    listFiles: () => Promise<MemoryDebugFileInfo[]>;
    readFile: (filePath: string) => Promise<MemoryDebugFileContent>;
    inspectSession: (
      sessionId: string,
      workspaceKey?: string
    ) => Promise<MemoryInspectSessionResult | null>;
    listInjections: (limit?: number) => Promise<MemoryInjectionRecord[]>;
    setEnabled: (enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>;
  };
}

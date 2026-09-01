import { contextBridge, ipcRenderer } from 'electron';
import type {
  ClientEvent,
  ServerEvent,
  AppConfig,
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
  MemoryInspectSessionResult,
  DataCleaningTask,
  DataColumnTypeInfo,
  DataCreateOutputTableInput,
  DataCreateTaskInput,
  DataDashboard,
  DataDashboardQuery,
  DataDataset,
  DataDeleteInputTableNormalizerVersionInput,
  DataDeleteInputTableNormalizerVersionResult,
  DataAnalyzeTaskRequirementResult,
  DataGenerateInputTableNormalizerDraftInput,
  DataGenerateInputTableNormalizerDraftResult,
  DataGenerateTaskFromRequirementInput,
  DataGenerateTaskFromRequirementResult,
  DataInputTableNormalizerDraftProgressEvent,
  DataInputTablePreview,
  DataInputTableSourceSummary,
  DataInputTableSourceKind,
  DataInputTableSourceSelection,
  DataImportDatasetInput,
  DataInputTableNormalizerVersionSaveResult,
  DataListInputTableNormalizerVersionsInput,
  DataListInputTableNormalizerVersionsResult,
  DataPreviewDatasetInput,
  DataPreviewInputTableInput,
  DataPreviewInputTableNormalizerVersionInput,
  DataPreviewWorkflowNodeInput,
  DataPublishInputTableNormalizerVersionInput,
  DataRunTaskInput,
  DataSummarizeInputTableSourceInput,
  DataTaskWorkflow,
  DataUpdateDatasetInput,
  DataUpdateOutputTableInput,
  DataUpdateTaskInput,
  DataWorkflowSaveInput,
  DataOutputTable,
  AppUpdateState,
  Automation,
  AutomationActionDefinitionSummary,
  AutomationArtifact,
  AutomationCreateInput,
  AutomationListQuery,
  AutomationRun,
  AutomationRunQuery,
  AutomationUpdateInput,
  DesktopAuthStatus,
  ImportCloudTableInput,
  ImportCloudTableResult,
  ListCloudProjectsInput,
  ListCloudProjectsResult,
  ListCloudSpacesInput,
  ListCloudSpacesResult,
  ListCloudTablesInput,
  ListCloudTablesResult,
  PreviewCloudTableInput,
  PreviewCloudTableResult,
  SearchCloudTablesInput,
  SearchCloudTablesResult,
  UploadDataTableToCloudInput,
  UploadDataTableToCloudResult,
} from '../renderer/types';
import type { DiagnosticInput, DiagnosticResult } from '../renderer/types';
import { isAllowedClientEventType } from '../shared/client-event-allowlist';
import type {
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
} from '../shared/ipc-types';

interface DataCommandIpcError {
  __dataCommandError: true;
  name?: string;
  message: string;
  code?: string;
  details?: unknown;
}

function isDataCommandIpcError(value: unknown): value is DataCommandIpcError {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { __dataCommandError?: unknown }).__dataCommandError === true &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

async function invokeDataCommand<T>(channel: string, payload?: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, payload);
  if (isDataCommandIpcError(result)) {
    throw Object.assign(new Error(result.message), {
      name: result.name || 'DataCommandError',
      code: result.code,
      details: result.details,
    });
  }
  return result as T;
}

// Track registered callbacks to prevent duplicate listeners
let registeredCallback: ((event: ServerEvent) => void) | null = null;
let ipcListener: ((event: Electron.IpcRendererEvent, data: ServerEvent) => void) | null = null;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Send events to main process
  send: (event: ClientEvent) => {
    if (!isAllowedClientEventType(event.type)) {
      console.warn('[Preload] Blocked unauthorized event type:', event.type);
      return;
    }
    console.log('[Preload] Sending event:', event.type);
    ipcRenderer.send('client-event', event);
  },

  // Receive events from main process - ensures only ONE listener
  on: (callback: (event: ServerEvent) => void) => {
    // Remove previous listener if exists
    if (ipcListener) {
      console.log('[Preload] Removing previous listener');
      ipcRenderer.removeListener('server-event', ipcListener);
    }

    registeredCallback = callback;
    ipcListener = (_: Electron.IpcRendererEvent, data: ServerEvent) => {
      console.log('[Preload] Received event:', data.type);
      if (registeredCallback) {
        registeredCallback(data);
      }
    };

    console.log('[Preload] Registering new listener');
    ipcRenderer.on('server-event', ipcListener);

    // Return cleanup function
    return () => {
      console.log('[Preload] Cleanup called');
      if (ipcListener) {
        ipcRenderer.removeListener('server-event', ipcListener);
        ipcListener = null;
        registeredCallback = null;
      }
    };
  },

  // Invoke and wait for response
  invoke: async <T>(event: ClientEvent): Promise<T> => {
    if (!isAllowedClientEventType(event.type)) {
      console.warn('[Preload] Blocked unauthorized invoke type:', event.type);
      throw new Error(`Unauthorized event type: ${event.type}`);
    }
    console.log('[Preload] Invoking:', event.type);
    return ipcRenderer.invoke('client-invoke', event);
  },

  // Platform info
  platform: process.platform,

  // System theme
  getSystemTheme: () => ipcRenderer.invoke('system.getTheme'),

  // App info
  getVersion: () => ipcRenderer.invoke('get-version'),

  update: {
    getState: (): Promise<AppUpdateState | null> => ipcRenderer.invoke('update.getState'),
    checkAndInstall: (): Promise<AppUpdateState> => ipcRenderer.invoke('update.checkAndInstall'),
    onState: (callback: (state: AppUpdateState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: AppUpdateState) =>
        callback(state);
      ipcRenderer.on('update.state', listener);
      return () => ipcRenderer.removeListener('update.state', listener);
    },
  },

  auth: {
    getStatus: (): Promise<DesktopAuthStatus> => ipcRenderer.invoke('auth.getStatus'),
    login: (): Promise<DesktopAuthStatus> => ipcRenderer.invoke('auth.login'),
    cancelLogin: (): Promise<DesktopAuthStatus> => ipcRenderer.invoke('auth.cancelLogin'),
    logout: (): Promise<DesktopAuthStatus> => ipcRenderer.invoke('auth.logout'),
  },

  // Open links in default browser
  openExternal: (url: string) => {
    // Sanitize mailto: URLs to strip dangerous query params that could attach files
    let safeUrl = url;
    if (/^mailto:/i.test(url)) {
      try {
        const parsed = new URL(url);
        parsed.searchParams.delete('attach');
        parsed.searchParams.delete('attachment');
        safeUrl = parsed.toString();
      } catch {
        // If URL parsing fails, block the call
        return Promise.resolve(false);
      }
    }
    return ipcRenderer.invoke('shell.openExternal', safeUrl);
  },
  showItemInFolder: (filePath: string, cwd?: string) =>
    ipcRenderer.invoke('shell.showItemInFolder', filePath, cwd),
  openGeneratedReport: (filePath: string, cwd?: string) =>
    ipcRenderer.invoke('reports.openGeneratedReport', filePath, cwd),

  // Select files using native dialog
  selectFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog.selectFiles'),
  selectInputTableSource: (
    kind?: DataInputTableSourceKind
  ): Promise<DataInputTableSourceSelection | null> =>
    ipcRenderer.invoke('dialog.selectInputTableSource', kind),

  artifacts: {
    listRecentFiles: (
      cwd: string,
      sinceMs: number,
      limit = 50
    ): Promise<Array<{ path: string; modifiedAt: number; size: number }>> =>
      ipcRenderer.invoke('artifacts.listRecentFiles', cwd, sinceMs, Math.min(limit, 500)),
  },

  data: {
    getDashboard: (payload?: DataDashboardQuery): Promise<DataDashboard> =>
      ipcRenderer.invoke('data.getDashboard', payload),
    getTask: (id: string): Promise<DataCleaningTask | null> =>
      ipcRenderer.invoke('data.getTask', id),
    createTask: (payload: DataCreateTaskInput): Promise<DataCleaningTask> =>
      ipcRenderer.invoke('data.createTask', payload),
    updateTask: (payload: DataUpdateTaskInput): Promise<DataCleaningTask> =>
      ipcRenderer.invoke('data.updateTask', payload),
    runTask: (id: string, payload?: DataRunTaskInput): Promise<DataCleaningTask> =>
      ipcRenderer.invoke('data.runTask', id, payload),
    getTaskWorkflow: (id: string): Promise<DataTaskWorkflow> =>
      ipcRenderer.invoke('data.getTaskWorkflow', id),
    saveTaskWorkflow: (id: string, payload: DataWorkflowSaveInput): Promise<DataTaskWorkflow> =>
      ipcRenderer.invoke('data.saveTaskWorkflow', id, payload),
    importDataset: (payload: DataImportDatasetInput): Promise<DataDataset> =>
      ipcRenderer.invoke('data.importDataset', payload),
    getInputTable: (id: string): Promise<DataDataset | null> =>
      ipcRenderer.invoke('data.getInputTable', id),
    updateDataset: (payload: DataUpdateDatasetInput): Promise<DataDataset> =>
      ipcRenderer.invoke('data.updateDataset', payload),
    getOutputTable: (id: string): Promise<DataOutputTable | null> =>
      ipcRenderer.invoke('data.getOutputTable', id),
    createOutputTable: (payload?: DataCreateOutputTableInput): Promise<DataOutputTable> =>
      ipcRenderer.invoke('data.createOutputTable', payload),
    updateOutputTable: (payload: DataUpdateOutputTableInput): Promise<DataOutputTable> =>
      ipcRenderer.invoke('data.updateOutputTable', payload),
    previewInputTable: (payload: DataPreviewInputTableInput): Promise<DataInputTablePreview> =>
      ipcRenderer.invoke('data.previewInputTable', payload),
    previewDataset: (payload: DataPreviewDatasetInput): Promise<DataInputTablePreview> =>
      ipcRenderer.invoke('data.previewDataset', payload),
    previewWorkflowNode: (payload: DataPreviewWorkflowNodeInput): Promise<DataInputTablePreview> =>
      ipcRenderer.invoke('data.previewWorkflowNode', payload),
    getWorkflowNodeColumns: (payload: DataPreviewWorkflowNodeInput): Promise<string[]> =>
      ipcRenderer.invoke('data.getWorkflowNodeColumns', payload),
    getWorkflowNodeColumnTypes: (
      payload: DataPreviewWorkflowNodeInput
    ): Promise<DataColumnTypeInfo[]> =>
      ipcRenderer.invoke('data.getWorkflowNodeColumnTypes', payload),
    getWorkflowNodeColumnValues: (
      payload: DataPreviewWorkflowNodeInput & { column: string }
    ): Promise<string[]> => ipcRenderer.invoke('data.getWorkflowNodeColumnValues', payload),
    summarizeInputTableSource: (
      payload: DataSummarizeInputTableSourceInput
    ): Promise<DataInputTableSourceSummary> =>
      ipcRenderer.invoke('data.summarizeInputTableSource', payload),
    generateInputTableNormalizerDraft: (
      payload: DataGenerateInputTableNormalizerDraftInput
    ): Promise<DataGenerateInputTableNormalizerDraftResult> =>
      ipcRenderer.invoke('data.generateInputTableNormalizerDraft', payload),
    generateTaskFromRequirement: (
      payload: DataGenerateTaskFromRequirementInput
    ): Promise<DataGenerateTaskFromRequirementResult> =>
      ipcRenderer.invoke('data.generateTaskFromRequirement', payload),
    analyzeTaskRequirement: (
      payload: DataGenerateTaskFromRequirementInput
    ): Promise<DataAnalyzeTaskRequirementResult> =>
      ipcRenderer.invoke('data.analyzeTaskRequirement', payload),
    onInputTableNormalizerDraftProgress: (
      callback: (event: DataInputTableNormalizerDraftProgressEvent) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: DataInputTableNormalizerDraftProgressEvent
      ) => callback(data);
      ipcRenderer.on('data.inputTableNormalizerDraftProgress', listener);
      return () => ipcRenderer.removeListener('data.inputTableNormalizerDraftProgress', listener);
    },
    previewInputTableNormalizerVersion: (
      payload: DataPreviewInputTableNormalizerVersionInput
    ): Promise<{ preview: DataInputTablePreview }> =>
      ipcRenderer.invoke('data.previewInputTableNormalizerVersion', payload),
    publishInputTableNormalizerVersion: (
      payload: DataPublishInputTableNormalizerVersionInput
    ): Promise<DataInputTableNormalizerVersionSaveResult> =>
      ipcRenderer.invoke('data.publishInputTableNormalizerVersion', payload),
    deleteInputTableNormalizerVersion: (
      payload: DataDeleteInputTableNormalizerVersionInput
    ): Promise<DataDeleteInputTableNormalizerVersionResult> =>
      ipcRenderer.invoke('data.deleteInputTableNormalizerVersion', payload),
    listInputTableNormalizerVersions: (
      payload: DataListInputTableNormalizerVersionsInput
    ): Promise<DataListInputTableNormalizerVersionsResult> =>
      ipcRenderer.invoke('data.listInputTableNormalizerVersions', payload),
    deleteTask: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('data.deleteTask', id),
    deleteDataset: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('data.deleteDataset', id),
    listCloudSpaces: (payload?: ListCloudSpacesInput): Promise<ListCloudSpacesResult> =>
      invokeDataCommand('data.listCloudSpaces', payload),
    listCloudProjects: (payload: ListCloudProjectsInput): Promise<ListCloudProjectsResult> =>
      invokeDataCommand('data.listCloudProjects', payload),
    listCloudTables: (payload: ListCloudTablesInput): Promise<ListCloudTablesResult> =>
      invokeDataCommand('data.listCloudTables', payload),
    searchCloudTables: (payload: SearchCloudTablesInput): Promise<SearchCloudTablesResult> =>
      invokeDataCommand('data.searchCloudTables', payload),
    previewCloudTable: (payload: PreviewCloudTableInput): Promise<PreviewCloudTableResult> =>
      invokeDataCommand('data.previewCloudTable', payload),
    importCloudTable: (payload: ImportCloudTableInput): Promise<ImportCloudTableResult> =>
      invokeDataCommand('data.importCloudTable', payload),
    uploadDataTableToCloud: (
      payload: UploadDataTableToCloudInput
    ): Promise<UploadDataTableToCloudResult> =>
      invokeDataCommand('data.uploadDataTableToCloud', payload),
  },

  // Config methods
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config.get'),
    getPresets: (): Promise<ProviderPresets> => ipcRenderer.invoke('config.getPresets'),
    save: (config: Partial<AppConfig>): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.save', config),
    createSet: (payload: CreateSetPayload): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.createSet', payload),
    renameSet: (payload: {
      id: string;
      name: string;
    }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.renameSet', payload),
    deleteSet: (payload: { id: string }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.deleteSet', payload),
    switchSet: (payload: { id: string }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.switchSet', payload),
    selectBuiltinModel: (payload: {
      model: string;
    }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.selectBuiltinModel', payload),
    isConfigured: (): Promise<boolean> => ipcRenderer.invoke('config.isConfigured'),
    test: (config: ApiTestInput): Promise<ApiTestResult> =>
      ipcRenderer.invoke('config.test', config),
    listModels: (payload: {
      provider: AppConfig['provider'];
      apiKey: string;
      baseUrl?: string;
    }): Promise<ProviderModelInfo[]> => ipcRenderer.invoke('config.listModels', payload),
    diagnose: (input: DiagnosticInput): Promise<DiagnosticResult> =>
      ipcRenderer.invoke('config.diagnose', input),
    discoverLocal: (payload?: { baseUrl?: string }): Promise<LocalOllamaDiscoveryResult> =>
      ipcRenderer.invoke('config.discover-local', payload),
    listPersonalAnalysisDatasources: (payload: {
      apiOrigin?: string;
      apiKey?: string;
      accessToken?: string;
    }): Promise<PersonalAnalysisDatasource[]> =>
      ipcRenderer.invoke('config.listPersonalAnalysisDatasources', payload),
  },

  // Window control methods
  window: {
    minimize: () => ipcRenderer.send('window.minimize'),
    maximize: () => ipcRenderer.send('window.maximize'),
    close: () => ipcRenderer.send('window.close'),
  },

  // MCP methods
  mcp: {
    getServers: (): Promise<McpServerConfig[]> => ipcRenderer.invoke('mcp.getServers'),
    getServer: (serverId: string): Promise<McpServerConfig | undefined> =>
      ipcRenderer.invoke('mcp.getServer', serverId),
    saveServer: (config: McpServerConfig): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('mcp.saveServer', config),
    deleteServer: (serverId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mcp.deleteServer', serverId),
    getTools: (): Promise<McpTool[]> => ipcRenderer.invoke('mcp.getTools'),
    getServerStatus: (): Promise<McpServerStatus[]> => ipcRenderer.invoke('mcp.getServerStatus'),
    getPresets: (): Promise<McpPresetsMap> => ipcRenderer.invoke('mcp.getPresets'),
  },

  // Skills methods
  skills: {
    getAll: (): Promise<Skill[]> => ipcRenderer.invoke('skills.getAll'),
    install: (skillPath: string): Promise<{ success: boolean; skill: Skill }> =>
      ipcRenderer.invoke('skills.install', skillPath),
    installFromSkillHub: (slug: string): Promise<{ success: boolean; skill: Skill }> =>
      ipcRenderer.invoke('skills.installFromSkillHub', slug),
    delete: (skillId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('skills.delete', skillId),
    setEnabled: (skillId: string, enabled: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('skills.setEnabled', skillId, enabled),
    validate: (skillPath: string): Promise<{ valid: boolean; errors: string[] }> =>
      ipcRenderer.invoke('skills.validate', skillPath),
    getStoragePath: (): Promise<string> => ipcRenderer.invoke('skills.getStoragePath'),
    setStoragePath: (
      targetPath: string,
      migrate = true
    ): Promise<{
      success: boolean;
      path: string;
      migratedCount: number;
      skippedCount: number;
      error?: string;
    }> => ipcRenderer.invoke('skills.setStoragePath', targetPath, migrate),
    openStoragePath: (): Promise<{ success: boolean; path: string; error?: string }> =>
      ipcRenderer.invoke('skills.openStoragePath'),
    openSkillPath: (skillId: string): Promise<{ success: boolean; path: string; error?: string }> =>
      ipcRenderer.invoke('skills.openSkillPath', skillId),
  },

  plugins: {
    listCatalog: (options?: {
      installableOnly?: boolean;
      source?: 'skillhub' | 'claude-marketplace' | 'all';
      page?: number;
      pageSize?: number;
    }): Promise<PluginCatalogItemV2[]> => ipcRenderer.invoke('plugins.listCatalog', options),
    listInstalled: (): Promise<InstalledPlugin[]> => ipcRenderer.invoke('plugins.listInstalled'),
    install: (pluginName: string): Promise<PluginInstallResultV2> =>
      ipcRenderer.invoke('plugins.install', pluginName),
    setEnabled: (pluginId: string, enabled: boolean): Promise<PluginToggleResult> =>
      ipcRenderer.invoke('plugins.setEnabled', pluginId, enabled),
    setComponentEnabled: (
      pluginId: string,
      component: PluginComponentKind,
      enabled: boolean
    ): Promise<PluginToggleResult> =>
      ipcRenderer.invoke('plugins.setComponentEnabled', pluginId, component, enabled),
    uninstall: (pluginId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('plugins.uninstall', pluginId),
  },

  // Sandbox methods
  sandbox: {
    getStatus: (): Promise<{
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
    }> => ipcRenderer.invoke('sandbox.getStatus'),
    checkWSL: (): Promise<{
      available: boolean;
      distro?: string;
      nodeAvailable?: boolean;
      version?: string;
      pythonAvailable?: boolean;
      pythonVersion?: string;
      pipAvailable?: boolean;
      claudeCodeAvailable?: boolean;
    }> => ipcRenderer.invoke('sandbox.checkWSL'),
    checkLima: (): Promise<{
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
    }> => ipcRenderer.invoke('sandbox.checkLima'),
    installNodeInWSL: (distro: string): Promise<boolean> =>
      ipcRenderer.invoke('sandbox.installNodeInWSL', distro),
    installPythonInWSL: (distro: string): Promise<boolean> =>
      ipcRenderer.invoke('sandbox.installPythonInWSL', distro),
    installNodeInLima: (): Promise<boolean> => ipcRenderer.invoke('sandbox.installNodeInLima'),
    installPythonInLima: (): Promise<boolean> => ipcRenderer.invoke('sandbox.installPythonInLima'),
    startLimaInstance: (): Promise<boolean> => ipcRenderer.invoke('sandbox.startLimaInstance'),
    stopLimaInstance: (): Promise<boolean> => ipcRenderer.invoke('sandbox.stopLimaInstance'),
    retrySetup: (): Promise<{ success: boolean; error?: string; result?: unknown }> =>
      ipcRenderer.invoke('sandbox.retrySetup'),
    retryLimaSetup: (): Promise<{ success: boolean; error?: string; result?: unknown }> =>
      ipcRenderer.invoke('sandbox.retryLimaSetup'),
  },

  // Logs methods
  logs: {
    getPath: (): Promise<string | null> => ipcRenderer.invoke('logs.getPath'),
    getDirectory: (): Promise<string> => ipcRenderer.invoke('logs.getDirectory'),
    getAll: (): Promise<Array<{ name: string; path: string; size: number; mtime: Date }>> =>
      ipcRenderer.invoke('logs.getAll'),
    export: (): Promise<{ success: boolean; path?: string; size?: number; error?: string }> =>
      ipcRenderer.invoke('logs.export'),
    open: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('logs.open'),
    clear: (): Promise<{ success: boolean; deletedCount?: number; error?: string }> =>
      ipcRenderer.invoke('logs.clear'),
    setEnabled: (
      enabled: boolean
    ): Promise<{ success: boolean; enabled?: boolean; error?: string }> =>
      ipcRenderer.invoke('logs.setEnabled', enabled),
    isEnabled: (): Promise<{ success: boolean; enabled?: boolean; error?: string }> =>
      ipcRenderer.invoke('logs.isEnabled'),
    write: (
      level: 'info' | 'warn' | 'error',
      ...args: unknown[]
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('logs.write', level, ...args),
  },

  // Remote control methods
  remote: {
    getConfig: (): Promise<RemoteConfig> => ipcRenderer.invoke('remote.getConfig'),
    getStatus: (): Promise<{
      running: boolean;
      port?: number;
      publicUrl?: string;
      channels: Array<{ type: string; enabled: boolean; connected: boolean; error?: string }>;
      activeSessions: number;
      pendingPairings: number;
    }> => ipcRenderer.invoke('remote.getStatus'),
    setEnabled: (enabled: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.setEnabled', enabled),
    setChannelEnabled: (
      type: ControllableChannelType,
      enabled: boolean
    ): Promise<RemoteChannelToggleResult> =>
      ipcRenderer.invoke('remote.setChannelEnabled', type, enabled),
    updateGatewayConfig: (
      config: Partial<GatewayConfig>
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateGatewayConfig', config),
    updateFeishuConfig: (
      config: FeishuChannelConfig
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateFeishuConfig', config),
    updateDingtalkConfig: (
      config: DingtalkChannelConfig,
      gatewayConfig?: Partial<GatewayConfig>
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateDingtalkConfig', config, gatewayConfig),
    updateWecomConfig: (
      config: WecomChannelConfig,
      gatewayConfig?: Partial<GatewayConfig>
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateWecomConfig', config, gatewayConfig),
    getPairedUsers: (): Promise<PairedUser[]> => ipcRenderer.invoke('remote.getPairedUsers'),
    getPendingPairings: (): Promise<PairingRequest[]> =>
      ipcRenderer.invoke('remote.getPendingPairings'),
    approvePairing: (
      channelType: string,
      userId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.approvePairing', channelType, userId),
    revokePairing: (
      channelType: string,
      userId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.revokePairing', channelType, userId),
    rejectPairing: (
      channelType: string,
      userId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.rejectPairing', channelType, userId),
    getRemoteSessions: (): Promise<RemoteSessionMapping[]> =>
      ipcRenderer.invoke('remote.getRemoteSessions'),
    clearRemoteSession: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.clearRemoteSession', sessionId),
    getTunnelStatus: (): Promise<{
      connected: boolean;
      url: string | null;
      provider: string;
      error?: string;
    }> => ipcRenderer.invoke('remote.getTunnelStatus'),
    getWebhookUrl: (channelType?: ChannelType): Promise<string | null> =>
      ipcRenderer.invoke('remote.getWebhookUrl', channelType),
    restart: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.restart'),
  },

  schedule: {
    list: (): Promise<ScheduleTask[]> => ipcRenderer.invoke('schedule.list'),
    create: (payload: ScheduleCreateInput): Promise<ScheduleTask> =>
      ipcRenderer.invoke('schedule.create', payload),
    update: (id: string, updates: ScheduleUpdateInput): Promise<ScheduleTask | null> =>
      ipcRenderer.invoke('schedule.update', id, updates),
    delete: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('schedule.delete', id),
    toggle: (id: string, enabled: boolean): Promise<ScheduleTask | null> =>
      ipcRenderer.invoke('schedule.toggle', id, enabled),
    runNow: (id: string): Promise<ScheduleTask | null> => ipcRenderer.invoke('schedule.runNow', id),
  },

  automation: {
    list: (query?: AutomationListQuery): Promise<Automation[]> =>
      ipcRenderer.invoke('automation.list', query),
    get: (id: string): Promise<Automation | null> => ipcRenderer.invoke('automation.get', id),
    create: (payload: AutomationCreateInput): Promise<Automation> =>
      ipcRenderer.invoke('automation.create', payload),
    update: (id: string, updates: AutomationUpdateInput): Promise<Automation | null> =>
      ipcRenderer.invoke('automation.update', id, updates),
    delete: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('automation.delete', id),
    setEnabled: (id: string, enabled: boolean): Promise<Automation | null> =>
      ipcRenderer.invoke('automation.setEnabled', id, enabled),
    pause: (id: string): Promise<Automation | null> => ipcRenderer.invoke('automation.pause', id),
    resume: (id: string): Promise<Automation | null> => ipcRenderer.invoke('automation.resume', id),
    runNow: (id: string): Promise<AutomationRun | null> =>
      ipcRenderer.invoke('automation.runNow', id),
    listRuns: (id: string, query?: AutomationRunQuery): Promise<AutomationRun[]> =>
      ipcRenderer.invoke('automation.runs.list', id, query),
    listArtifacts: (runId: string): Promise<AutomationArtifact[]> =>
      ipcRenderer.invoke('automation.artifacts.list', runId),
    listActionDefinitions: (): Promise<AutomationActionDefinitionSummary[]> =>
      ipcRenderer.invoke('automation.actions.listDefinitions'),
  },

  memory: {
    getOverview: (cwd?: string): Promise<MemoryOverview> =>
      ipcRenderer.invoke('memory.getOverview', cwd),
    search: (payload: {
      query: string;
      cwd?: string;
      sourceWorkspace?: string | null;
      scope?: MemorySearchScope;
      limit?: number;
    }): Promise<MemorySearchResult[]> => ipcRenderer.invoke('memory.search', payload),
    read: (id: string): Promise<MemoryReadResult | null> => ipcRenderer.invoke('memory.read', id),
    listCoreEntries: (): Promise<CoreMemoryEntry[]> => ipcRenderer.invoke('memory.listCoreEntries'),
    updateCoreEntry: (
      combinedKey: string,
      updates: { key?: string; value?: string; confidence?: number; status?: MemoryItemStatus }
    ): Promise<CoreMemoryEntry | null> =>
      ipcRenderer.invoke('memory.updateCoreEntry', combinedKey, updates),
    deleteCoreEntry: (combinedKey: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('memory.deleteCoreEntry', combinedKey),
    listProjectEntries: (workspaceKey?: string | null): Promise<ProjectMemoryEntry[]> =>
      ipcRenderer.invoke('memory.listProjectEntries', workspaceKey),
    updateProjectEntry: (
      id: string,
      updates: { key?: string; value?: string; confidence?: number; status?: MemoryItemStatus }
    ): Promise<ProjectMemoryEntry | null> =>
      ipcRenderer.invoke('memory.updateProjectEntry', id, updates),
    deleteProjectEntry: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('memory.deleteProjectEntry', id),
    rebuildWorkspace: (
      cwd: string
    ): Promise<{
      success: boolean;
      workspaceKey: string;
      sessionCount: number;
      succeededSessionCount: number;
      failedSessionCount: number;
    }> => ipcRenderer.invoke('memory.rebuildWorkspace', cwd),
    clearWorkspace: (cwd: string): Promise<{ success: boolean; workspaceKey: string }> =>
      ipcRenderer.invoke('memory.clearWorkspace', cwd),
    clearCoreMemory: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('memory.clearCoreMemory'),
    rebuildAll: (): Promise<{
      success: boolean;
      workspaceCount: number;
      sessionCount: number;
      succeededSessionCount: number;
      failedSessionCount: number;
    }> => ipcRenderer.invoke('memory.rebuildAll'),
    listFiles: (): Promise<MemoryDebugFileInfo[]> => ipcRenderer.invoke('memory.listFiles'),
    readFile: (filePath: string): Promise<MemoryDebugFileContent> =>
      ipcRenderer.invoke('memory.readFile', filePath),
    inspectSession: (
      sessionId: string,
      workspaceKey?: string
    ): Promise<MemoryInspectSessionResult | null> =>
      ipcRenderer.invoke('memory.inspectSession', sessionId, workspaceKey),
    setEnabled: (enabled: boolean): Promise<{ success: boolean; enabled: boolean }> =>
      ipcRenderer.invoke('memory.setEnabled', enabled),
  },
});

// Type declaration for the renderer process
declare global {
  interface Window {
    electronAPI: {
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
      openGeneratedReport: (filePath: string, cwd?: string) => Promise<boolean>;
      selectFiles: () => Promise<string[]>;
      selectInputTableSource: (
        kind?: DataInputTableSourceKind
      ) => Promise<DataInputTableSourceSelection | null>;
      artifacts: {
        listRecentFiles: (
          cwd: string,
          sinceMs: number,
          limit?: number
        ) => Promise<Array<{ path: string; modifiedAt: number; size: number }>>;
      };
      data: {
        getDashboard: (payload?: DataDashboardQuery) => Promise<DataDashboard>;
        getTask: (id: string) => Promise<DataCleaningTask | null>;
        createTask: (payload: DataCreateTaskInput) => Promise<DataCleaningTask>;
        updateTask: (payload: DataUpdateTaskInput) => Promise<DataCleaningTask>;
        runTask: (id: string, payload?: DataRunTaskInput) => Promise<DataCleaningTask>;
        getTaskWorkflow: (id: string) => Promise<DataTaskWorkflow>;
        saveTaskWorkflow: (id: string, payload: DataWorkflowSaveInput) => Promise<DataTaskWorkflow>;
        importDataset: (payload: DataImportDatasetInput) => Promise<DataDataset>;
        getInputTable: (id: string) => Promise<DataDataset | null>;
        updateDataset: (payload: DataUpdateDatasetInput) => Promise<DataDataset>;
        getOutputTable: (id: string) => Promise<DataOutputTable | null>;
        createOutputTable: (payload?: DataCreateOutputTableInput) => Promise<DataOutputTable>;
        updateOutputTable: (payload: DataUpdateOutputTableInput) => Promise<DataOutputTable>;
        previewInputTable: (payload: DataPreviewInputTableInput) => Promise<DataInputTablePreview>;
        previewDataset: (payload: DataPreviewDatasetInput) => Promise<DataInputTablePreview>;
        previewWorkflowNode: (
          payload: DataPreviewWorkflowNodeInput
        ) => Promise<DataInputTablePreview>;
        getWorkflowNodeColumns: (payload: DataPreviewWorkflowNodeInput) => Promise<string[]>;
        getWorkflowNodeColumnTypes: (
          payload: DataPreviewWorkflowNodeInput
        ) => Promise<DataColumnTypeInfo[]>;
        getWorkflowNodeColumnValues: (
          payload: DataPreviewWorkflowNodeInput & { column: string }
        ) => Promise<string[]>;
        summarizeInputTableSource: (
          payload: DataSummarizeInputTableSourceInput
        ) => Promise<DataInputTableSourceSummary>;
        generateInputTableNormalizerDraft: (
          payload: DataGenerateInputTableNormalizerDraftInput
        ) => Promise<DataGenerateInputTableNormalizerDraftResult>;
        generateTaskFromRequirement: (
          payload: DataGenerateTaskFromRequirementInput
        ) => Promise<DataGenerateTaskFromRequirementResult>;
        analyzeTaskRequirement: (
          payload: DataGenerateTaskFromRequirementInput
        ) => Promise<DataAnalyzeTaskRequirementResult>;
        onInputTableNormalizerDraftProgress: (
          callback: (event: DataInputTableNormalizerDraftProgressEvent) => void
        ) => () => void;
        previewInputTableNormalizerVersion: (
          payload: DataPreviewInputTableNormalizerVersionInput
        ) => Promise<{ preview: DataInputTablePreview }>;
        publishInputTableNormalizerVersion: (
          payload: DataPublishInputTableNormalizerVersionInput
        ) => Promise<DataInputTableNormalizerVersionSaveResult>;
        deleteInputTableNormalizerVersion: (
          payload: DataDeleteInputTableNormalizerVersionInput
        ) => Promise<DataDeleteInputTableNormalizerVersionResult>;
        listInputTableNormalizerVersions: (
          payload: DataListInputTableNormalizerVersionsInput
        ) => Promise<DataListInputTableNormalizerVersionsResult>;
        deleteTask: (id: string) => Promise<{ success: boolean }>;
        deleteDataset: (id: string) => Promise<{ success: boolean }>;
        listCloudSpaces: (payload?: ListCloudSpacesInput) => Promise<ListCloudSpacesResult>;
        listCloudProjects: (payload: ListCloudProjectsInput) => Promise<ListCloudProjectsResult>;
        listCloudTables: (payload: ListCloudTablesInput) => Promise<ListCloudTablesResult>;
        searchCloudTables: (payload: SearchCloudTablesInput) => Promise<SearchCloudTablesResult>;
        previewCloudTable: (payload: PreviewCloudTableInput) => Promise<PreviewCloudTableResult>;
        importCloudTable: (payload: ImportCloudTableInput) => Promise<ImportCloudTableResult>;
        uploadDataTableToCloud: (
          payload: UploadDataTableToCloudInput
        ) => Promise<UploadDataTableToCloudResult>;
      };
      config: {
        get: () => Promise<AppConfig>;
        getPresets: () => Promise<ProviderPresets>;
        save: (config: Partial<AppConfig>) => Promise<{ success: boolean; config: AppConfig }>;
        createSet: (payload: CreateSetPayload) => Promise<{ success: boolean; config: AppConfig }>;
        renameSet: (payload: {
          id: string;
          name: string;
        }) => Promise<{ success: boolean; config: AppConfig }>;
        deleteSet: (payload: { id: string }) => Promise<{ success: boolean; config: AppConfig }>;
        switchSet: (payload: { id: string }) => Promise<{ success: boolean; config: AppConfig }>;
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
        openSkillPath: (
          skillId: string
        ) => Promise<{ success: boolean; path: string; error?: string }>;
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
        list: (query?: AutomationListQuery) => Promise<Automation[]>;
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
        rebuildWorkspace: (cwd: string) => Promise<{
          success: boolean;
          workspaceKey: string;
          sessionCount: number;
          succeededSessionCount: number;
          failedSessionCount: number;
        }>;
        clearWorkspace: (cwd: string) => Promise<{ success: boolean; workspaceKey: string }>;
        clearCoreMemory: () => Promise<{ success: boolean }>;
        rebuildAll: () => Promise<{
          success: boolean;
          workspaceCount: number;
          sessionCount: number;
          succeededSessionCount: number;
          failedSessionCount: number;
        }>;
        listFiles: () => Promise<MemoryDebugFileInfo[]>;
        readFile: (filePath: string) => Promise<MemoryDebugFileContent>;
        inspectSession: (
          sessionId: string,
          workspaceKey?: string
        ) => Promise<MemoryInspectSessionResult | null>;
        setEnabled: (enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>;
      };
    };
  }
}

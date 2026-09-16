import { ipcRenderer } from 'electron';
import type {
  ApiTestInput,
  ApiTestResult,
  AppConfig,
  AppConfigUpdate,
  CodexAuthActionResult,
  CodexAuthStatus,
  CodexLoginPromptPayload,
  CreateSetPayload,
  DiagnosticInput,
  DiagnosticResult,
  LocalOllamaDiscoveryResult,
  PersonalAnalysisDatasource,
  ProviderModelInfo,
  ProviderPresets,
} from '../../shared/contracts';
import type { ElectronApi } from '../../shared/contracts/electron-api';

export function createConfigApi(): ElectronApi['config'] {
  return {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config.get'),
    getPresets: (): Promise<ProviderPresets> => ipcRenderer.invoke('config.getPresets'),
    save: (config: AppConfigUpdate): Promise<{ success: boolean; config: AppConfig }> =>
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
    updateSet: (payload: {
      id: string;
      updates: AppConfigUpdate;
    }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.updateSet', payload),
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
    codexAuthStatus: (): Promise<CodexAuthStatus> => ipcRenderer.invoke('config.codexAuthStatus'),
    codexImportCli: (): Promise<CodexAuthActionResult> =>
      ipcRenderer.invoke('config.codexImportCli'),
    codexLogin: (): Promise<CodexAuthActionResult> => ipcRenderer.invoke('config.codexLogin'),
    codexSubmitLoginCode: (payload: {
      requestId: string;
      code: string;
    }): Promise<{ success: boolean }> => ipcRenderer.invoke('config.codexLoginCode', payload),
    codexLogout: (): Promise<CodexAuthActionResult> => ipcRenderer.invoke('config.codexLogout'),
    onCodexLoginPrompt: (callback: (payload: CodexLoginPromptPayload) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: CodexLoginPromptPayload) =>
        callback(payload);
      ipcRenderer.on('config.codexLoginPrompt', listener);
      return () => ipcRenderer.removeListener('config.codexLoginPrompt', listener);
    },
    listPersonalAnalysisDatasources: (payload: {
      apiOrigin?: string;
      apiKey?: string;
      accessToken?: string;
    }): Promise<PersonalAnalysisDatasource[]> =>
      ipcRenderer.invoke('config.listPersonalAnalysisDatasources', payload),
  };
}

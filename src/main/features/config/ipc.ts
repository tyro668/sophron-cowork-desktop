import * as crypto from 'crypto';
import { shell } from 'electron';
import { BUILTIN_LLM_CONFIG_SET_ID } from '../../../shared/builtin-llm';
import type {
  ApiTestInput,
  ApiTestResult,
  AppConfigUpdate,
  DiagnosticInput,
  ProviderModelInfo,
} from '../../../shared/contracts';
import { desktopAuthService } from '../../app/context';
import { resolveAppConfigForAuth, resolveApiTestInputForAuth } from '../../app/runtime-config';
import {
  ensureCodexCredentials,
  getCodexAuthStatus,
  loginCodex,
  logoutCodex,
} from '../../config/codex-auth';
import {
  configStore,
  getPiAiModelPresets,
  type AppConfig,
  type CreateConfigSetPayload,
} from '../../config/config-store';
import { runConfigApiTest } from '../../config/config-test-routing';
import { listOllamaModels } from '../../config/ollama-api';
import { createPersonalAnalysisClient } from '../../data/personal-analysis-client';
import { handleIpc } from '../../ipc-handle';
import { log, logError } from '../../utils/logger';
import { summarizeConfigUpdate } from './log-summary';
import { syncConfigAfterMutation } from './service';

export function registerConfigIpc(): void {
  // Config IPC handlers
  handleIpc('config.get', () => {
    try {
      return configStore.getAll();
    } catch (error) {
      logError('[Config] Error getting config:', error);
      return {};
    }
  });

  handleIpc('config.getPresets', () => {
    try {
      return getPiAiModelPresets();
    } catch (error) {
      logError('[Config] Error getting presets:', error);
      return [];
    }
  });

  handleIpc('config.save', async (_event, newConfig: AppConfigUpdate) => {
    // Allowlisted summary only — the payload contains apiKeys at multiple
    // nesting levels (top-level, profiles, configSets, memoryRuntime,
    // personalAnalysis) and log lines are persisted + exported.
    log('[Config] Saving config:', summarizeConfigUpdate(newConfig));

    const previousConfig = configStore.getAll();
    // Update config
    configStore.update(newConfig);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);

    return { success: true, config: updatedConfig };
  });

  handleIpc('config.createSet', async (_event, payload: CreateConfigSetPayload) => {
    log('[Config] Creating config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.createSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  handleIpc('config.renameSet', async (_event, payload: { id: string; name: string }) => {
    log('[Config] Renaming config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.renameSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  handleIpc('config.deleteSet', async (_event, payload: { id: string }) => {
    log('[Config] Deleting config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.deleteSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  handleIpc('config.switchSet', async (_event, payload: { id: string }) => {
    log('[Config] Switching config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.switchSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  handleIpc(
    'config.updateSet',
    async (_event, payload: { id: string; updates: Parameters<typeof configStore.update>[0] }) => {
      log('[Config] Updating config set:', { id: payload.id });
      const previousConfig = configStore.getAll();
      configStore.updateSet(payload);
      const updatedConfig = await syncConfigAfterMutation(previousConfig);
      return { success: true, config: updatedConfig };
    }
  );

  handleIpc('config.selectBuiltinModel', async (_event, payload: { model: string }) => {
    const model = typeof payload.model === 'string' ? payload.model.trim() : '';
    if (!model) {
      throw new Error('Model is required');
    }

    log('[Config] Selecting built-in model:', { model });
    const previousConfig = configStore.getAll();
    configStore.update({
      activeConfigSetId: BUILTIN_LLM_CONFIG_SET_ID,
      provider: 'sophron',
      customProtocol: 'openai',
      builtinLlmModel: model,
      apiKey: '',
      baseUrl: '',
    });
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  handleIpc('config.isConfigured', () => {
    try {
      return configStore.isConfigured();
    } catch (error) {
      logError('[Config] Error checking configured status:', error);
      return false;
    }
  });

  handleIpc('config.test', async (_event, payload: ApiTestInput): Promise<ApiTestResult> => {
    try {
      const resolvedPayload = resolveApiTestInputForAuth(payload);
      return await runConfigApiTest(resolvedPayload, resolveAppConfigForAuth(configStore.getAll()));
    } catch (error) {
      logError('[Config] API test failed:', error);
      return {
        ok: false,
        errorType: 'unknown',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  });

  handleIpc(
    'config.listModels',
    async (
      _event,
      payload: { provider: AppConfig['provider']; apiKey: string; baseUrl?: string }
    ): Promise<ProviderModelInfo[]> => {
      if (payload.provider === 'sophron') {
        return desktopAuthService.listLlmModels();
      }
      if (payload.provider !== 'ollama') {
        return [];
      }
      return listOllamaModels(payload);
    }
  );

  handleIpc('config.diagnose', async (_event, payload: DiagnosticInput) => {
    try {
      const { runDiagnostics } = await import('../../config/api-diagnostics');
      return await runDiagnostics(resolveApiTestInputForAuth(payload));
    } catch (error) {
      logError('[Config] Error running diagnostics:', error);
      throw error;
    }
  });

  handleIpc('config.discover-local', async (_event, payload?: { baseUrl?: string }) => {
    try {
      const { discoverLocalOllama } = await import('../../config/api-diagnostics');
      return await discoverLocalOllama(payload);
    } catch (error) {
      logError('[Config] Error discovering local services:', error);
      return [];
    }
  });

  handleIpc('config.codexAuthStatus', () => {
    try {
      return getCodexAuthStatus();
    } catch (error) {
      logError('[Config] Error getting codex auth status:', error);
      return { connected: false, source: null };
    }
  });

  handleIpc('config.codexImportCli', () => {
    try {
      const imported = ensureCodexCredentials({ forceImport: true });
      return { success: imported, status: getCodexAuthStatus() };
    } catch (error) {
      logError('[Config] Error importing codex CLI credentials:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        status: getCodexAuthStatus(),
      };
    }
  });

  const pendingCodexLoginPrompts = new Map<string, (code: string) => void>();

  handleIpc('config.codexLogin', async (event) => {
    try {
      const status = await loginCodex({
        onAuthUrl: (url) => {
          void shell.openExternal(url);
        },
        onPromptCode: (message) =>
          new Promise<string>((resolve) => {
            const requestId = crypto.randomUUID();
            pendingCodexLoginPrompts.set(requestId, resolve);
            event.sender.send('config.codexLoginPrompt', { requestId, message });
          }),
      });
      return { success: true, status };
    } catch (error) {
      logError('[Config] Codex OAuth login failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        status: getCodexAuthStatus(),
      };
    }
  });

  handleIpc('config.codexLoginCode', (_event, payload: { requestId?: string; code?: string }) => {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
    const resolve = pendingCodexLoginPrompts.get(requestId);
    if (!resolve) {
      return { success: false };
    }
    pendingCodexLoginPrompts.delete(requestId);
    resolve(typeof payload?.code === 'string' ? payload.code : '');
    return { success: true };
  });

  handleIpc('config.codexLogout', () => {
    try {
      return { success: true, status: logoutCodex() };
    } catch (error) {
      logError('[Config] Error removing codex credentials:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        status: getCodexAuthStatus(),
      };
    }
  });

  handleIpc(
    'config.listPersonalAnalysisDatasources',
    async (_event, payload: { apiOrigin?: string; apiKey?: string; accessToken?: string }) => {
      try {
        return await createPersonalAnalysisClient(payload).listDatasources();
      } catch (error) {
        logError('[Config] Error listing Personal Analysis datasources:', error);
        throw error;
      }
    }
  );
}

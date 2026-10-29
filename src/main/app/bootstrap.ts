import { markPersonalAnalysisKeyDisconnected } from '../features/data/cloud-connection-state';
import { createRawTableReimporter } from '../automation/raw-table-reimport';
import { setSkillUsageSink } from '../skills/skill-usage';
import { app, BrowserWindow, dialog, nativeTheme } from 'electron';
import * as fs from 'fs';
import { join } from 'path';
import { APP_INTERNAL_NAME } from '../../shared/branding';
import { applyRuntimeLogo } from './brand-icons';
import { AutomationRunner } from '../automation/automation-runner';
import { AutomationScheduler } from '../automation/automation-scheduler';
import { AutomationService } from '../automation/automation-service';
import { createAutomationStore } from '../automation/automation-store';
import { createDefaultAutomationActionRegistry } from '../automation/default-actions';
import { ScriptPackageService } from '../automation/script-packages/service';
import { createSqliteScriptVersionStore } from '../automation/script-packages/version-store';
import { createScriptPackageAgentRuntimeExtension } from '../automation/script-packages/agent-tools';
import { createAutomationAgentRuntimeExtension } from '../automation/tools';
import { AutomationToolService } from '../automation/tools/service';
import { configStore } from '../config/config-store';
import { setPermissionRules } from '../config/permission-rules-store';
import { getPermissionRulesForPolicy } from '../../shared/permission-policies';
import { createDataAgentRuntimeExtension } from '../data/data-agent-extension';
import { DataCommandService } from '../data/data-command-service';
import { createDataPipelineLlmUsageRecorder } from '../data/data-pipeline-llm-usage-recorder';
import { createDataPipelineStore } from '../data/data-pipeline-store';
import { DataToolService } from '../data/data-tool-service';
import { createLlmRawTableNormalizerProjectGenerator } from '../data/raw-table-normalizer-generator';
import { RequirementAnalysisReceiptStore } from '../data/requirement-analysis-receipt-store';
import { initDatabase } from '../db/database';
import { AgentRuntimeExtensionManager } from '../extensions/agent-runtime-extension-manager';
import { rescheduleAutomations } from '../features/automation/service';
import { MemoryExtension } from '../memory/memory-extension';
import { MemoryLLMClient } from '../memory/memory-llm-client';
import { MemoryService } from '../memory/memory-service';
import { startNavServer } from '../nav-server';
import { remoteConfigStore } from '../remote/remote-config-store';
import { remoteManager, type AgentExecutor } from '../remote/remote-manager';
import { SessionManager } from '../session/session-manager';
import { PluginCatalogService } from '../skills/plugin-catalog-service';
import { PluginRuntimeService } from '../skills/plugin-runtime-service';
import { SkillsManager } from '../skills/skills-manager';
import { UpdateService } from '../update/update-service';
import { log, logWarn, logError, setDevLogsEnabled } from '../utils/logger';
import { sanitizeUrlForLog } from '../utils/sanitize-url';
import { appContext, desktopAuthService } from './context';
import { sendToRenderer } from './events';
import { prepareForUpdateInstall } from './lifecycle';
import { buildMacMenu, setupDockMenu } from './menu';
import {
  getRuntimeAppName,
  notifyConversationCompleted,
  notifyAutomationRunFinished,
  notifyDataPipelineCompleted,
} from './notifications';
import {
  resolveAgentRuntimeConfigForAuth,
  resolveModelRuntimeConfigForAutomation,
  resolveAppConfigForAuth,
} from './runtime-config';
import { DARK_BG, LIGHT_BG, getSavedThemePreference } from './theme';
import { setupTray } from './tray';
import { createWindow } from './window';
import {
  initializeDefaultWorkingDir,
  getWorkspacePathUnsupportedReason,
  setWorkingDir,
} from './workdir';

export async function bootstrap(): Promise<void> {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.sophron.app');
  }
  applyRuntimeLogo(configStore.get('logoVariant'));

  // Smoke test mode: verify the app can start, then exit cleanly
  if (process.argv.includes('--smoke-test')) {
    log('[SmokeTest] App launched successfully in smoke test mode');
    log('[SmokeTest] Platform:', process.platform, 'Arch:', process.arch);
    log('[SmokeTest] Electron:', process.versions.electron, 'Node:', process.versions.node);
    try {
      // Verify critical native modules load
      await import('better-sqlite3');
      log('[SmokeTest] better-sqlite3: OK');
    } catch (e) {
      log('[SmokeTest] FAIL: better-sqlite3 failed to load:', e);
      process.exit(1);
    }
    try {
      await import('@duckdb/node-api');
      log('[SmokeTest] @duckdb/node-api: OK');
    } catch (e) {
      log('[SmokeTest] FAIL: @duckdb/node-api failed to load:', e);
      process.exit(1);
    }
    log('[SmokeTest] PASSED');
    process.exit(0);
  }

  // Apply dev logs setting from config
  const enableDevLogs = configStore.get('enableDevLogs');
  setDevLogsEnabled(enableDevLogs);
  setPermissionRules(
    getPermissionRulesForPolicy(configStore.get('permissionPolicy')),
    configStore.get('permissionPolicy')
  );

  // Log environment variables for debugging
  log(`=== ${APP_INTERNAL_NAME} Starting ===`);
  log('Config file:', configStore.getPath());
  log('Is configured:', configStore.isConfigured());
  log(`[Runtime] Using ${APP_INTERNAL_NAME} agent SDK for all providers`);
  log('Developer logs:', enableDevLogs ? 'Enabled' : 'Disabled');
  log('Environment Variables:');
  log('  ANTHROPIC_AUTH_TOKEN:', process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '✗ Not set');
  log(
    '  ANTHROPIC_BASE_URL:',
    process.env.ANTHROPIC_BASE_URL ? sanitizeUrlForLog(process.env.ANTHROPIC_BASE_URL) : '(not set)'
  );
  log('  CLAUDE_MODEL:', process.env.CLAUDE_MODEL || '(not set)');
  log('  CLAUDE_CODE_PATH:', process.env.CLAUDE_CODE_PATH || '(not set)');
  log('  OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Not set');
  log(
    '  OPENAI_BASE_URL:',
    process.env.OPENAI_BASE_URL ? sanitizeUrlForLog(process.env.OPENAI_BASE_URL) : '(not set)'
  );
  log('  OPENAI_MODEL:', process.env.OPENAI_MODEL || '(not set)');
  log('  OPENAI_API_MODE:', process.env.OPENAI_API_MODE || '(default)');
  log('===========================');

  // Initialize default working directory
  initializeDefaultWorkingDir();
  log('Working directory:', appContext.currentWorkingDir);
  // 远程会话默认使用全局工作目录
  remoteManager.setDefaultWorkingDirectory(appContext.currentWorkingDir || undefined);

  // Initialize database
  const db = initDatabase();
  appContext.appDatabase = db;
  setSkillUsageSink(db.skillInvocations ?? null);
  appContext.recordDataPipelineLlmUsage = createDataPipelineLlmUsageRecorder(db);
  const initializedDataPipelineStore = createDataPipelineStore(
    join(app.getPath('userData'), 'data', 'workspace.duckdb'),
    {
      metadataDb: db,
    }
  );
  appContext.dataPipelineStore = initializedDataPipelineStore;
  appContext.updateService = new UpdateService({
    getWindow: () => appContext.mainWindow,
    beforeInstall: prepareForUpdateInstall,
    log,
    warn: logWarn,
    error: logError,
  });
  appContext.updateService.initialize();

  appContext.pluginRuntimeService = new PluginRuntimeService(new PluginCatalogService());
  appContext.memoryService = new MemoryService(db, {
    llmClient: new MemoryLLMClient(() => resolveAppConfigForAuth(configStore.getAll())),
  });
  const requirementAnalysisReceipts = new RequirementAnalysisReceiptStore();
  appContext.dataCommandService = new DataCommandService(
    initializedDataPipelineStore,
    createLlmRawTableNormalizerProjectGenerator(() =>
      resolveAppConfigForAuth(configStore.getAll())
    ),
    () => configStore.get('personalAnalysis'),
    {
      onPipelineCompleted: notifyDataPipelineCompleted,
      onPersonalAnalysisKeyRejected: markPersonalAnalysisKeyDisconnected,
      getPersonalAnalysisConnection: (rejectedToken) =>
        desktopAuthService.getPersonalAnalysisConnection(rejectedToken),
      recordLlmUsage: (event) => appContext.recordDataPipelineLlmUsage?.(event),
      requirementAnalysisReceipts,
    }
  );
  const dataToolService = new DataToolService(
    appContext.dataCommandService,
    requirementAnalysisReceipts
  );
  const extensionManager = new AgentRuntimeExtensionManager([
    new MemoryExtension(appContext.memoryService),
    createDataAgentRuntimeExtension(dataToolService),
  ]);

  // Initialize session manager before creating an interactive window.
  // This avoids session.start racing the startup path and hitting a null manager.
  appContext.sessionManager = new SessionManager(
    db,
    sendToRenderer,
    appContext.pluginRuntimeService,
    extensionManager,
    notifyConversationCompleted,
    resolveAgentRuntimeConfigForAuth
  );
  appContext.skillsManager = new SkillsManager(db, {
    getConfiguredGlobalSkillsPath: () => configStore.get('globalSkillsPath') || '',
    setConfiguredGlobalSkillsPath: (nextPath: string) => {
      configStore.update({ globalSkillsPath: nextPath });
    },
    watchStorage: true,
  });
  appContext.skillsManager.onStorageChanged((event) => {
    sendToRenderer({
      type: 'skills.storageChanged',
      payload: event,
    });
  });
  // pi-ai handles model routing natively — no proxy warmup needed

  // macOS: application menu, dock menu, tray icon
  buildMacMenu();
  setupTray();

  // Show window after core managers are ready so first-load actions can be handled.
  createWindow();

  // macOS: dock menu
  setupDockMenu();

  // macOS: send initial system theme to renderer
  if (appContext.mainWindow && !appContext.mainWindow.isDestroyed()) {
    appContext.mainWindow.webContents.on('did-finish-load', () => {
      sendToRenderer({
        type: 'native-theme.changed',
        payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
      });
    });
  }

  // Listen for system theme changes
  nativeTheme.on('updated', () => {
    sendToRenderer({
      type: 'native-theme.changed',
      payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
    });
    if (
      getSavedThemePreference() === 'system' &&
      appContext.mainWindow &&
      !appContext.mainWindow.isDestroyed()
    ) {
      appContext.mainWindow.setBackgroundColor(
        nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG
      );
    }
  });

  startNavServer(() => appContext.mainWindow);

  // Finish metadata upgrades (including legacy output-action migration) before scheduling.
  await initializedDataPipelineStore.getDashboard({ includeSummary: false });
  appContext.automationStore = createAutomationStore(db);
  appContext.automationStore.migrateScheduledTasks();
  const recoveredAutomationRuns = appContext.automationStore.recoverInterruptedRuns();
  if (
    recoveredAutomationRuns.failedRunningRuns > 0 ||
    recoveredAutomationRuns.cancelledQueuedRuns > 0 ||
    recoveredAutomationRuns.releasedAutomations > 0
  ) {
    log('[Automation] Recovered interrupted runs:', recoveredAutomationRuns);
  }
  appContext.scriptPackages = new ScriptPackageService({
    rootDir: join(app.getPath('userData'), 'scripts'),
    versions: createSqliteScriptVersionStore(db.raw),
  });
  const automationActionRegistry = createDefaultAutomationActionRegistry({
    scriptPackages: appContext.scriptPackages,
    dataPipelineStore: initializedDataPipelineStore,
    automationStore: appContext.automationStore,
    dataCommandService: appContext.dataCommandService ?? undefined,
    sessionManager: appContext.sessionManager,
    resolveProjectCwd: (projectId) => db.projects?.get(projectId)?.cwd ?? null,
    resolveModelRuntimeConfig: resolveModelRuntimeConfigForAutomation,
    sendSessionUpdate: (started) => {
      sendToRenderer({
        type: 'session.update',
        payload: { sessionId: started.id, updates: started },
      });
    },
  });
  const automationRunner = new AutomationRunner({
    store: appContext.automationStore,
    registry: automationActionRegistry,
    deliver: async () => 'skipped',
    notifyRunFinished: notifyAutomationRunFinished,
  });
  appContext.automationService = new AutomationService({
    store: appContext.automationStore,
    runner: automationRunner,
    registry: automationActionRegistry,
  });
  initializedDataPipelineStore.setOutputCommitListener((ids) => {
    void appContext.automationService?.runForResultTables(ids).catch((error) => {
      logWarn('[Automation] Output change dispatch failed:', error);
    });
  });
  initializedDataPipelineStore.setTableCommitListener((tableId, operation) => {
    const service = appContext.automationService;
    const task =
      operation === 'rebind_output'
        ? service?.runForResultTables([tableId])
        : service?.runForRawTables([tableId]);
    void task?.catch((error) => {
      logWarn('[Automation] Table change dispatch failed:', error);
    });
    // A reimport may have moved the table to a new source file — re-resolve watches.
    appContext.automationScheduler?.refreshTableWatchers();
  });
  appContext.automationScheduler = new AutomationScheduler(appContext.automationService, {
    resolveProjectCwd: (projectId) => db.projects?.get(projectId)?.cwd ?? null,
    resolveRawTableWatchTargets: async (rawTableIds) => {
      const targets = [];
      for (const rawTableId of rawTableIds) {
        const record = await initializedDataPipelineStore
          .getRawTableRecord(rawTableId)
          .catch(() => null);
        if (!record?.sourcePath || !fs.existsSync(record.sourcePath)) continue;
        if (!['csv', 'excel', 'folder'].includes(record.sourceKind)) continue;
        targets.push({
          rawTableId,
          sourcePath: record.sourcePath,
          kind: (record.sourceKind === 'folder' ? 'dir' : 'file') as 'dir' | 'file',
        });
      }
      return targets;
    },
    reimportRawTable: createRawTableReimporter(initializedDataPipelineStore),
  });
  appContext.automationScheduler.start();
  const automationToolService = new AutomationToolService({
    automationService: appContext.automationService,
    dataPipelineStore: initializedDataPipelineStore,
    projectExists: (projectId) => Boolean(db.projects?.get(projectId)),
    onAutomationsChanged: rescheduleAutomations,
    scriptPackages: appContext.scriptPackages ?? undefined,
  });
  extensionManager.register(createAutomationAgentRuntimeExtension(automationToolService));
  extensionManager.register(createScriptPackageAgentRuntimeExtension(appContext.scriptPackages));

  // 初始化远程管理器
  remoteManager.setRendererCallback(sendToRenderer);
  const agentExecutor: AgentExecutor = {
    startSession: async (title, prompt, cwd) => {
      if (!appContext.sessionManager) throw new Error('Session manager not initialized');
      const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
      if (unsupportedReason) {
        throw new Error(unsupportedReason);
      }
      return appContext.sessionManager.startSession(title, prompt, cwd);
    },
    continueSession: async (sessionId, prompt, content, cwd) => {
      if (!appContext.sessionManager) throw new Error('Session manager not initialized');
      if (cwd) {
        const result = await setWorkingDir(cwd, sessionId);
        if (!result.success) {
          throw new Error(result.error || 'Failed to update working directory');
        }
      }
      await appContext.sessionManager.continueSession(sessionId, prompt, content);
    },
    waitForSessionIdle: async (sessionId) => {
      if (!appContext.sessionManager) throw new Error('Session manager not initialized');
      await appContext.sessionManager.waitForSessionIdle(sessionId);
    },
    stopSession: async (sessionId) => {
      if (!appContext.sessionManager) throw new Error('Session manager not initialized');
      await appContext.sessionManager.stopSession(sessionId);
    },
    validateWorkingDirectory: async (cwd) => {
      const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
      if (unsupportedReason) {
        return unsupportedReason;
      }
      if (!fs.existsSync(cwd)) {
        return 'Directory does not exist';
      }
      return null;
    },
  };
  remoteManager.setAgentExecutor(agentExecutor);

  // 远程控制启用时启动
  if (remoteConfigStore.isEnabled()) {
    remoteManager.start().catch((error) => {
      logError('[App] Failed to start remote control:', error);
    });
  }

  app.on('activate', () => {
    const hasVisibleWindow = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed());
    if (!hasVisibleWindow) {
      createWindow();
    }
  });
}

export function handleBootstrapFailure(error: unknown) {
  logError('[App] Startup failed:', error);
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  dialog.showErrorBox(`${getRuntimeAppName()} 启动失败`, `${message}\n\n请查看日志获取更多信息。`);
  app.quit();
}

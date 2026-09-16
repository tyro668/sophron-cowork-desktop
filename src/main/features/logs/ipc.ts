import { app, dialog, shell } from 'electron';
import * as fs from 'fs';
import { appContext } from '../../app/context';
import { getRuntimeAppName } from '../../app/notifications';
import { configStore } from '../../config/config-store';
import { handleIpc } from '../../ipc-handle';
import { getSandboxAdapter } from '../../sandbox/sandbox-adapter';
import { buildDiagnosticsSummary } from '../../utils/diagnostics-summary';
import {
  log,
  logWarn,
  logError,
  getLogFilePath,
  getLogsDirectory,
  getAllLogFiles,
  closeLogFile,
  setDevLogsEnabled,
  isDevLogsEnabled,
} from '../../utils/logger';
import { sanitizeDiagnosticBaseUrl } from './service';

export function registerLogsIpc(): void {
  // Logs IPC handlers
  handleIpc('logs.getPath', () => {
    try {
      return getLogFilePath();
    } catch (error) {
      logError('[Logs] Error getting log path:', error);
      return null;
    }
  });

  handleIpc('logs.getDirectory', () => {
    try {
      return getLogsDirectory();
    } catch (error) {
      logError('[Logs] Error getting logs directory:', error);
      return null;
    }
  });

  handleIpc('logs.getAll', () => {
    try {
      return getAllLogFiles();
    } catch (error) {
      logError('[Logs] Error getting all log files:', error);
      return [];
    }
  });

  handleIpc('logs.export', async () => {
    try {
      const logFiles = getAllLogFiles();
      const diagnosticsSummary = buildDiagnosticsSummary({
        app: {
          version: app.getVersion(),
          isPackaged: app.isPackaged,
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          electronVersion: process.versions.electron,
          chromeVersion: process.versions.chrome,
        },
        runtime: {
          currentWorkingDir: appContext.currentWorkingDir,
          logsDirectory: getLogsDirectory(),
          logFileCount: logFiles.length,
          totalLogSizeBytes: logFiles.reduce((total, file) => total + file.size, 0),
          devLogsEnabled: isDevLogsEnabled(),
        },
        config: {
          provider: configStore.get('provider'),
          model: configStore.get('model'),
          baseUrl: sanitizeDiagnosticBaseUrl(configStore.get('baseUrl') || undefined),
          customProtocol: configStore.get('customProtocol') || null,
          sandboxEnabled: !!configStore.get('sandboxEnabled'),
          thinkingEnabled: !!configStore.get('enableThinking'),
          apiKeyConfigured: !!configStore.get('apiKey'),
          claudeCodePathConfigured: !!configStore.get('claudeCodePath'),
          defaultWorkdir: configStore.get('defaultWorkdir') || null,
          globalSkillsPathConfigured: !!configStore.get('globalSkillsPath'),
        },
        sandbox: {
          mode: getSandboxAdapter().mode,
          initialized: getSandboxAdapter().initialized,
        },
        sessions: appContext.sessionManager ? appContext.sessionManager.listSessions() : [],
        logFiles,
        deps: {
          getMessages: (sessionId: string) =>
            appContext.sessionManager ? appContext.sessionManager.getMessages(sessionId) : [],
          getTraceSteps: (sessionId: string) =>
            appContext.sessionManager ? appContext.sessionManager.getTraceSteps(sessionId) : [],
        },
      });

      // Show save dialog
      const result = await dialog.showSaveDialog(appContext.mainWindow!, {
        title: 'Export Logs',
        defaultPath: `sophron-logs-${new Date().toISOString().split('T')[0]}.zip`,
        filters: [
          { name: 'ZIP Archive', extensions: ['zip'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'User cancelled' };
      }

      // Dynamic import archiver
      const archiver = await import('archiver');
      const output = fs.createWriteStream(result.filePath);
      const archive = archiver.default('zip', { zlib: { level: 9 } });

      return new Promise((resolve) => {
        let settled = false;
        const settle = (value: {
          success: boolean;
          path?: string;
          size?: number;
          error?: string;
        }) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(value);
        };

        output.on('close', () => {
          log('[Logs] Exported logs to:', result.filePath);
          settle({
            success: true,
            path: result.filePath,
            size: archive.pointer(),
          });
        });

        output.on('error', (err: Error) => {
          logError('[Logs] Error writing exported archive:', err);
          settle({ success: false, error: err.message });
        });

        archive.on('error', (err: Error) => {
          logError('[Logs] Error creating archive:', err);
          settle({ success: false, error: err.message });
        });

        archive.pipe(output);

        // Add all log files
        for (const logFile of logFiles) {
          archive.file(logFile.path, { name: logFile.name });
        }

        // Add system info
        const systemInfo = {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          electronVersion: process.versions.electron,
          appVersion: app.getVersion(),
          exportDate: new Date().toISOString(),
          logFiles: logFiles.map((f) => ({
            name: f.name,
            size: f.size,
            modified: f.mtime,
          })),
        };
        archive.append(JSON.stringify(systemInfo, null, 2), { name: 'system-info.json' });
        archive.append(JSON.stringify(diagnosticsSummary, null, 2), {
          name: 'diagnostics-summary.json',
        });
        archive.append(
          [
            `${getRuntimeAppName()} diagnostic bundle`,
            `Exported at: ${diagnosticsSummary.exportedAt}`,
            '',
            'Included files:',
            '- Application log files (*.log)',
            '- system-info.json',
            '- diagnostics-summary.json',
            '',
            'diagnostics-summary.json contains a redacted runtime/config snapshot,',
            'plus metadata-only session summaries and recent error traces to speed up debugging.',
          ].join('\n'),
          { name: 'README.txt' }
        );

        archive.finalize();
      });
    } catch (error) {
      logError('[Logs] Error exporting logs:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc('logs.open', async () => {
    try {
      const logsDir = getLogsDirectory();
      await shell.openPath(logsDir);
      return { success: true };
    } catch (error) {
      logError('[Logs] Error opening logs directory:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc('logs.clear', async () => {
    try {
      const logFiles = getAllLogFiles();

      // Close current log file
      closeLogFile();

      // Delete all log files
      for (const logFile of logFiles) {
        try {
          fs.unlinkSync(logFile.path);
          log('[Logs] Deleted log file:', logFile.name);
        } catch (err) {
          logError('[Logs] Failed to delete log file:', logFile.name, err);
        }
      }

      // Log will automatically reinitialize on next log call
      log('[Logs] Log files cleared and reinitialized');

      return { success: true, deletedCount: logFiles.length };
    } catch (error) {
      logError('[Logs] Error clearing logs:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc('logs.setEnabled', async (_event, enabled: boolean) => {
    try {
      setDevLogsEnabled(enabled);
      configStore.set('enableDevLogs', enabled);
      log('[Logs] Developer logs', enabled ? 'enabled' : 'disabled');
      return { success: true, enabled };
    } catch (error) {
      logError('[Logs] Error setting dev logs enabled:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handleIpc('logs.isEnabled', () => {
    try {
      return { success: true, enabled: isDevLogsEnabled() };
    } catch (error) {
      logError('[Logs] Error getting dev logs enabled:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // The preload invokes this with spread args (`invoke('logs.write', level, ...args)`),
  // so collect them with a rest parameter here — a single `args: unknown[]` parameter
  // would silently drop every argument after the first.
  handleIpc('logs.write', (_event, level: 'info' | 'warn' | 'error', ...args: unknown[]) => {
    try {
      if (level === 'warn') {
        logWarn(...args);
      } else if (level === 'error') {
        logError(...args);
      } else {
        log(...args);
      }
      return { success: true };
    } catch (error) {
      console.error('[Logs] Error writing log:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

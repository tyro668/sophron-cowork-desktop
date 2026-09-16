import { app, BrowserWindow } from 'electron';
import { closeDatabase } from '../db/database';
import { stopNavServer } from '../nav-server';
import { remoteManager } from '../remote/remote-manager';
import { shutdownSandbox } from '../sandbox/sandbox-adapter';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { log, logError, closeLogFile } from '../utils/logger';
import { appContext } from './context';
import { createWindow } from './window';

export function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  }) as Promise<T>;
}

/**
 * Cleanup all sandbox resources
 * Called on app quit (both Windows and macOS)
 */
export async function cleanupSandboxResources(): Promise<void> {
  if (appContext.isCleaningUp) {
    log('[App] Cleanup already in progress, skipping...');
    return;
  }
  appContext.isCleaningUp = true;

  stopNavServer();
  appContext.skillsManager?.stopStorageMonitoring();
  appContext.tray?.destroy();
  appContext.tray = null;

  // 停止远程控制
  try {
    log('[App] Stopping remote control...');
    await withTimeout(remoteManager.stop(), 5000, 'Remote control shutdown');
    log('[App] Remote control stopped');
  } catch (error) {
    logError('[App] Error stopping remote control:', error);
  }

  // Cleanup all sandbox sessions (sync changes back to host OS first)
  try {
    log('[App] Cleaning up all sandbox sessions...');

    // Cleanup WSL sessions
    await withTimeout(SandboxSync.cleanupAllSessions(), 30000, 'WSL session cleanup');

    // Cleanup Lima sessions
    const { LimaSync } = await import('../sandbox/lima-sync');
    await withTimeout(LimaSync.cleanupAllSessions(), 30000, 'Lima session cleanup');

    log('[App] Sandbox sessions cleanup complete');
  } catch (error) {
    logError('[App] Error cleaning up sandbox sessions:', error);
  }

  // Shutdown sandbox adapter
  try {
    await withTimeout(shutdownSandbox(), 8000, 'Sandbox shutdown');
    log('[App] Sandbox shutdown complete');
  } catch (error) {
    logError('[App] Error shutting down sandbox:', error);
  }

  // Shutdown MCP servers
  try {
    const mcpManager = appContext.sessionManager?.getMCPManager();
    if (mcpManager) {
      log('[App] Shutting down MCP servers...');
      await withTimeout(mcpManager.shutdown(), 5000, 'MCP shutdown');
      log('[App] MCP servers shutdown complete');
    }
  } catch (error) {
    logError('[App] Error shutting down MCP servers:', error);
  }

  try {
    appContext.dataTaskStore?.close();
  } catch (error) {
    logError('[App] Error closing DuckDB data store:', error);
  } finally {
    appContext.dataTaskStore = null;
  }

  try {
    closeDatabase();
  } catch (error) {
    logError('[App] Error closing database:', error);
  } finally {
    appContext.appDatabase = null;
  }

  closeLogFile();

  // pi-ai doesn't need proxy shutdown
}

export async function prepareForUpdateInstall(): Promise<void> {
  appContext.isInstallingUpdate = true;
  stopNavServer();
  try {
    appContext.dataTaskStore?.close();
  } catch (error) {
    logError('[Update] Error closing DuckDB data store before install:', error);
  } finally {
    appContext.dataTaskStore = null;
  }
  try {
    closeDatabase();
  } catch (error) {
    logError('[Update] Error closing database before install:', error);
  } finally {
    appContext.appDatabase = null;
  }
}

export function registerAppLifecycle(): void {
  // Second-instance focus (single-instance lock is acquired in index.ts;
  // skipped in dev mode so vite-plugin-electron can restart freely)
  if (!process.env.VITE_DEV_SERVER_URL) {
    app.on('second-instance', () => {
      const existingWindow =
        appContext.mainWindow && !appContext.mainWindow.isDestroyed()
          ? appContext.mainWindow
          : BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());

      if (!existingWindow) {
        log('[App] No existing window found, creating new one');
        createWindow();
        return;
      }

      if (!appContext.mainWindow || appContext.mainWindow.isDestroyed()) {
        appContext.mainWindow = existingWindow;
      }
      if (existingWindow.isMinimized()) {
        existingWindow.restore();
      }
      existingWindow.show();
      existingWindow.focus();
      log('[App] Blocked second instance and focused existing window');
    });
  }

  // Handle app quit - window-all-closed (primary for Windows/Linux)
  app.on('window-all-closed', async () => {
    if (process.platform !== 'darwin' || process.env.VITE_DEV_SERVER_URL) {
      // On Windows/Linux, closing all windows means quit.
      // On macOS dev mode, also quit — so vite-plugin-electron can restart cleanly
      // without the old process holding the single-instance lock.
      await cleanupSandboxResources();
      app.quit();
    }
    // On macOS production, keep app alive — cleanup happens in before-quit
  });

  // Handle SIGTERM/SIGINT (e.g. pkill) — route through app.quit() for clean shutdown
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => app.quit());
  }

  // Handle app quit - before-quit (for macOS Cmd+Q and other quit methods)
  app.on('before-quit', async (event) => {
    if (appContext.isInstallingUpdate || appContext.updateService?.isInstalling()) {
      return;
    }
    if (!appContext.isCleaningUp) {
      // In dev mode, exit quickly — no need for async sandbox cleanup
      if (process.env.VITE_DEV_SERVER_URL) {
        stopNavServer();
        try {
          appContext.dataTaskStore?.close();
          appContext.dataTaskStore = null;
        } catch {
          /* best-effort */
        }
        try {
          closeDatabase();
        } catch {
          /* best-effort */
        } finally {
          appContext.appDatabase = null;
        }
        closeLogFile();
        appContext.tray?.destroy();
        appContext.tray = null;
        return;
      }
      // Set the flag immediately before any await to prevent re-entrant cleanup
      appContext.isCleaningUp = true;
      event.preventDefault();
      try {
        await cleanupSandboxResources();
      } catch (error) {
        logError('[App] before-quit cleanup failed, forcing quit:', error);
      }
      app.quit();
    }
  });
}

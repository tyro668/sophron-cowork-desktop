import { app, ipcMain, nativeTheme } from 'electron';
import { appContext } from '../../app/context';
import { handleIpc } from '../../ipc-handle';
import { logError } from '../../utils/logger';

export function registerSystemIpc(): void {
  handleIpc('get-version', () => {
    try {
      return app.getVersion();
    } catch (error) {
      logError('[IPC] Error getting version:', error);
      return 'unknown';
    }
  });

  handleIpc('system.getTheme', () => {
    try {
      return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
    } catch (error) {
      logError('[IPC] Error getting theme:', error);
      return { shouldUseDarkColors: true };
    }
  });

  // Window control IPC handlers
  ipcMain.on('window.minimize', () => {
    try {
      appContext.mainWindow?.minimize();
    } catch (error) {
      logError('[Window] Error minimizing:', error);
    }
  });

  ipcMain.on('window.maximize', () => {
    try {
      if (appContext.mainWindow?.isMaximized()) {
        appContext.mainWindow.unmaximize();
      } else {
        appContext.mainWindow?.maximize();
      }
    } catch (error) {
      logError('[Window] Error maximizing:', error);
    }
  });

  ipcMain.on('window.close', () => {
    try {
      appContext.mainWindow?.close();
    } catch (error) {
      logError('[Window] Error closing:', error);
    }
  });
}

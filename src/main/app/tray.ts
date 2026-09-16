import { app, Menu, Tray } from 'electron';
import * as fs from 'fs';
import { join } from 'path';
import { log } from '../utils/logger';
import { appContext } from './context';
import { getRuntimeAppName } from './notifications';
import { createWindow } from './window';

export function setupTray() {
  if (appContext.tray) return;

  // Use .ico on Windows for proper multi-resolution appContext.tray support; fall back to .png if absent
  const iconName =
    process.platform === 'darwin'
      ? 'appContext.tray-iconTemplate.png'
      : process.platform === 'win32'
        ? 'appContext.tray-icon.ico'
        : 'appContext.tray-icon.png';
  // TODO: create resources/appContext.tray-icon.ico from appContext.tray-icon.png for full Windows appContext.tray fidelity
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, iconName)
    : join(__dirname, '../../resources', iconName);

  // On Windows, fall back to .png if the .ico file has not been created yet
  const resolvedIconPath =
    process.platform === 'win32' && !fs.existsSync(iconPath)
      ? app.isPackaged
        ? join(process.resourcesPath, 'appContext.tray-icon.png')
        : join(__dirname, '../../resources', 'appContext.tray-icon.png')
      : iconPath;

  // Gracefully skip appContext.tray if icon is missing (e.g. dev environment)
  if (!fs.existsSync(resolvedIconPath)) {
    log('[Tray] Icon not found at', resolvedIconPath, '— skipping appContext.tray setup');
    return;
  }

  appContext.tray = new Tray(resolvedIconPath);
  appContext.tray.setToolTip(getRuntimeAppName());

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide Window',
      click: () => {
        if (!appContext.mainWindow || appContext.mainWindow.isDestroyed()) {
          createWindow();
        } else if (appContext.mainWindow.isVisible()) {
          appContext.mainWindow.hide();
        } else {
          appContext.mainWindow.show();
          appContext.mainWindow.focus();
        }
      },
    },
    {
      label: 'New Session',
      click: () => {
        if (appContext.mainWindow && !appContext.mainWindow.isDestroyed()) {
          appContext.mainWindow.show();
          appContext.mainWindow.focus();
          appContext.mainWindow.webContents.send('server-event', { type: 'new-session' });
        }
      },
    },
    {
      label: 'Settings',
      click: () => {
        if (appContext.mainWindow && !appContext.mainWindow.isDestroyed()) {
          appContext.mainWindow.show();
          appContext.mainWindow.focus();
          appContext.mainWindow.webContents.send('server-event', {
            type: 'navigate',
            payload: 'settings',
          });
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  appContext.tray.setContextMenu(contextMenu);

  appContext.tray.on('click', () => {
    if (!appContext.mainWindow || appContext.mainWindow.isDestroyed()) {
      createWindow();
    } else if (appContext.mainWindow.isVisible()) {
      appContext.mainWindow.hide();
    } else {
      appContext.mainWindow.show();
      appContext.mainWindow.focus();
    }
  });
}

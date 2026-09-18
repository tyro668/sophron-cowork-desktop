import { Menu, Tray } from 'electron';
import * as fs from 'fs';
import { log } from '../utils/logger';
import { appContext } from './context';
import { getRuntimeAppName } from './notifications';
import { createWindow } from './window';
import { getTrayIconPath } from './brand-icons';
import { configStore } from '../config/config-store';

export function setupTray() {
  if (appContext.tray) return;

  // macOS tints the monochrome Template image; Windows uses a multi-size ICO.
  const iconPath = getTrayIconPath(configStore.get('logoVariant'));

  // On Windows, fall back to .png if the .ico file has not been created yet
  const resolvedIconPath =
    process.platform === 'win32' && !fs.existsSync(iconPath)
      ? iconPath.replace(/\.ico$/, '.png')
      : iconPath;

  // Gracefully skip the tray if an icon is missing in a dev environment.
  if (!fs.existsSync(resolvedIconPath)) {
    log('[Tray] Icon not found at', resolvedIconPath, '— skipping tray setup');
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

import { app, Menu } from 'electron';
import { appContext } from './context';

export function buildMacMenu() {
  if (process.platform !== 'darwin') return;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: 'CmdOrCtrl+,',
          click: () =>
            appContext.mainWindow?.webContents.send('server-event', {
              type: 'navigate',
              payload: 'settings',
            }),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }, { type: 'separator' }, { role: 'front' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function setupDockMenu() {
  if (process.platform !== 'darwin') return;

  const dockMenu = Menu.buildFromTemplate([
    {
      label: 'New Session',
      click: () => appContext.mainWindow?.webContents.send('server-event', { type: 'new-session' }),
    },
    {
      label: 'Settings',
      click: () =>
        appContext.mainWindow?.webContents.send('server-event', {
          type: 'navigate',
          payload: 'settings',
        }),
    },
  ]);
  app.dock?.setMenu(dockMenu);
}

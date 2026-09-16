import { appContext, desktopAuthService } from '../../app/context';
import { handleIpc } from '../../ipc-handle';

export function registerAuthIpc(): void {
  handleIpc('auth.getStatus', async () => {
    return desktopAuthService.getStatus();
  });

  handleIpc('auth.login', async () => {
    try {
      return await desktopAuthService.login();
    } finally {
      if (appContext.mainWindow && !appContext.mainWindow.isDestroyed()) {
        if (appContext.mainWindow.isMinimized()) appContext.mainWindow.restore();
        appContext.mainWindow.show();
        appContext.mainWindow.focus();
      }
    }
  });

  handleIpc('auth.cancelLogin', async () => {
    return desktopAuthService.cancelLogin();
  });

  handleIpc('auth.logout', async () => {
    return desktopAuthService.logout();
  });
}

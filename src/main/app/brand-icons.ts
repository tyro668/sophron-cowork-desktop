import { app } from 'electron';
import { join } from 'path';
import type { AppLogoVariant } from '../../shared/contracts';
import { appContext } from './context';

function iconPath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(__dirname, '../../resources', name);
}

export function getWindowIconPath(variant: AppLogoVariant): string {
  const suffix = variant === 'fold' ? '-fold' : '';
  const extension =
    process.platform === 'darwin' ? 'icns' : process.platform === 'win32' ? 'ico' : 'png';
  return iconPath(`icon${suffix}.${extension}`);
}

export function getTrayIconPath(variant: AppLogoVariant): string {
  const suffix = variant === 'fold' ? '-fold' : '';
  const extension =
    process.platform === 'darwin' ? 'Template.png' : process.platform === 'win32' ? '.ico' : '.png';
  return iconPath(`tray-icon${suffix}${extension}`);
}

export function applyRuntimeLogo(variant: AppLogoVariant): void {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(iconPath(variant === 'fold' ? 'icon-fold-mac.png' : 'icon-mac.png'));
  }
  if (appContext.tray) {
    appContext.tray.setImage(getTrayIconPath(variant));
  }
  if (
    process.platform !== 'darwin' &&
    appContext.mainWindow &&
    !appContext.mainWindow.isDestroyed()
  ) {
    appContext.mainWindow.setIcon(getWindowIconPath(variant));
  }
}

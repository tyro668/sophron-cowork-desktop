import { app } from 'electron';
import { join } from 'path';
import type { AppConfig, AppLogoVariant } from '../../shared/contracts';
import { appContext } from './context';

type LogoSettings = Pick<AppConfig, 'logoVariant' | 'accentTheme'>;

function iconPath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'resources', name);
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

function getDockIconPath({ logoVariant, accentTheme }: LogoSettings): string {
  if (accentTheme === 'mint') {
    return iconPath(logoVariant === 'fold' ? 'icon-fold-mac.png' : 'icon-mac.png');
  }
  return iconPath(join('dock-icons', `${logoVariant}-${accentTheme}.png`));
}

export function applyRuntimeLogo(settings: LogoSettings, previous?: LogoSettings): void {
  const variantChanged = settings.logoVariant !== previous?.logoVariant;
  if (!variantChanged && settings.accentTheme === previous?.accentTheme) return;
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(getDockIconPath(settings));
  }
  if (!variantChanged) return;
  if (appContext.tray) {
    appContext.tray.setImage(getTrayIconPath(settings.logoVariant));
  }
  if (
    process.platform !== 'darwin' &&
    appContext.mainWindow &&
    !appContext.mainWindow.isDestroyed()
  ) {
    appContext.mainWindow.setIcon(getWindowIconPath(settings.logoVariant));
  }
}

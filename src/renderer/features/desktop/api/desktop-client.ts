import type { ElectronApi } from '../../../../shared/contracts/electron-api';

function bridge(): ElectronApi | undefined {
  return typeof window === 'undefined' ? undefined : window.electronAPI;
}

export const desktopClient = {
  platform: () => bridge()?.platform,
  minimize: () => bridge()?.window.minimize(),
  maximize: () => bridge()?.window.maximize(),
  close: () => bridge()?.window.close(),
  canReveal: () => Boolean(bridge()?.showItemInFolder),
  canOpenPath: () => Boolean(bridge()?.openPath),
  canOpenReport: () => Boolean(bridge()?.openGeneratedReport),
  canListRecentFiles: () => Boolean(bridge()?.artifacts?.listRecentFiles),
  listRecentFiles: (...args: Parameters<ElectronApi['artifacts']['listRecentFiles']>) =>
    bridge()?.artifacts?.listRecentFiles(...args),
  reveal: (path: string) => bridge()?.showItemInFolder?.(path),
  async openArtifact(path: string, cwd: string | undefined, isReport: boolean) {
    const api = bridge();
    const opened = api?.openPath
      ? await api.openPath(path, cwd)
      : isReport && (await api?.openGeneratedReport?.(path, cwd));
    return opened || Boolean(await api?.showItemInFolder?.(path, cwd));
  },
};

import type { ElectronApi } from '../../shared/contracts/electron-api';

/**
 * Check whether a typed namespace on `window.electronAPI` is available.
 */
export function isElectronNamespaceAvailable<K extends keyof ElectronApi>(namespace: K): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.[namespace]);
}

/**
 * Return a typed namespace from `window.electronAPI` or throw a clear error when unavailable.
 */
export function requireElectronNamespace<K extends keyof ElectronApi>(
  namespace: K
): NonNullable<ElectronApi[K]> {
  const bridge = typeof window !== 'undefined' ? window.electronAPI?.[namespace] : undefined;
  if (!bridge) {
    throw new Error(`Electron IPC namespace "${String(namespace)}" is unavailable`);
  }
  return bridge as NonNullable<ElectronApi[K]>;
}

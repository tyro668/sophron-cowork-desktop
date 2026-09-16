/**
 * Global Window declaration for the preload bridge. The canonical surface type
 * is `ElectronApi` in src/shared/contracts/electron-api.ts — the preload
 * implementation is checked against it via `satisfies`; renderer code consumes
 * `window.electronAPI` through this shared contract.
 */
import type { ElectronApi } from './electron-api';

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}

export {};

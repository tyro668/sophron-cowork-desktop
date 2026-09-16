/**
 * Global Window declaration for the preload bridge. The canonical surface type
 * is `ElectronApi` in src/shared/contracts/electron-api.ts — the preload
 * implementation is checked against it via `satisfies`.
 */
import type { ElectronApi } from '../shared/contracts/electron-api';

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}

export {};

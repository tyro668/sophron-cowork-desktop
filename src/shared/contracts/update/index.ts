/**
 * Cross-process update contracts. Shared by main, preload, and renderer.
 * Must not import from main/, renderer/, or preload/.
 */

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'
  | 'unsupported';

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  availableVersion?: string | null;
  percent?: number | null;
  transferred?: number | null;
  total?: number | null;
  bytesPerSecond?: number | null;
  error?: string | null;
  checkedAt?: number | null;
}

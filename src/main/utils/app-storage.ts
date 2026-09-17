import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { log, logWarn } from './logger';

const APP_STORAGE_DIR_NAME = 'agent';
const LEGACY_APP_STORAGE_DIR_NAME = 'claude';

/**
 * Returns the app-owned storage directory under userData (`<userData>/agent`).
 *
 * Older builds stored the same data under `<userData>/claude`. When the new
 * directory does not exist yet but the legacy one does, its contents are
 * copied (not moved) into the new location so existing skills/plugins keep
 * working; the legacy directory is left untouched.
 */
export function getAppStorageDir(): string {
  const userData = app.getPath('userData');
  const storageDir = path.join(userData, APP_STORAGE_DIR_NAME);
  const legacyDir = path.join(userData, LEGACY_APP_STORAGE_DIR_NAME);

  if (!fs.existsSync(storageDir) && fs.existsSync(legacyDir)) {
    try {
      fs.cpSync(legacyDir, storageDir, { recursive: true });
      log(`[AppStorage] Imported legacy app data from ${legacyDir} to ${storageDir}`);
    } catch (error) {
      logWarn(
        `[AppStorage] Failed to import legacy app data from ${legacyDir}; reading legacy location:`,
        error
      );
      return legacyDir;
    }
  }

  return storageDir;
}

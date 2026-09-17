import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { log, logWarn } from './logger';

const APP_STORAGE_DIR_NAME = 'agent';
const LEGACY_APP_STORAGE_DIR_NAME = 'claude';
const IMPORT_MARKER = '.legacy-import-complete';

/**
 * Copy files that exist in `src` but not yet in `dst` (never overwrites).
 * Returns the number of files copied; throws on the first copy error.
 */
function copyMissing(src: string, dst: string): number {
  let copied = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      if (!fs.existsSync(dstPath)) fs.mkdirSync(dstPath, { recursive: true });
      if (fs.statSync(dstPath).isDirectory()) {
        copied += copyMissing(srcPath, dstPath);
      }
      continue;
    }
    if (!entry.isFile() || fs.existsSync(dstPath)) continue;
    fs.copyFileSync(srcPath, dstPath);
    copied += 1;
  }
  return copied;
}

/**
 * Returns the app-owned storage directory under userData (`<userData>/agent`).
 *
 * Older builds stored the same data under `<userData>/claude`. Once, we
 * import files that exist only in the legacy directory (never overwriting
 * existing files, never modifying or deleting the legacy directory), then
 * write a marker so the import does not re-run. If the import fails partway,
 * it is retried on the next launch; this function always returns the new
 * path so writes never land back in the legacy directory.
 */
export function getAppStorageDir(): string {
  const userData = app.getPath('userData');
  const storageDir = path.join(userData, APP_STORAGE_DIR_NAME);
  const legacyDir = path.join(userData, LEGACY_APP_STORAGE_DIR_NAME);
  const markerPath = path.join(storageDir, IMPORT_MARKER);

  if (!fs.existsSync(markerPath) && fs.existsSync(legacyDir)) {
    try {
      fs.mkdirSync(storageDir, { recursive: true });
      const copied = copyMissing(legacyDir, storageDir);
      fs.writeFileSync(markerPath, new Date().toISOString());
      if (copied > 0) {
        log(`[AppStorage] Imported ${copied} file(s) from legacy ${legacyDir} to ${storageDir}`);
      }
    } catch (error) {
      logWarn(
        `[AppStorage] Failed to import legacy app data from ${legacyDir}; ` +
          'continuing with the new storage directory (legacy data left untouched, import retried on next launch):',
        error
      );
    }
  }

  return storageDir;
}

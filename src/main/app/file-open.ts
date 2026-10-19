import { execFileSync } from 'child_process';
import { app, shell } from 'electron';
import * as fs from 'fs';
import { join, resolve, dirname, isAbsolute, basename } from 'path';
import {
  isUncPath,
  isWindowsDrivePath,
  localPathFromFileUrl,
  decodePathSafely,
} from '../../shared/local-file-path';
import { log, logWarn, logError } from '../utils/logger';
import { prepareGeneratedReportForOpen } from '../utils/report-viewer';
import {
  DEFAULT_WORKING_DIR_NAME,
  LEGACY_DEFAULT_WORKING_DIR_NAME,
  getWorkingDir,
} from './workdir';

export function resolveFilePathForShell(filePath: string, cwd?: string, logScope = 'shell.path') {
  if (!filePath) {
    return null;
  }

  const trimInput = filePath.trim();
  if (!trimInput) {
    return null;
  }

  let normalizedPath = decodePathSafely(trimInput);

  if (normalizedPath.startsWith('file://')) {
    const localPath = localPathFromFileUrl(normalizedPath);
    if (!localPath) {
      logWarn(`[${logScope}] could not parse file URL:`, normalizedPath);
      return null;
    }
    normalizedPath = localPath;
  }

  const baseDir = cwd && isAbsolute(cwd) ? cwd : getWorkingDir() || app.getPath('home');
  if (
    !isAbsolute(normalizedPath) &&
    !isWindowsDrivePath(normalizedPath) &&
    !isUncPath(normalizedPath)
  ) {
    normalizedPath = resolve(baseDir, normalizedPath);
  }

  if (
    normalizedPath.startsWith('/workspace/') ||
    /^[A-Za-z]:[/\\]workspace[/\\]/i.test(normalizedPath)
  ) {
    const relativePart = normalizedPath.startsWith('/workspace/')
      ? normalizedPath.slice('/workspace/'.length)
      : normalizedPath.replace(/^[A-Za-z]:[/\\]workspace[/\\]/i, '');
    normalizedPath = resolve(baseDir, relativePart);
  }

  if (!isUncPath(normalizedPath)) {
    normalizedPath = resolve(normalizedPath);
  }

  return normalizedPath;
}

/** Breadth-first search for a file by name under the given roots (bounded). */
function findFileByName(fileName: string, roots: string[]): string | null {
  if (!fileName) {
    return null;
  }

  const visited = new Set<string>();
  const queue = roots
    .filter((root) => !!root)
    .map((root) => resolve(root))
    .filter((root) => fs.existsSync(root) && fs.statSync(root).isDirectory());

  let scannedDirs = 0;
  const MAX_DIRS = 2000;

  while (queue.length > 0 && scannedDirs < MAX_DIRS) {
    const dir = queue.shift()!;
    if (visited.has(dir)) {
      continue;
    }
    visited.add(dir);
    scannedDirs += 1;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isFile() && entry.name === fileName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        queue.push(fullPath);
      }
    }
  }

  return null;
}

function discoverFileByName(missingPath: string, cwd?: string): string | null {
  return findFileByName(basename(missingPath), [
    cwd || '',
    getWorkingDir() || '',
    join(app.getPath('userData'), DEFAULT_WORKING_DIR_NAME),
    join(app.getPath('userData'), LEGACY_DEFAULT_WORKING_DIR_NAME),
  ]);
}

/**
 * Open a local file (or folder) with the system default application.
 *
 * Artifact and chat file links used to call `shell.showItemInFolder`, which on
 * Linux without a D-Bus file manager degrades to `xdg-open <parent dir>`; the
 * user then saw the folder listing in the browser instead of the file.
 */
export async function openLocalFile(filePath: string, cwd?: string): Promise<boolean> {
  const requestedPath = resolveFilePathForShell(filePath, cwd, 'shell.openPath');
  if (!requestedPath) {
    return false;
  }

  try {
    let targetPath = requestedPath;
    if (!fs.existsSync(targetPath)) {
      const discoveredPath = discoverFileByName(targetPath, cwd);
      if (!discoveredPath) {
        logWarn('[shell.openPath] path does not exist:', targetPath);
        return false;
      }
      logWarn('[shell.openPath] resolved path not found, discovered by filename:', {
        requested: targetPath,
        discoveredPath,
      });
      targetPath = discoveredPath;
    }
    log('[shell.openPath] request:', { filePath, cwd, resolved: targetPath });

    if (fs.statSync(targetPath).isFile()) {
      const preparation = await prepareGeneratedReportForOpen(targetPath);
      if (preparation.prepared) {
        log('[shell.openPath] prepared report viewer controls:', preparation);
      }
    }

    const openResult = await shell.openPath(targetPath);
    if (openResult) {
      logWarn('[shell.openPath] openPath returned error:', openResult);
      return false;
    }
    return true;
  } catch (error) {
    logError('[shell.openPath] failed:', error);
    return false;
  }
}

export async function openGeneratedReport(filePath: string, cwd?: string): Promise<boolean> {
  const normalizedPath = resolveFilePathForShell(filePath, cwd, 'reports.openGeneratedReport');
  if (!normalizedPath) {
    return false;
  }

  log('[reports.openGeneratedReport] request:', { filePath, cwd, resolved: normalizedPath });

  try {
    if (!fs.existsSync(normalizedPath)) {
      logWarn('[reports.openGeneratedReport] path does not exist:', normalizedPath);
      return false;
    }

    const stat = fs.statSync(normalizedPath);
    if (stat.isDirectory()) {
      const openDirResult = await shell.openPath(normalizedPath);
      if (openDirResult) {
        logWarn(
          '[reports.openGeneratedReport] openPath directory returned warning:',
          openDirResult
        );
        return false;
      }
      return true;
    }

    const preparation = await prepareGeneratedReportForOpen(normalizedPath);
    if (preparation.prepared) {
      log('[reports.openGeneratedReport] prepared report viewer controls:', preparation);
    }

    const openResult = await shell.openPath(normalizedPath);
    if (openResult) {
      logWarn('[reports.openGeneratedReport] openPath returned warning:', openResult);
      return false;
    }

    return true;
  } catch (error) {
    logError('[reports.openGeneratedReport] failed:', error);
    return false;
  }
}

export async function revealFileInFolder(filePath: string, cwd?: string): Promise<boolean> {
  if (!filePath) {
    return false;
  }

  const trimInput = filePath.trim();
  if (!trimInput) {
    return false;
  }

  let normalizedPath = decodePathSafely(trimInput);

  if (normalizedPath.startsWith('file://')) {
    const localPath = localPathFromFileUrl(normalizedPath);
    if (!localPath) {
      logWarn('[shell.showItemInFolder] could not parse file URL:', normalizedPath);
      return false;
    }
    normalizedPath = localPath;
  }

  const baseDir = cwd && isAbsolute(cwd) ? cwd : getWorkingDir() || app.getPath('home');
  if (
    !isAbsolute(normalizedPath) &&
    !isWindowsDrivePath(normalizedPath) &&
    !isUncPath(normalizedPath)
  ) {
    normalizedPath = resolve(baseDir, normalizedPath);
  }

  if (
    normalizedPath.startsWith('/workspace/') ||
    /^[A-Za-z]:[/\\]workspace[/\\]/i.test(normalizedPath)
  ) {
    const relativePart = normalizedPath.startsWith('/workspace/')
      ? normalizedPath.slice('/workspace/'.length)
      : normalizedPath.replace(/^[A-Za-z]:[/\\]workspace[/\\]/i, '');
    normalizedPath = resolve(baseDir, relativePart);
  }

  if (!isUncPath(normalizedPath)) {
    normalizedPath = resolve(normalizedPath);
  }
  log('[shell.showItemInFolder] request:', { filePath, cwd, resolved: normalizedPath });

  try {
    if (fs.existsSync(normalizedPath)) {
      const stat = fs.statSync(normalizedPath);
      if (stat.isDirectory()) {
        const openDirResult = await shell.openPath(normalizedPath);
        if (openDirResult) {
          logWarn('[shell.showItemInFolder] openPath returned warning:', openDirResult);
        }
      } else {
        if (process.platform === 'darwin') {
          try {
            execFileSync('open', ['-R', normalizedPath]);
          } catch (error) {
            logWarn(
              '[shell.showItemInFolder] open -R failed, fallback to shell.showItemInFolder:',
              error
            );
            shell.showItemInFolder(normalizedPath);
          }
        } else {
          shell.showItemInFolder(normalizedPath);
        }
      }
      return true;
    }

    const discoveredPath = discoverFileByName(normalizedPath, cwd);

    if (discoveredPath) {
      logWarn('[shell.showItemInFolder] resolved path not found, discovered by filename:', {
        requested: normalizedPath,
        discoveredPath,
      });
      if (process.platform === 'darwin') {
        try {
          execFileSync('open', ['-R', discoveredPath]);
        } catch (error) {
          logWarn(
            '[shell.showItemInFolder] open -R discovered file failed, fallback to shell.showItemInFolder:',
            error
          );
          shell.showItemInFolder(discoveredPath);
        }
      } else {
        shell.showItemInFolder(discoveredPath);
      }
      return true;
    }

    const parentDir = dirname(normalizedPath);
    if (parentDir && fs.existsSync(parentDir)) {
      logWarn('[shell.showItemInFolder] file not found, opening parent directory:', parentDir);
      const openParentResult = await shell.openPath(parentDir);
      if (openParentResult) {
        logWarn('[shell.showItemInFolder] openPath parent returned warning:', openParentResult);
      }
      return true;
    }

    logWarn('[shell.showItemInFolder] path and parent directory do not exist:', normalizedPath);
    return false;
  } catch (error) {
    logError('[shell.showItemInFolder] failed:', error);
    return false;
  }
}

import { dialog, shell, type OpenDialogOptions } from 'electron';
import * as fs from 'fs';
import { isAbsolute } from 'path';
import type { DataRawTableSourceKind } from '../../../shared/contracts';
import { openGeneratedReport, revealFileInFolder } from '../../app/file-open';
import { handleIpc } from '../../ipc-handle';
import { logWarn } from '../../utils/logger';
import { listRecentWorkspaceFiles } from '../../utils/recent-workspace-files';

export function registerShellIpc(): void {
  handleIpc('shell.openExternal', async (_event, url: string) => {
    if (!url) {
      return false;
    }

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        logWarn('[shell.openExternal] Blocked URL with disallowed protocol:', parsed.protocol);
        return false;
      }
    } catch {
      logWarn('[shell.openExternal] Blocked invalid URL:', url);
      return false;
    }

    return shell.openExternal(url);
  });

  handleIpc('shell.showItemInFolder', async (_event, filePath: string, cwd?: string) => {
    return revealFileInFolder(filePath, cwd);
  });

  handleIpc('reports.openGeneratedReport', async (_event, filePath: string, cwd?: string) => {
    return openGeneratedReport(filePath, cwd);
  });

  handleIpc(
    'artifacts.listRecentFiles',
    async (_event, cwd: string, sinceMs: number, limit: number = 50) => {
      if (!cwd || !isAbsolute(cwd)) {
        return [];
      }
      return listRecentWorkspaceFiles(cwd, sinceMs, limit);
    }
  );

  handleIpc('dialog.selectFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Select Files',
    });

    if (result.canceled) {
      return [];
    }

    return result.filePaths;
  });

  handleIpc('dialog.selectRawTableSource', async (_event, kind?: DataRawTableSourceKind) => {
    const dialogOptions: OpenDialogOptions =
      kind === 'folder'
        ? {
            properties: ['openDirectory'],
            title: 'Select Input Table Folder',
          }
        : kind === 'excel'
          ? {
              properties: ['openFile'],
              title: 'Select Excel Input Table',
              filters: [
                { name: 'Excel', extensions: ['xlsx', 'xls'] },
                { name: 'All Files', extensions: ['*'] },
              ],
            }
          : kind === 'csv'
            ? {
                properties: ['openFile'],
                title: 'Select CSV Input Table',
                filters: [
                  { name: 'CSV or TSV', extensions: ['csv', 'tsv', 'tab'] },
                  { name: 'All Files', extensions: ['*'] },
                ],
              }
            : {
                properties: ['openFile', 'openDirectory'],
                title: 'Select Input Table Source',
                filters: [
                  { name: 'Excel or CSV', extensions: ['xlsx', 'xls', 'csv', 'tsv', 'tab'] },
                  { name: 'All Files', extensions: ['*'] },
                ],
              };
    const result = await dialog.showOpenDialog({
      ...dialogOptions,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedPath = result.filePaths[0];
    const stat = await fs.promises.stat(selectedPath);
    return {
      path: selectedPath,
      kind: stat.isDirectory()
        ? 'folder'
        : kind === 'excel' || kind === 'csv'
          ? kind
          : selectedPath.toLowerCase().match(/\.(xlsx|xls)$/)
            ? 'excel'
            : 'csv',
    };
  });
}

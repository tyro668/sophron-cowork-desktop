import { ipcRenderer } from 'electron';
import type { DataRawTableSourceKind, DataRawTableSourceSelection } from '../../shared/contracts';
import type { ElectronApi } from '../../shared/contracts/electron-api';

export function createShellApi(): Pick<
  ElectronApi,
  | 'openExternal'
  | 'showItemInFolder'
  | 'openGeneratedReport'
  | 'selectFiles'
  | 'selectRawTableSource'
  | 'artifacts'
> {
  return {
    openExternal: (url: string) => {
      // Sanitize mailto: URLs to strip dangerous query params that could attach files
      let safeUrl = url;
      if (/^mailto:/i.test(url)) {
        try {
          const parsed = new URL(url);
          parsed.searchParams.delete('attach');
          parsed.searchParams.delete('attachment');
          safeUrl = parsed.toString();
        } catch {
          // If URL parsing fails, block the call
          return Promise.resolve(false);
        }
      }
      return ipcRenderer.invoke('shell.openExternal', safeUrl);
    },

    showItemInFolder: (filePath: string, cwd?: string) =>
      ipcRenderer.invoke('shell.showItemInFolder', filePath, cwd),

    openGeneratedReport: (filePath: string, cwd?: string) =>
      ipcRenderer.invoke('reports.openGeneratedReport', filePath, cwd),

    // Select files using native dialog
    selectFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog.selectFiles'),

    selectRawTableSource: (
      kind?: DataRawTableSourceKind
    ): Promise<DataRawTableSourceSelection | null> =>
      ipcRenderer.invoke('dialog.selectRawTableSource', kind),

    artifacts: {
      listRecentFiles: (
        cwd: string,
        sinceMs: number,
        limit = 50
      ): Promise<Array<{ path: string; modifiedAt: number; size: number }>> =>
        ipcRenderer.invoke('artifacts.listRecentFiles', cwd, sinceMs, Math.min(limit, 500)),
    },
  };
}

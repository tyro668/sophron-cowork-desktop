import { dialog, type OpenDialogOptions } from 'electron';

import type { CloudConnectionActionResult } from '../../../shared/contracts';
import { appContext } from '../../app/context';
import { handleIpc } from '../../ipc-handle';
import { logError } from '../../utils/logger';
import { getCloudConnectionService, importCloudConnectionConfigFile } from './runtime';

async function run(action: () => unknown | Promise<unknown>): Promise<CloudConnectionActionResult> {
  const service = getCloudConnectionService();
  try {
    await action();
    return { success: true, state: service.getState() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('[CloudConnection]', message);
    return { success: false, error: message, state: service.getState() };
  }
}

async function showOpen(options: OpenDialogOptions): Promise<string[]> {
  const win = appContext.mainWindow;
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}

export function registerCloudConnectionIpc(): void {
  handleIpc('cloudConnection.getState', () => getCloudConnectionService().getState());

  handleIpc('cloudConnection.importConfig', () =>
    run(async () => {
      const [filePath] = await showOpen({
        properties: ['openFile'],
        filters: [{ name: 'config.yaml', extensions: ['yaml', 'yml'] }],
      });
      if (filePath) await importCloudConnectionConfigFile(filePath);
    })
  );

  handleIpc('cloudConnection.clearConfig', () =>
    run(() => getCloudConnectionService().clearConfig())
  );
  handleIpc('cloudConnection.connect', () => run(() => getCloudConnectionService().connect()));
  handleIpc('cloudConnection.disconnect', () =>
    run(() => getCloudConnectionService().disconnect())
  );
  handleIpc('cloudConnection.setAutoConnect', (_event, enabled: boolean) =>
    run(() => getCloudConnectionService().setAutoConnect(enabled))
  );
  handleIpc('cloudConnection.setSourceName', (_event, name: string) =>
    run(() => getCloudConnectionService().setSourceName(name))
  );

  handleIpc('cloudConnection.addFiles', () =>
    run(async () => {
      const files = await showOpen({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'xlsm', 'csv'] }],
      });
      if (files.length === 0) return;
      const rejected = await getCloudConnectionService().addFiles(files);
      if (rejected.length > 0) throw new Error(rejected.join('；'));
    })
  );

  handleIpc('cloudConnection.removeFile', (_event, filePath: string) =>
    run(() => getCloudConnectionService().removeFile(filePath))
  );
  handleIpc('cloudConnection.refreshFiles', () =>
    run(() => getCloudConnectionService().refreshFiles())
  );
  handleIpc('cloudConnection.previewFile', (_event, filePath: string) =>
    getCloudConnectionService().previewFile(filePath)
  );
}

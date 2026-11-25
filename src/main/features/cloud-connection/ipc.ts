import { dialog, type OpenDialogOptions } from 'electron';

import type {
  CloudConnectionActionResult,
  CloudConnectionGroupInput,
  CloudConnectionTableRefInput,
} from '../../../shared/contracts';
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
  handleIpc('cloudConnection.addGroup', (_event, input: CloudConnectionGroupInput) =>
    run(() => getCloudConnectionService().addGroup(input))
  );
  handleIpc('cloudConnection.updateGroup', (_event, id: string, input: CloudConnectionGroupInput) =>
    run(() => getCloudConnectionService().updateGroup(id, input))
  );
  handleIpc('cloudConnection.deleteGroup', (_event, id: string) =>
    run(() => getCloudConnectionService().deleteGroup(id))
  );
  handleIpc(
    'cloudConnection.addTableRefs',
    (_event, groupId: string, refs: CloudConnectionTableRefInput[]) =>
      run(() => getCloudConnectionService().addTableRefs(groupId, refs))
  );
  handleIpc(
    'cloudConnection.updateTableRef',
    (_event, groupId: string, reportName: string, input: { reportName: string }) =>
      run(() => getCloudConnectionService().updateTableRef(groupId, reportName, input))
  );
  handleIpc('cloudConnection.deleteTable', (_event, groupId: string, reportName: string) =>
    run(() => getCloudConnectionService().deleteTable(groupId, reportName))
  );
  handleIpc('cloudConnection.refreshTables', (_event, groupId?: string) =>
    run(() => getCloudConnectionService().refreshTables(groupId))
  );
  handleIpc('cloudConnection.previewTable', (_event, groupId: string, reportName: string) =>
    getCloudConnectionService().previewTable(groupId, reportName)
  );
}

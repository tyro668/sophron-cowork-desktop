import { dialog, type OpenDialogOptions } from 'electron';

import type {
  CloudConnectionActionResult,
  CloudConnectionGroupInput,
  CloudConnectionTableInput,
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
    'cloudConnection.saveTable',
    (_event, groupId: string, originalName: string | null, input: CloudConnectionTableInput) =>
      run(() => getCloudConnectionService().saveTable(groupId, originalName, input))
  );
  handleIpc('cloudConnection.deleteTable', (_event, groupId: string, tableName: string) =>
    run(() => getCloudConnectionService().deleteTable(groupId, tableName))
  );
  handleIpc('cloudConnection.removeLegacyFile', (_event, groupId: string, filePath: string) =>
    run(() => getCloudConnectionService().removeLegacyFile(groupId, filePath))
  );
  handleIpc('cloudConnection.refreshTables', (_event, groupId?: string) =>
    run(() => getCloudConnectionService().refreshTables(groupId))
  );
  handleIpc('cloudConnection.previewTable', (_event, groupId: string, tableId: string) =>
    getCloudConnectionService().previewTable(groupId, tableId)
  );
  handleIpc(
    'cloudConnection.previewDraft',
    (_event, groupId: string, originalName: string | null, input: CloudConnectionTableInput) =>
      getCloudConnectionService().previewDraft(groupId, originalName, input)
  );
  handleIpc('cloudConnection.pickDirectory', async () => {
    const [dir] = await showOpen({ properties: ['openDirectory'] });
    return dir ?? null;
  });
  handleIpc(
    'cloudConnection.pickTablePath',
    async (_event, groupId: string, kind: 'file' | 'directory') => {
      const service = getCloudConnectionService();
      const group = service.getState().groups.find((g) => g.id === groupId);
      const [picked] = await showOpen({
        defaultPath: group?.directoryPath || undefined,
        properties: [kind === 'directory' ? 'openDirectory' : 'openFile'],
        filters:
          kind === 'file'
            ? [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }]
            : undefined,
      });
      return picked ? service.relativePathInGroup(groupId, picked) : null;
    }
  );
}

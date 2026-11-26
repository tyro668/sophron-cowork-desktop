/**
 * 云连接服务的进程内单例与生命周期（bootstrap 启动、退出时断开）。
 */
import { readFile } from 'node:fs/promises';

import type { CloudConnectionState } from '../../../shared/contracts';
import { appContext } from '../../app/context';
import { createAppLocalAgentLogger } from '../../local-agent/app-logger';
import { requireDataPipelineStore } from '../data/service';
import { createCloudTableStoreAdapter } from './referenced-source';
import { CloudConnectionService } from './service';
import { setRawTableDeletedHook } from '../../data/store/raw-table-deleted-hook';
import { ElectronCloudConnectionStore } from './store';

let service: CloudConnectionService | null = null;

function broadcast(state: CloudConnectionState): void {
  const win = appContext.mainWindow;
  if (win && !win.isDestroyed()) win.webContents.send('cloudConnection.state', state);
}

export function getCloudConnectionService(): CloudConnectionService {
  if (!service) {
    service = new CloudConnectionService({
      store: new ElectronCloudConnectionStore(),
      logger: createAppLocalAgentLogger(),
      notify: broadcast,
      tableStore: createCloudTableStoreAdapter(() => requireDataPipelineStore()),
    });
    setRawTableDeletedHook((ids) => service!.pruneRefsForDeletedTables(ids));
  }
  return service;
}

export async function importCloudConnectionConfigFile(filePath: string): Promise<void> {
  const text = await readFile(filePath, 'utf8');
  getCloudConnectionService().importConfigText(text, filePath);
}

export function startCloudConnection(): void {
  getCloudConnectionService().start();
}

export function stopCloudConnection(): void {
  service?.stop();
}

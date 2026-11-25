import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const dialogResult = { canceled: false, filePaths: [] as string[] };

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getVersion: () => '0.0.0-test' },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, fn),
  },
  dialog: { showOpenDialog: vi.fn(async () => dialogResult) },
}));

vi.mock('../../src/main/app/context', () => ({ appContext: { mainWindow: null } }));
vi.mock('../../src/main/utils/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  log: vi.fn(),
}));

const { MemoryCloudConnectionStore, CloudConnectionService } =
  await import('../../src/main/features/cloud-connection/service');
const { silentLocalAgentLogger } = await import('../../src/main/local-agent/logger');
const service = new CloudConnectionService({
  store: new MemoryCloudConnectionStore(),
  logger: silentLocalAgentLogger,
});
const importFile = vi.fn(async (_path: string) => {});
vi.mock('../../src/main/features/cloud-connection/runtime', () => ({
  getCloudConnectionService: () => service,
  importCloudConnectionConfigFile: (p: string) => importFile(p),
}));

const { registerCloudConnectionIpc } = await import('../../src/main/features/cloud-connection/ipc');
const { IPC_INPUT_SCHEMAS } = await import('../../src/shared/contracts/ipc/schemas');

const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

describe('cloudConnection IPC', () => {
  beforeEach(() => {
    handlers.clear();
    registerCloudConnectionIpc();
  });

  it('registers every channel with an input schema', () => {
    const channels = [...handlers.keys()];
    expect(channels.sort()).toEqual(
      Object.keys(IPC_INPUT_SCHEMAS)
        .filter((c) => c.startsWith('cloudConnection.'))
        .sort()
    );
  });

  it('returns state and wraps failures as { success: false }', async () => {
    expect(await invoke('cloudConnection.getState')).toMatchObject({
      configured: false,
      status: 'idle',
    });
    const result = (await invoke('cloudConnection.connect')) as {
      success: boolean;
      error?: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toContain('config.yaml');
  });

  it('validates arguments', async () => {
    await expect(invoke('cloudConnection.setAutoConnect', 'yes')).rejects.toThrow();
    await expect(invoke('cloudConnection.previewTable', 'g', 42)).rejects.toThrow();
    await expect(
      invoke('cloudConnection.addGroup', { sourceName: 'x', directoryPath: '/', strategy: 7 })
    ).rejects.toThrow();
    await expect(
      invoke('cloudConnection.saveTable', 'g', null, { tableName: 't', strategy: 9 })
    ).rejects.toThrow();
    await expect(invoke('cloudConnection.pickTablePath', 'g', 'other')).rejects.toThrow();
    expect(
      await invoke('cloudConnection.addGroup', {
        sourceName: 'a&b',
        directoryPath: '/',
        strategy: 1,
      })
    ).toMatchObject({ success: false, error: '分组名称不能出现&' });
    expect(await invoke('cloudConnection.setAutoConnect', true)).toMatchObject({
      success: true,
      state: { autoConnect: true },
    });
  });

  it('imports the config file picked in the dialog', async () => {
    dialogResult.filePaths = ['/tmp/config.yaml'];
    expect(await invoke('cloudConnection.importConfig')).toMatchObject({ success: true });
    expect(importFile).toHaveBeenCalledWith('/tmp/config.yaml');
  });
});

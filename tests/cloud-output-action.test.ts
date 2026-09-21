import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudAnalysisCommandService } from '../src/main/data/cloud-analysis-command-service';
import type { DataTaskStore } from '../src/main/data/data-task-store';
import type { CloudOutputAction } from '../src/shared/personal-analysis-types';

const { syncDriveCsv } = vi.hoisted(() => ({ syncDriveCsv: vi.fn() }));
vi.mock('../src/main/data/personal-analysis-client', () => ({
  createPersonalAnalysisClient: () => ({ syncDriveCsv }),
}));

function fixture() {
  let action: CloudOutputAction | null = {
    type: 'drive_file',
    trigger: 'on_change',
    spaceId: 's',
    projectId: 'p',
    fileId: 'old-file',
    version: 1,
  };
  const getOutputTableRecord = vi.fn(async () => ({
    id: 'out',
    name: 'result',
    cloudAction: action && { ...action },
  }));
  const updateOutputTableCloudAction = vi.fn(
    async (_id: string, next: CloudOutputAction | null) => {
      action = next && { ...next };
      return getOutputTableRecord();
    }
  );
  const store = {
    getOutputTableRecord,
    updateOutputTableCloudAction,
    exportDatasetCsv: vi.fn(async () => ({ csv: 'name,value\na,1\n' })),
  };
  const service = new CloudAnalysisCommandService(
    store as unknown as DataTaskStore,
    () => ({ apiOrigin: 'http://mock.local', apiKey: 'key', updatedAt: 0 }),
    { createInputTable: vi.fn() }
  );
  syncDriveCsv.mockResolvedValue({ file: { fileId: 'old-file', fileName: 'a.csv', version: 2 } });
  return { service, store, action: () => action };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cloud output action consistency', () => {
  it('reports persistence failure and recovers the remote version before the next upload', async () => {
    const { service, store, action } = fixture();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const save = store.updateOutputTableCloudAction.getMockImplementation()!;
    store.updateOutputTableCloudAction.mockRejectedValue(new Error('disk write failure'));
    await expect(service.runOutputTableCloudAction({ outputTableId: 'out' })).rejects.toThrow(
      'disk write failure'
    );
    expect(action()?.version).toBe(1);
    await expect(service.runOutputTableCloudAction({ outputTableId: 'out' })).rejects.toThrow(
      'disk write failure'
    );
    expect(syncDriveCsv).toHaveBeenCalledTimes(1);
    store.updateOutputTableCloudAction.mockImplementation(save);
    syncDriveCsv.mockResolvedValue({ file: { fileId: 'old-file', fileName: 'a.csv', version: 3 } });
    await service.runOutputTableCloudAction({ outputTableId: 'out' });
    expect(syncDriveCsv.mock.calls[1][2].expectedVersion).toBe(2);
    expect(action()?.version).toBe(3);
    expect(action()?.lastError).toBeUndefined();
  });

  it.each(['remove', 'replace'] as const)(
    'does not undo %s while a sync is in flight',
    async (operation) => {
      const { service, action } = fixture();
      const entered = deferred();
      const release = deferred();
      syncDriveCsv.mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        return { file: { fileId: 'old-file', fileName: 'a.csv', version: 2 } };
      });
      const running = service.runOutputTableCloudAction({ outputTableId: 'out' });
      await entered.promise;
      const replacement =
        operation === 'remove'
          ? null
          : {
              type: 'drive_file' as const,
              trigger: 'on_change' as const,
              spaceId: 's',
              projectId: 'p',
              fileId: 'new-file',
            };
      const saving = service.setOutputTableCloudAction({
        outputTableId: 'out',
        action: replacement,
      });
      release.resolve();
      await Promise.all([running, saving]);
      expect(action()).toEqual(replacement);
    }
  );

  it('allows removing a binding after a failed save without restoring its pending state', async () => {
    const { service, store, action } = fixture();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const save = store.updateOutputTableCloudAction.getMockImplementation()!;
    store.updateOutputTableCloudAction.mockRejectedValue(new Error('disk write failure'));
    await expect(service.runOutputTableCloudAction({ outputTableId: 'out' })).rejects.toThrow();
    store.updateOutputTableCloudAction.mockImplementation(save);
    await service.setOutputTableCloudAction({ outputTableId: 'out', action: null });
    await expect(service.runOutputTableCloudAction({ outputTableId: 'out' })).rejects.toThrow(
      'has no cloud action'
    );
    expect(action()).toBeNull();
    expect(syncDriveCsv).toHaveBeenCalledTimes(1);
  });
});

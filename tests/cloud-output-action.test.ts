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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('cloud output action consistency', () => {
  it('restores persisted schedules on a fresh service and triggers at the configured time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 6, 8, 59, 59));
    const { service, store } = fixture();
    const action: CloudOutputAction = {
      type: 'drive_file',
      trigger: 'schedule',
      spaceId: 's',
      projectId: 'p',
      fileId: 'old-file',
      schedule: { kind: 'daily', times: ['09:00'] },
    };
    await store.updateOutputTableCloudAction('out', action);
    Object.assign(store, {
      listOutputTableCloudActions: vi.fn(async () => [{ id: 'out', action }]),
    });
    await service.ensureActionTimersArmed();
    await service.ensureActionTimersArmed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(syncDriveCsv).toHaveBeenCalledTimes(1);
    await service.setOutputTableCloudAction({ outputTableId: 'out', action: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not restore a stale startup schedule after the action is removed', async () => {
    vi.useFakeTimers();
    const { service, store } = fixture();
    const gate = deferred();
    Object.assign(store, {
      listOutputTableCloudActions: vi.fn(async () => {
        await gate.promise;
        return [
          {
            id: 'out',
            action: {
              type: 'drive_file',
              trigger: 'schedule',
              schedule: { kind: 'daily', times: ['09:00'] },
            },
          },
        ];
      }),
    });
    const restoring = service.ensureActionTimersArmed();
    await service.setOutputTableCloudAction({ outputTableId: 'out', action: null });
    gate.resolve();
    await restoring;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries failed startup restoration without requiring an output commit', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service, store } = fixture();
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('database temporarily unavailable'))
      .mockResolvedValue([]);
    Object.assign(store, { listOutputTableCloudActions: list });
    await service.ensureActionTimersArmed();
    await vi.advanceTimersByTimeAsync(5000);
    expect(list).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

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

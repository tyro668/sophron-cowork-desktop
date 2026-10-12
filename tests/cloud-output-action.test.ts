import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudAnalysisCommandService } from '../src/main/data/cloud-analysis-command-service';
import type { DataPipelineStore } from '../src/main/data/data-pipeline-store';
import type { DataCommandService } from '../src/main/data/data-command-service';
import { registerCloudSyncAction } from '../src/main/automation/cloud-sync-action';
import {
  AutomationActionRegistry,
  type AutomationRunContext,
} from '../src/main/automation/automation-action-registry';
import type { AutomationStore } from '../src/main/automation/automation-store';
import type { Automation } from '../src/shared/automation/types';

const { syncDriveCsv, uploadCsv, previewDriveFile, downloadDriveCsv } = vi.hoisted(() => ({
  syncDriveCsv: vi.fn(),
  uploadCsv: vi.fn(),
  previewDriveFile: vi.fn(),
  downloadDriveCsv: vi.fn(),
}));
vi.mock('../src/main/data/personal-analysis-client', () => ({
  createPersonalAnalysisClient: () => ({
    syncDriveCsv,
    uploadCsv,
    previewDriveFile,
    downloadDriveCsv,
    listDatasources: async () => [{ datasourceId: 'ds' }],
  }),
}));
const config = {
  direction: 'output' as const,
  resultTableId: 'out',
  type: 'drive_file' as const,
  spaceId: 's',
  projectId: 'p',
  fileId: 'file',
  version: 1,
};
const context: AutomationRunContext = {
  automationId: 'auto',
  runId: 'run',
  now: 1,
  outputs: new Map(),
  emitArtifact: vi.fn(),
  log: vi.fn(),
};
function fixture() {
  let current = {
    id: 'auto',
    name: 'sync',
    actionGraph: {
      version: 1,
      edges: [],
      nodes: [{ id: 'sync', type: 'cloud.sync', enabled: true, config: { ...config } }],
    },
  } as unknown as Automation;
  const update = vi.fn((_id, changes) => {
    current = { ...current, ...changes };
    return current;
  });
  const store = { get: () => current, update } as unknown as AutomationStore;
  const sync = vi.fn(async () => ({ fileId: 'file', version: 2 }));
  const registry = new AutomationActionRegistry();
  registerCloudSyncAction(
    registry,
    { syncResultTableToCloud: sync } as unknown as DataCommandService,
    store
  );
  const action = registry.get('cloud.sync')!;
  const run = () =>
    action.execute(current.actionGraph.nodes[0].config, context, current.actionGraph.nodes[0]);
  return { run, sync, update, get: () => current, action };
}
beforeEach(() => {
  vi.clearAllMocks();
  previewDriveFile.mockResolvedValue({
    file: { fileId: 'file', fileType: 'csv', writable: true, version: 1 },
  });
});
describe('automation cloud output action', () => {
  it('saves the returned identity/version on the automation for subsequent runs', async () => {
    const f = fixture();
    await f.run();
    expect(f.get().actionGraph.nodes[0].config.version).toBe(2);
    await f.run();
    expect(f.sync.mock.calls[1]).toEqual([
      'out',
      expect.objectContaining({ fileId: 'file', version: 2 }),
      'automation-auto-sync',
      expect.any(Function),
    ]);
  });
  it('recovers a failed local save before making another remote write', async () => {
    const f = fixture();
    const save = f.update.getMockImplementation()!;
    f.update.mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(f.run()).rejects.toThrow('disk full');
    await expect(f.run()).rejects.toThrow('disk full');
    expect(f.sync).toHaveBeenCalledTimes(1);
    f.update.mockImplementation(save);
    await f.run();
    expect(f.sync).toHaveBeenCalledTimes(1);
    expect(f.get().actionGraph.nodes[0].config.version).toBe(2);
  });
  it('does not overwrite a destination edited during a remote request', async () => {
    const f = fixture();
    f.sync.mockImplementation(async () => {
      f.get().actionGraph.nodes[0].config.fileId = 'different-file';
      return { fileId: 'file', version: 2 };
    });
    await f.run();
    expect(f.get().actionGraph.nodes[0].config.fileId).toBe('different-file');
    expect(f.update).not.toHaveBeenCalled();
  });
  it('rejects missing output table or cloud destination configuration', () => {
    expect(() => fixture().action.validate?.({ resultTableId: 'out' })).toThrow();
  });
  it('syncs drive Csv using the saved optimistic version without table-side configuration', async () => {
    syncDriveCsv.mockResolvedValue({
      file: { fileId: 'file', fileName: 'result.csv', version: 2 },
    });
    const store = {
      getResultTableRecord: async () => ({ id: 'out', name: 'result' }),
      exportRawTableCsv: async () => ({ csv: 'id\n1', name: 'result' }),
    } as unknown as DataPipelineStore;
    const service = new CloudAnalysisCommandService(
      store,
      () => ({ apiOrigin: 'https://example.com', apiKey: 'key', updatedAt: 0 }),
      { createRawTable: vi.fn() }
    );
    expect(await service.syncResultTableToCloud('out', config)).toEqual({
      fileId: 'file',
      fileName: 'result.csv',
      version: 2,
      writeMode: 'replace',
    });
    expect(syncDriveCsv).toHaveBeenCalledWith(
      's',
      'p',
      expect.objectContaining({ expectedVersion: 1, csvContent: 'id\n1' })
    );
  });
  it('rejects legacy cloud table destinations before exporting or uploading', async () => {
    const f = fixture();
    expect(() => f.action.validate?.({ ...config, type: 'cloud_table' })).toThrow();
    expect(() =>
      f.action.validate?.({ ...config, fileId: undefined, writeMode: 'append' })
    ).toThrow();
    expect(() => f.action.validate?.({ ...config, writeMode: 'create' })).toThrow();
  });
  it('creates a drive file with a stable key, then stores a replace binding', async () => {
    syncDriveCsv.mockResolvedValue({ file: { fileId: 'new', fileName: 'result.csv', version: 1 } });
    const service = outputService();
    const saved = await service.syncResultTableToCloud(
      'out',
      { ...config, fileId: undefined, version: undefined, writeMode: 'create' },
      'stable'
    );
    expect(saved).toMatchObject({ fileId: 'new', writeMode: 'replace', version: 1 });
    expect(syncDriveCsv).toHaveBeenCalledWith(
      's',
      'p',
      expect.objectContaining({ outputId: 'stable', expectedVersion: 0, fileName: 'result.csv' })
    );
    expect(uploadCsv).not.toHaveBeenCalled();
  });
  it('appends the full file with aligned columns and persists the base version before writing', async () => {
    downloadDriveCsv.mockResolvedValue('name,id\r\n"a,b",001\r\n"two\nlines",002\r\n');
    const before = vi.fn();
    syncDriveCsv.mockImplementationOnce(async () => {
      expect(before).toHaveBeenCalledWith(1);
      return { file: { fileId: 'file', fileName: 'result.csv', version: 2 } };
    });
    await outputService('id,name\n003,new').syncResultTableToCloud(
      'out',
      { ...config, writeMode: 'append' },
      'stable',
      before
    );
    expect(syncDriveCsv).toHaveBeenCalledWith(
      's',
      'p',
      expect.objectContaining({
        expectedVersion: 1,
        csvContent: 'name,id\r\n"a,b",001\r\n"two\nlines",002\r\nnew,003\r\n',
      })
    );
  });
  it('does not write on a changed version, incompatible schema or Excel target', async () => {
    const service = outputService();
    await expect(
      service.syncResultTableToCloud('out', { ...config, version: 0, writeMode: 'append' })
    ).rejects.toThrow('changed');
    downloadDriveCsv.mockResolvedValue('other\n1');
    await expect(
      service.syncResultTableToCloud('out', { ...config, writeMode: 'append' })
    ).rejects.toThrow('columns do not match');
    previewDriveFile.mockResolvedValueOnce({ file: { fileType: 'excel', version: 1 } });
    await expect(service.syncResultTableToCloud('out', config)).rejects.toThrow('Csv');
    expect(syncDriveCsv).not.toHaveBeenCalled();
  });
});
function outputService(csv = 'id\n1') {
  return new CloudAnalysisCommandService(
    {
      getResultTableRecord: async () => ({ id: 'out', name: 'result' }),
      exportRawTableCsv: async () => ({ csv, name: 'result' }),
    } as unknown as DataPipelineStore,
    () => ({ apiOrigin: 'https://example.com', apiKey: 'key', updatedAt: 0 }),
    { createRawTable: vi.fn() }
  );
}

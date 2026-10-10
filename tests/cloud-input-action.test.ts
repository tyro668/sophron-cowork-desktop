import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../src/main/data/data-pipeline-store';
import { RawTablesCommandService } from '../src/main/data/raw-tables-command-service';
import { CloudAnalysisCommandService } from '../src/main/data/cloud-analysis-command-service';
import { cloudInputSyncSchema } from '../src/shared/automation/cloud-sync';
import { registerCloudSyncAction } from '../src/main/automation/cloud-sync-action';
import {
  AutomationActionRegistry,
  type AutomationRunContext,
} from '../src/main/automation/automation-action-registry';
import type { DataCommandService } from '../src/main/data/data-command-service';
import type { AutomationStore } from '../src/main/automation/automation-store';
import type { Automation } from '../src/shared/automation/types';

const { findTable, exportTableCsv } = vi.hoisted(() => ({
  findTable: vi.fn(),
  exportTableCsv: vi.fn(),
}));
vi.mock('../src/main/data/personal-analysis-client', () => ({
  createPersonalAnalysisClient: () => ({ findTable, exportTableCsv }),
}));
const config = {
  direction: 'input' as const,
  spaceId: 's',
  projectId: 'p',
  tableId: 'remote',
  tableKind: 'analysis' as const,
  rawTableName: 'Sales',
};
let store: DataPipelineStore;
let directory: string;
beforeEach(() => {
  vi.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'cloud-input-sync-'));
  store = createDataPipelineStore(join(directory, 'data.duckdb'));
  findTable.mockResolvedValue({
    tableId: 'remote',
    tableName: 'Remote sales',
    kind: 'analysis',
    updatedAt: '2026-09-22',
  });
  exportTableCsv.mockResolvedValue('id,amount\n1,20\n2,40\n');
});
afterEach(async () => {
  await store.close();
  rmSync(directory, { recursive: true, force: true });
});
async function cloudMirrorOf(rawTableId: string) {
  const rawTable = await store.getRawTableRecord(rawTableId);
  return rawTable?.inputConfig.sourceKind === 'cloud'
    ? rawTable.inputConfig.cloudMirror
    : undefined;
}

function service(cloudImportDir?: string) {
  const input = new RawTablesCommandService(store, {} as never);
  return new CloudAnalysisCommandService(
    store,
    () => ({ apiOrigin: 'https://example.com', apiKey: 'key', updatedAt: 0 }),
    {
      createRawTable: (command) => input.createRawTable(command),
      updateRawTable: (command) => input.updateRawTable(command),
      cloudImportDir,
    }
  );
}
describe('cloud input table automation', () => {
  it.each(['analysis', 'base'] as const)(
    'imports full %s tables and synchronizes the same local input after restart',
    async (tableKind) => {
      findTable.mockResolvedValue({ tableId: 'remote', kind: tableKind });
      exportTableCsv.mockResolvedValue(
        'id,amount\n' + Array.from({ length: 123 }, (_, i) => `${i},20`).join('\n')
      );
      const original = { ...config, tableKind };
      const created = await service().syncRawTableFromCloud(original, 'key_%"');
      expect((await store.getRawTableRecord(created.rawTableId))?.rowCount).toBe(123);
      await store.updateRawTable({ id: created.rawTableId, name: 'Renamed sales' });
      await store.close();
      store = createDataPipelineStore(join(directory, 'data.duckdb'));
      exportTableCsv.mockResolvedValue('id,amount\n7,99\n');
      // Simulate a crash before the created ID could be saved on the automation.
      const recovered = await service().syncRawTableFromCloud(original, 'key_%"');
      expect(recovered).toEqual({
        rawTableId: created.rawTableId,
        rawTableName: 'Renamed sales',
      });
      expect((await store.getDashboard()).totalRawTables).toBe(1);
      expect((await store.getRawTableRecord(created.rawTableId))?.rowCount).toBe(1);
      expect(findTable).toHaveBeenCalledWith('s', 'p', 'remote');
      const mirror = await cloudMirrorOf(created.rawTableId);
      expect(mirror).toMatchObject({
        tableId: 'remote',
        spaceId: 's',
        projectId: 'p',
        tableKind,
        automationSyncKey: 'key_%"',
      });
      expect(mirror?.syncedAt).toEqual(expect.any(Number));
    }
  );
  it('persists full cloud provenance on manual import and keeps a stable snapshot file', async () => {
    const importDir = join(directory, 'cloud-imports');
    const result = await service(importDir).importCloudRawTable({
      tableId: 'remote',
      spaceId: 's',
      projectId: 'p',
      spaceName: 'Alpha space',
      projectName: 'Beta project',
      name: 'Imported sales',
    });
    const rawTable = result.rawTable;
    expect(rawTable.sourceKind).toBe('cloud');
    expect(rawTable.inputConfig.sourceKind).toBe('cloud');
    expect(rawTable.sourcePath.startsWith(importDir)).toBe(true);
    expect(existsSync(rawTable.sourcePath)).toBe(true);
    const mirror = await cloudMirrorOf(rawTable.id);
    expect(mirror).toMatchObject({
      tableId: 'remote',
      spaceId: 's',
      projectId: 'p',
      spaceName: 'Alpha space',
      projectName: 'Beta project',
      tableKind: 'analysis',
      tableName: 'Remote sales',
      sourceVersion: '2026-09-22',
    });
    expect(mirror?.syncedAt).toEqual(expect.any(Number));
    expect(mirror?.contentHash).toEqual(expect.any(String));
    // The snapshot path survives OS temp cleanup semantics — reimports of the
    // stored source keep working (sourcePath stays valid inside the store dir).
    await store.updateRawTable({
      id: rawTable.id,
      config: rawTable.inputConfig,
    });
    expect((await store.getRawTableRecord(rawTable.id))?.rowCount).toBe(2);
  });
  it('re-downloads the snapshot on manual refresh and preserves table identity', async () => {
    const importDir = join(directory, 'cloud-imports');
    const created = await service(importDir).importCloudRawTable({
      tableId: 'remote',
      spaceId: 's',
      projectId: 'p',
      name: 'Imported sales',
    });
    const firstMirror = await cloudMirrorOf(created.rawTable.id);
    exportTableCsv.mockResolvedValue('id,amount\n9,99\n');
    findTable.mockResolvedValue({
      tableId: 'remote',
      tableName: 'Remote sales v2',
      kind: 'analysis',
      updatedAt: '2026-09-23',
    });
    const refreshed = await service(importDir).refreshCloudRawTable({
      rawTableId: created.rawTable.id,
    });
    expect(refreshed.rawTable.id).toBe(created.rawTable.id);
    expect(refreshed.rawTable.rowCount).toBe(1);
    const mirror = await cloudMirrorOf(created.rawTable.id);
    expect(mirror?.sourceVersion).toBe('2026-09-23');
    expect(mirror?.tableName).toBe('Remote sales v2');
    expect((mirror?.syncedAt ?? 0) >= (firstMirror?.syncedAt ?? 0)).toBe(true);
    expect((await store.getDashboard()).totalRawTables).toBe(1);
  });
  it('rebinds an existing input by cloud identity and keeps its pipeline references', async () => {
    const created = await service().importCloudRawTable({
      tableId: 'remote',
      spaceId: 's',
      projectId: 'p',
      spaceName: 'Alpha',
      projectName: 'Beta',
      name: 'Sales',
    });
    const pipeline = await store.createPipeline({
      name: 'Process sales',
      sourceRawTableId: created.rawTable.id,
    });
    findTable.mockResolvedValue({ tableId: 'next', tableName: 'Next table', kind: 'base' });
    exportTableCsv.mockResolvedValue('id,amount\n3,100\n');
    const rebound = await service().importCloudRawTable({
      rawTableId: created.rawTable.id,
      tableId: 'next',
      spaceId: 's2',
      projectId: 'p2',
      spaceName: 'Gamma',
      projectName: 'Delta',
    });
    expect(rebound.rawTable).toMatchObject({
      id: created.rawTable.id,
      name: 'Sales',
      sourceKind: 'cloud',
      rowCount: 1,
    });
    expect((await store.getPipeline(pipeline.id))?.sourceRawTableId).toBe(created.rawTable.id);
    expect(await cloudMirrorOf(created.rawTable.id)).toMatchObject({
      tableId: 'next',
      spaceId: 's2',
      spaceName: 'Gamma',
      projectName: 'Delta',
    });
    await service().refreshCloudRawTable({ rawTableId: created.rawTable.id });
    expect(await cloudMirrorOf(created.rawTable.id)).toMatchObject({
      spaceName: 'Gamma',
      projectName: 'Delta',
    });
    expect((await store.getDashboard()).totalRawTables).toBe(1);
    await expect(
      store.updateRawTable({
        id: created.rawTable.id,
        config: {
          sourceKind: 'cloud',
          cloudMirror: { tableId: 'unfetched', contentHash: '' },
        },
      })
    ).rejects.toThrow('Use cloud import');
    expect((await cloudMirrorOf(created.rawTable.id))?.tableId).toBe('next');
  });
  it('leaves the old cloud binding intact when a replacement cannot be downloaded', async () => {
    const created = await service().importCloudRawTable({
      tableId: 'remote',
      spaceId: 's',
      projectId: 'p',
    });
    exportTableCsv.mockRejectedValueOnce(new Error('Cloud unavailable'));
    await expect(
      service().importCloudRawTable({
        rawTableId: created.rawTable.id,
        tableId: 'next',
        spaceId: 's',
        projectId: 'p',
      })
    ).rejects.toThrow('Cloud unavailable');
    expect((await cloudMirrorOf(created.rawTable.id))?.tableId).toBe('remote');
    expect((await store.getRawTableRecord(created.rawTable.id))?.rowCount).toBe(2);
  });
  it('rejects refresh for non-cloud tables and incomplete legacy linkage', async () => {
    writeFileSync(join(directory, 'local.csv'), 'id\n1\n');
    writeFileSync(join(directory, 'legacy.csv'), 'id\n2\n');
    const plain = await store.importRawTable({
      filePath: join(directory, 'local.csv'),
      sourceKind: 'csv',
      name: 'Local file',
    });
    await expect(service().refreshCloudRawTable({ rawTableId: plain.id })).rejects.toThrow(
      'not linked to a cloud table'
    );
    const legacy = await store.importRawTable({
      filePath: join(directory, 'legacy.csv'),
      sourceKind: 'csv',
      name: 'Legacy mirror',
      config: {
        sourceKind: 'csv',
        header: 'auto',
        dataRegion: 'auto',
        encoding: 'auto',
        delimiter: 'auto',
        cloudMirror: { tableId: 'remote', contentHash: 'abc' },
      },
    });
    await expect(service().refreshCloudRawTable({ rawTableId: legacy.id })).rejects.toThrow(
      'linkage is incomplete'
    );
  });
  it('rejects other project sources, wrong kinds, and deleted targets without creating replacements', async () => {
    findTable.mockResolvedValueOnce(undefined);
    await expect(service().syncRawTableFromCloud(config, 'key')).rejects.toThrow(
      'configured project'
    );
    findTable.mockResolvedValueOnce({ tableId: 'remote', kind: 'base' });
    await expect(service().syncRawTableFromCloud(config, 'key')).rejects.toThrow(
      'configured project'
    );
    await expect(
      service().syncRawTableFromCloud({ ...config, rawTableId: 'deleted' }, 'key')
    ).rejects.toThrow('not found');
    expect(exportTableCsv).not.toHaveBeenCalled();
    expect((await store.getDashboard()).totalRawTables).toBe(0);
  });
  it('does not overwrite an unrelated same-name input during creation', async () => {
    await service().syncRawTableFromCloud(config, 'one');
    await expect(service().syncRawTableFromCloud(config, 'two')).rejects.toThrow();
    expect((await store.getDashboard()).totalRawTables).toBe(1);
  });
  it('requires a real source kind and a local destination', () => {
    expect(cloudInputSyncSchema.safeParse({ ...config, tableKind: 'drive' }).success).toBe(false);
    expect(cloudInputSyncSchema.safeParse({ ...config, rawTableName: '' }).success).toBe(false);
  });
  it('saves the created input association and exposes it to later actions', async () => {
    let automation = {
      id: 'auto',
      actionGraph: {
        version: 1,
        edges: [],
        nodes: [{ id: 'sync', type: 'cloud.sync', enabled: true, config }],
      },
    } as unknown as Automation;
    const save = vi.fn((_id, patch) => {
      automation = { ...automation, ...patch };
      return automation;
    });
    const commands = {
      syncRawTableFromCloud: vi.fn(async () => ({
        rawTableId: 'local',
        rawTableName: 'Sales',
      })),
    };
    const registry = new AutomationActionRegistry();
    registerCloudSyncAction(
      registry,
      commands as unknown as DataCommandService,
      { get: () => automation, update: save } as unknown as AutomationStore
    );
    const context = {
      automationId: 'auto',
      runId: 'run',
      now: 0,
      outputs: new Map(),
      emitArtifact: vi.fn(),
      log: vi.fn(),
    } satisfies AutomationRunContext;
    const result = await registry
      .get('cloud.sync')!
      .execute(config, context, automation.actionGraph.nodes[0]);
    expect(automation.actionGraph.nodes[0].config.rawTableId).toBe('local');
    expect(result).toMatchObject({ rawTableId: 'local' });
    expect(context.emitArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ dataRef: { kind: 'raw_table', id: 'local' } })
    );
  });
});

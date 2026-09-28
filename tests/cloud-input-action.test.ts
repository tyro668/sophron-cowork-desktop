import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';
import { InputTablesCommandService } from '../src/main/data/input-tables-command-service';
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
  inputTableName: 'Sales',
};
let store: DataTaskStore;
let directory: string;
beforeEach(() => {
  vi.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'cloud-input-sync-'));
  store = createDataTaskStore(join(directory, 'data.duckdb'));
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
async function cloudMirrorOf(inputTableId: string) {
  const dataset = await store.getInputTableRecord(inputTableId);
  return dataset?.inputConfig.sourceKind === 'csv' ? dataset.inputConfig.cloudMirror : undefined;
}

function service(cloudImportDir?: string) {
  const input = new InputTablesCommandService(store, {} as never);
  return new CloudAnalysisCommandService(
    store,
    () => ({ apiOrigin: 'https://example.com', apiKey: 'key', updatedAt: 0 }),
    {
      createInputTable: (command) => input.createInputTable(command),
      updateInputTable: (command) => input.updateInputTable(command),
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
      const created = await service().syncInputTableFromCloud(original, 'key_%"');
      expect((await store.getInputTableRecord(created.inputTableId))?.rowCount).toBe(123);
      await store.updateDataset({ id: created.inputTableId, name: 'Renamed sales' });
      await store.close();
      store = createDataTaskStore(join(directory, 'data.duckdb'));
      exportTableCsv.mockResolvedValue('id,amount\n7,99\n');
      // Simulate a crash before the created ID could be saved on the automation.
      const recovered = await service().syncInputTableFromCloud(original, 'key_%"');
      expect(recovered).toEqual({
        inputTableId: created.inputTableId,
        inputTableName: 'Renamed sales',
      });
      expect((await store.getDashboard()).totalDatasets).toBe(1);
      expect((await store.getInputTableRecord(created.inputTableId))?.rowCount).toBe(1);
      expect(findTable).toHaveBeenCalledWith('s', 'p', 'remote');
      const mirror = await cloudMirrorOf(created.inputTableId);
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
    const result = await service(importDir).importCloudTable({
      tableId: 'remote',
      spaceId: 's',
      projectId: 'p',
      spaceName: 'Alpha space',
      projectName: 'Beta project',
      name: 'Imported sales',
    });
    const dataset = result.inputTable;
    expect(dataset.sourcePath.startsWith(importDir)).toBe(true);
    expect(existsSync(dataset.sourcePath)).toBe(true);
    const mirror = await cloudMirrorOf(dataset.id);
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
    await store.updateDataset({
      id: dataset.id,
      config: dataset.inputConfig,
    });
    expect((await store.getInputTableRecord(dataset.id))?.rowCount).toBe(2);
  });
  it('re-downloads the snapshot on manual refresh and preserves table identity', async () => {
    const importDir = join(directory, 'cloud-imports');
    const created = await service(importDir).importCloudTable({
      tableId: 'remote',
      spaceId: 's',
      projectId: 'p',
      name: 'Imported sales',
    });
    const firstMirror = await cloudMirrorOf(created.inputTable.id);
    exportTableCsv.mockResolvedValue('id,amount\n9,99\n');
    findTable.mockResolvedValue({
      tableId: 'remote',
      tableName: 'Remote sales v2',
      kind: 'analysis',
      updatedAt: '2026-09-23',
    });
    const refreshed = await service(importDir).refreshCloudInputTable({
      inputTableId: created.inputTable.id,
    });
    expect(refreshed.inputTable.id).toBe(created.inputTable.id);
    expect(refreshed.inputTable.rowCount).toBe(1);
    const mirror = await cloudMirrorOf(created.inputTable.id);
    expect(mirror?.sourceVersion).toBe('2026-09-23');
    expect(mirror?.tableName).toBe('Remote sales v2');
    expect((mirror?.syncedAt ?? 0) >= (firstMirror?.syncedAt ?? 0)).toBe(true);
    expect((await store.getDashboard()).totalDatasets).toBe(1);
  });
  it('rejects refresh for non-cloud tables and incomplete legacy linkage', async () => {
    writeFileSync(join(directory, 'local.csv'), 'id\n1\n');
    writeFileSync(join(directory, 'legacy.csv'), 'id\n2\n');
    const plain = await store.importDataset({
      filePath: join(directory, 'local.csv'),
      sourceKind: 'csv',
      name: 'Local file',
    });
    await expect(service().refreshCloudInputTable({ inputTableId: plain.id })).rejects.toThrow(
      'not linked to a cloud table'
    );
    const legacy = await store.importDataset({
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
    await expect(service().refreshCloudInputTable({ inputTableId: legacy.id })).rejects.toThrow(
      'linkage is incomplete'
    );
  });
  it('rejects other project sources, wrong kinds, and deleted targets without creating replacements', async () => {
    findTable.mockResolvedValueOnce(undefined);
    await expect(service().syncInputTableFromCloud(config, 'key')).rejects.toThrow(
      'configured project'
    );
    findTable.mockResolvedValueOnce({ tableId: 'remote', kind: 'base' });
    await expect(service().syncInputTableFromCloud(config, 'key')).rejects.toThrow(
      'configured project'
    );
    await expect(
      service().syncInputTableFromCloud({ ...config, inputTableId: 'deleted' }, 'key')
    ).rejects.toThrow('not found');
    expect(exportTableCsv).not.toHaveBeenCalled();
    expect((await store.getDashboard()).totalDatasets).toBe(0);
  });
  it('does not overwrite an unrelated same-name input during creation', async () => {
    await service().syncInputTableFromCloud(config, 'one');
    await expect(service().syncInputTableFromCloud(config, 'two')).rejects.toThrow();
    expect((await store.getDashboard()).totalDatasets).toBe(1);
  });
  it('requires a real source kind and a local destination', () => {
    expect(cloudInputSyncSchema.safeParse({ ...config, tableKind: 'drive' }).success).toBe(false);
    expect(cloudInputSyncSchema.safeParse({ ...config, inputTableName: '' }).success).toBe(false);
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
      syncInputTableFromCloud: vi.fn(async () => ({
        inputTableId: 'local',
        inputTableName: 'Sales',
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
    expect(automation.actionGraph.nodes[0].config.inputTableId).toBe('local');
    expect(result).toMatchObject({ inputTableId: 'local' });
    expect(context.emitArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ dataRef: { kind: 'input_table', id: 'local' } })
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
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
function service() {
  const input = new InputTablesCommandService(store, {} as never);
  return new CloudAnalysisCommandService(
    store,
    () => ({ apiOrigin: 'https://example.com', apiKey: 'key', updatedAt: 0 }),
    {
      createInputTable: (command) => input.createInputTable(command),
      updateInputTable: (command) => input.updateInputTable(command),
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
    }
  );
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

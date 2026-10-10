import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateMainSchema, type DatabaseInstance } from '../src/main/db/database';
import { createAutomationStore } from '../src/main/automation/automation-store';
import { AutomationService } from '../src/main/automation/automation-service';
import { AutomationRunner } from '../src/main/automation/automation-runner';
import { AutomationActionRegistry } from '../src/main/automation/automation-action-registry';
import { automationRunScope } from '../src/main/automation/automation-run-scope';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../src/main/data/data-pipeline-store';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});
function fixture(maxConcurrentRuns = 4) {
  const raw = new Database(':memory:');
  cleanups.push(() => {
    raw.close();
  });
  migrateMainSchema(raw);
  const store = createAutomationStore({ raw } as DatabaseInstance);
  const registry = new AutomationActionRegistry();
  const execute = vi.fn(async (_config: Record<string, unknown>) => ({}));
  registry.register({
    type: 'test',
    title: 'test',
    category: 'data',
    icon: 'table',
    version: 1,
    defaultConfig: {},
    configSchema: { type: 'object', properties: {} },
    execute,
  });
  const runner = new AutomationRunner({ store, registry, maxConcurrentRuns });
  const service = new AutomationService({ store, registry, runner });
  const create = (id: string, runOnChange = true) =>
    service.create({
      name: id,
      trigger: { kind: 'manual', timezone: 'UTC' },
      outputBindings: [{ resultTableId: id, runOnChange }],
      actionGraph: {
        version: 1,
        edges: [],
        nodes: [{ id: 'node', type: 'test', enabled: true, config: {} }],
      },
    });
  return { raw, store, service, create, execute };
}
describe('output table automation integration', () => {
  it('pauses legacy generated cloud-table writes while retaining their targets', async () => {
    const f = fixture();
    const directory = mkdtempSync(join(tmpdir(), 'generated-output-migration-'));
    const path = join(directory, 'data.duckdb');
    let data = createDataPipelineStore(path, { metadataDb: { raw: f.raw } as DatabaseInstance });
    cleanups.push(async () => {
      await data.close();
      rmSync(directory, { recursive: true, force: true });
    });
    await data.getDashboard();
    const legacy = f.store.create({
      name: 'Legacy process',
      trigger: { kind: 'daily', times: ['09:00'], timezone: 'UTC' },
      actionGraph: {
        version: 1,
        edges: [],
        nodes: [
          {
            id: 'n',
            type: 'cloud.table.process',
            enabled: true,
            config: {
              pipelineId: 'pipeline',
              output: {
                location: 'cloud',
                targetTableId: 'analysis-table',
                localResultTableId: 'local-output',
              },
            },
          },
        ],
      },
    });
    f.raw.prepare('DELETE FROM data_schema_migrations WHERE version = 10').run();
    await data.close();
    data = createDataPipelineStore(path, { metadataDb: { raw: f.raw } as DatabaseInstance });
    await data.getDashboard();
    const migrated = f.store.get(legacy.id)!;
    expect(migrated.status).toBe('paused');
    expect(migrated.nextRunAt).toBeNull();
    expect(migrated.actionGraph).toEqual(legacy.actionGraph);
    expect(migrated.lastError).toBe('schedule.cloudSync.useOutputAction');
  });

  it('dispatches once per automation for a multi-sink commit and respects disabled/paused links', async () => {
    const f = fixture();
    const active = f.create('a');
    f.service.update(active.id, {
      outputBindings: [
        { resultTableId: 'a', runOnChange: true },
        { resultTableId: 'b', runOnChange: true },
      ],
    });
    const disabled = f.create('a');
    f.service.setEnabled(disabled.id, false);
    const paused = f.create('a');
    f.service.pause(paused.id);
    f.create('a', false);
    await f.service.runForResultTables(['a', 'b', 'a']);
    await vi.waitFor(() => expect(f.store.listRuns(active.id)[0]?.status).toBe('succeeded'));
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.store.listRuns(active.id)[0].triggerReason).toBe('output_change');
    expect(f.store.listRuns(disabled.id)).toEqual([]);
    expect(f.store.listRuns(paused.id)).toEqual([]);
  });
  it('does not enqueue repeated output commits while waiting for a runner slot', async () => {
    const f = fixture(1);
    const blocker = f.create('blocker', false);
    const queued = f.create('queued');
    let release!: () => void;
    f.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        })
    );
    const running = f.service.runNow(blocker.id);
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1));
    await f.service.runForResultTables(['queued']);
    await f.service.runForResultTables(['queued']);
    expect(f.store.listRuns(queued.id)).toHaveLength(1);
    release();
    await running;
    await vi.waitFor(() => expect(f.store.listRuns(queued.id)[0].status).toBe('succeeded'));
    expect(f.execute).toHaveBeenCalledTimes(2);
  });

  it('queues one independent change during a run and uses the latest saved action config', async () => {
    const f = fixture();
    const a = f.create('out');
    f.service.update(a.id, { concurrencyPolicy: { overlapPolicy: 'queue_once' } });
    let release!: () => void;
    f.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        })
    );
    const running = f.service.runNow(a.id);
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1));
    await f.service.runForResultTables(['out']);
    await f.service.runForResultTables(['out']);
    expect(f.store.listRuns(a.id)).toHaveLength(2);
    f.service.update(a.id, {
      actionGraph: {
        ...a.actionGraph,
        nodes: [{ ...a.actionGraph.nodes[0], config: { target: 'saved-remote-id' } }],
      },
    });
    release();
    await running;
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(2));
    expect(f.execute.mock.calls[1][0]).toEqual({ target: 'saved-remote-id' });
  });

  it('cancels a queued output change when the automation is paused during its active run', async () => {
    const f = fixture();
    const a = f.create('out');
    f.service.update(a.id, { concurrencyPolicy: { overlapPolicy: 'queue_once' } });
    let release!: () => void;
    f.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        })
    );
    const running = f.service.runNow(a.id);
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1));
    await f.service.runForResultTables(['out']);
    f.service.pause(a.id);
    release();
    await running;
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.store.get(a.id)?.status).toBe('paused');
    expect(f.store.listRuns(a.id).map((run) => run.status)).toContain('cancelled');
  });

  it('preserves a schedule when adding/removing an output association', () => {
    const f = fixture();
    const a = f.create('out');
    const trigger = { kind: 'daily' as const, times: ['09:00'], timezone: 'UTC' };
    f.service.update(a.id, { trigger });
    const before = f.store.get(a.id)!.trigger;
    f.service.update(a.id, { outputBindings: [] });
    expect(f.store.get(a.id)!.trigger).toEqual(before);
    expect(f.store.get(a.id)!.outputBindings).toEqual([]);
  });
  it('does not recursively trigger an ancestor after its original run has finished', async () => {
    const f = fixture();
    const a = f.create('out');
    await automationRunScope.run([a.id, 'downstream'], () => f.service.runForResultTables(['out']));
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('migrates old table and drive actions transactionally, preserving schedules and identities', async () => {
    const f = fixture();
    const folder = mkdtempSync(join(tmpdir(), 'output-auto-'));
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    const path = join(folder, 'data.duckdb');
    let data: DataPipelineStore = createDataPipelineStore(path, {
      metadataDb: { raw: f.raw } as DatabaseInstance,
    });
    cleanups.push(() => data.close());
    await data.getDashboard();
    const onChange = await data.createResultTable({ name: 'Drive output' });
    const scheduled = await data.createResultTable({ name: 'Cloud output' });
    const schedule = { kind: 'weekly', weekdays: [1, 5], times: ['09:00'] };
    f.raw.prepare('UPDATE data_raw_tables SET config_json = ? WHERE id = ?').run(
      JSON.stringify({
        kind: 'result_table',
        cloudAction: {
          type: 'drive_file',
          trigger: 'on_change',
          spaceId: 's',
          projectId: 'p',
          fileId: 'file',
          version: 7,
        },
      }),
      onChange.id
    );
    f.raw.prepare('UPDATE data_raw_tables SET config_json = ? WHERE id = ?').run(
      JSON.stringify({
        kind: 'result_table',
        cloudAction: {
          type: 'cloud_table',
          trigger: 'schedule',
          schedule,
          spaceId: 's',
          projectId: 'p',
          tableId: 'remote',
        },
      }),
      scheduled.id
    );
    f.raw.prepare('UPDATE data_raw_tables SET source_kind = NULL WHERE id = ?').run(onChange.id);
    f.raw.prepare('DELETE FROM data_schema_migrations WHERE version >= 8').run();
    await data.close();
    data = createDataPipelineStore(path, { metadataDb: { raw: f.raw } as DatabaseInstance });
    f.raw.exec(`CREATE TRIGGER fail_legacy_action BEFORE INSERT ON automations
      WHEN NEW.id = 'output-cloud-${scheduled.id}' BEGIN SELECT RAISE(ABORT, 'forced migration failure'); END`);
    await expect(data.getDashboard()).rejects.toThrow('forced migration failure');
    expect(f.store.list().automations).toHaveLength(0);
    expect(
      f.raw.prepare('SELECT 1 FROM data_schema_migrations WHERE version = 8').get()
    ).toBeUndefined();
    expect(
      (
        f.raw.prepare('SELECT config_json FROM data_raw_tables WHERE id = ?').get(onChange.id) as {
          config_json: string;
        }
      ).config_json
    ).toContain('cloudAction');
    data.close();
    f.raw.exec('DROP TRIGGER fail_legacy_action');
    data = createDataPipelineStore(path, { metadataDb: { raw: f.raw } as DatabaseInstance });
    await data.getDashboard();
    const drive = f.store.get(`output-cloud-${onChange.id}`)!;
    const cloud = f.store.get(`output-cloud-${scheduled.id}`)!;
    expect(drive.trigger.kind).toBe('manual');
    expect(drive.outputBindings).toEqual([{ resultTableId: onChange.id, runOnChange: true }]);
    expect(drive.actionGraph.nodes[0].config).toMatchObject({ fileId: 'file', version: 7 });
    expect(cloud.trigger).toMatchObject(schedule);
    expect(cloud.outputBindings).toEqual([{ resultTableId: scheduled.id, runOnChange: false }]);
    expect(cloud.actionGraph.nodes[0].config.tableId).toBe('remote');
    expect(cloud.nextRunAt).toBeNull();
    expect(cloud.status).toBe('paused');
    expect(cloud.lastError).toBe('schedule.cloudSync.legacyTarget');
    expect(() => f.service.resume(cloud.id)).toThrow();
    expect(() => f.service.setEnabled(cloud.id, true)).toThrow();
    expect(f.store.get(cloud.id)?.status).toBe('paused');
    expect((await data.getResultTableRecord(onChange.id))?.cloudAction).toBeNull();
    await data.close();
    data = createDataPipelineStore(path, { metadataDb: { raw: f.raw } as DatabaseInstance });
    await data.getDashboard();
    expect(f.store.list().automations).toHaveLength(2);
  });
});

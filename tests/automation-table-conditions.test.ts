import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrateMainSchema, type DatabaseInstance } from '../src/main/db/database';
import { createAutomationStore } from '../src/main/automation/automation-store';
import { AutomationService } from '../src/main/automation/automation-service';
import { AutomationRunner } from '../src/main/automation/automation-runner';
import { AutomationActionRegistry } from '../src/main/automation/automation-action-registry';
import { getAutomationTableBindings } from '../src/shared/automation/table-bindings';
import type { AutomationActionNode, AutomationTableBinding } from '../src/shared/automation/types';

const databases: Database.Database[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});
const binding = (
  tableId: string,
  kind: 'raw' | 'result' = 'result',
  runOnChange = true,
  runOnTrigger = false
): AutomationTableBinding => ({ tableId, kind, runOnChange, runOnTrigger });
const processNode = (id = 'process'): AutomationActionNode => ({
  id,
  type: 'test',
  enabled: true,
  config: {},
});
const sync = (tableId: string, kind: 'raw' | 'result' = 'result'): AutomationActionNode => ({
  id: tableId,
  type: 'cloud.sync',
  enabled: true,
  config:
    kind === 'raw'
      ? {
          direction: 'input',
          rawTableId: tableId,
          spaceId: 's',
          projectId: 'p',
          tableId: 'remote',
          tableKind: 'base',
        }
      : {
          direction: 'output',
          resultTableId: tableId,
          type: 'drive_file',
          writeMode: 'create',
          spaceId: 's',
          projectId: 'p',
        },
});
function fixture(maxConcurrentRuns = 4) {
  const raw = new Database(':memory:');
  databases.push(raw);
  migrateMainSchema(raw);
  const store = createAutomationStore({ raw } as DatabaseInstance);
  const registry = new AutomationActionRegistry();
  const execute = vi.fn(
    async (_config: unknown, _context: unknown, node: AutomationActionNode) => ({ node: node.id })
  );
  for (const type of ['test', 'cloud.sync'])
    registry.register({
      type,
      title: type,
      category: 'data',
      icon: 'table',
      version: 1,
      defaultConfig: {},
      configSchema: { type: 'object', properties: {} },
      execute,
    });
  const runner = new AutomationRunner({ store, registry, maxConcurrentRuns });
  const service = new AutomationService({ store, registry, runner });
  const create = (
    nodes: AutomationActionNode[],
    tableBindings: AutomationTableBinding[],
    linear = false
  ) =>
    service.create({
      name: 'Test',
      trigger: { kind: 'daily', times: ['09:00'], timezone: 'UTC' },
      tableBindings,
      concurrencyPolicy: { overlapPolicy: 'queue_once' },
      actionGraph: {
        version: 1,
        nodes,
        edges: linear
          ? nodes
              .slice(1)
              .map((n, i) => ({ id: String(i), sourceNodeId: nodes[i].id, targetNodeId: n.id }))
          : [],
      },
    });
  const calls = () => execute.mock.calls.map((c) => c[2].id);
  const done = async (id: string) =>
    vi.waitFor(() => expect(store.listRuns(id)[0]?.finishedAt).toBeTypeOf('number'));
  return { raw, store, service, runner, create, execute, calls, done };
}

describe('independent table association conditions', () => {
  it('does not publish another table even when that table also allows its own updates', async () => {
    const f = fixture();
    const a = f.create(
      [sync('A'), sync('B'), sync('C')],
      [binding('A'), binding('B'), binding('C', 'result', false)]
    );
    await f.service.runForResultTables(['A']);
    await f.done(a.id);
    expect(f.calls()).toEqual(['A']);
    expect(f.store.listRuns(a.id)[0].executionSummary).toMatchObject({
      executedNodeIds: ['A'],
      skippedNodeIds: ['B', 'C'],
    });
  });
  it('skips descendants of an excluded refresh and records an empty run as cancelled', async () => {
    const f = fixture();
    const a = f.create(
      [sync('raw', 'raw'), processNode(), sync('out')],
      [binding('raw', 'raw'), binding('out', 'result', false, true)],
      true
    );
    const run = await f.service.runTriggered(a.id, 'timer');
    expect(f.calls()).toEqual([]);
    expect(run?.status).toBe('cancelled');
    expect(run?.executionSummary?.skippedNodeIds).toEqual(['raw', 'process', 'out']);
  });
  it('uses the committed raw input without re-downloading, then publishes an actually committed result once', async () => {
    const f = fixture();
    const a = f.create(
      [sync('raw', 'raw'), processNode(), sync('out'), sync('unrelated')],
      [binding('raw', 'raw'), binding('out'), binding('unrelated')],
      true
    );
    f.execute.mockImplementation(async (_c, _ctx, node) => {
      if (node.id === 'process') await f.service.runForResultTables(['out']);
      return { node: node.id };
    });
    await f.service.runForRawTables(['raw']);
    await f.done(a.id);
    expect(f.calls()).toEqual(['process', 'out']);
    expect(f.store.listRuns(a.id)).toHaveLength(1);
  });
  it('supports local raw-table subscriptions without any cloud action', async () => {
    const f = fixture();
    const a = f.create([processNode()], [binding('excel', 'raw')]);
    await f.service.runForRawTables(['excel']);
    await f.done(a.id);
    expect(f.calls()).toEqual(['process']);
  });
  it('does not inherit schedules for a binding without a sync node', async () => {
    const f = fixture();
    const a = f.create([processNode()], [binding('excel', 'raw')]);
    await f.service.runTriggered(a.id, 'timer');
    expect(f.calls()).toEqual([]);
    await f.service.runNow(a.id);
    expect(f.calls()).toEqual(['process']);
  });
  it('merges distinct queued table events and uses the latest conditions', async () => {
    const f = fixture(1);
    const blocker = f.create([processNode('block')], []);
    const target = f.create([sync('A'), sync('B')], [binding('A'), binding('B')]);
    let release!: () => void;
    f.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ node: 'block' });
        })
    );
    const running = f.service.runNow(blocker.id);
    await vi.waitFor(() => expect(f.calls()).toEqual(['block']));
    await f.service.runForResultTables(['A']);
    await f.service.runForResultTables(['B']);
    expect(f.store.listRuns(target.id)).toHaveLength(1);
    release();
    await running;
    await f.done(target.id);
    expect(f.calls()).toEqual(['block', 'A', 'B']);
    expect(f.store.listRuns(target.id)[0].executionSummary?.tables.map((t) => t.tableId)).toEqual([
      'A',
      'B',
    ]);
  });
  it('honors a condition disabled while the event is queued', async () => {
    const f = fixture(1);
    const blocker = f.create([processNode('block')], []);
    const target = f.create([sync('A')], [binding('A')]);
    let release!: () => void;
    f.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ node: 'block' });
        })
    );
    const running = f.service.runNow(blocker.id);
    await vi.waitFor(() => expect(f.calls()).toEqual(['block']));
    await f.service.runForResultTables(['A']);
    f.service.setTablePolicy({ kind: 'result', tableId: 'A' }, { runOnChange: false });
    release();
    await running;
    await f.done(target.id);
    expect(f.calls()).toEqual(['block']);
    expect(f.store.listRuns(target.id)[0].status).toBe('cancelled');
  });
  it('persists canonical conditions, and explicit unlink cannot resurrect legacy flags', () => {
    const f = fixture();
    const node = sync('A');
    node.config.runOnTrigger = true;
    const a = f.service.create({
      name: 'Legacy',
      trigger: { kind: 'manual', timezone: 'UTC' },
      outputBindings: [{ resultTableId: 'A', runOnChange: true }],
      actionGraph: { version: 1, nodes: [node], edges: [] },
    });
    expect(getAutomationTableBindings(a)[0].runOnChange).toBe(true);
    f.service.setTablePolicy(
      { kind: 'result', tableId: 'A' },
      { runOnChange: false, runOnTrigger: false }
    );
    expect(getAutomationTableBindings(f.store.get(a.id)!)).toEqual([binding('A', 'result', false)]);
    f.service.update(a.id, { tableBindings: [] });
    expect(getAutomationTableBindings(f.store.get(a.id)!)).toEqual([]);
  });
  it('retains old metadata during the new schema migrations and does not rerun them', () => {
    const f = fixture();
    const a = f.create([processNode()], []);
    f.raw.exec(
      'ALTER TABLE automations DROP COLUMN table_bindings_json; ALTER TABLE automation_runs DROP COLUMN execution_summary_json; DROP TABLE automation_table_policies; DELETE FROM app_schema_migrations WHERE version >= 5'
    );
    migrateMainSchema(f.raw);
    migrateMainSchema(f.raw);
    expect(f.store.get(a.id)?.name).toBe('Test');
    expect(f.store.get(a.id)?.tableBindings).toEqual([]);
    expect(
      f.raw.prepare('SELECT count(*) AS n FROM app_schema_migrations WHERE version >= 5').get()
    ).toEqual({ n: 3 });
  });
  it('validates canonical bindings before persisting a partial update', () => {
    const f = fixture();
    const a = f.create([processNode()], []);
    expect(() => f.service.update(a.id, { tableBindings: [binding('A'), binding('A')] })).toThrow();
    expect(f.store.get(a.id)?.tableBindings).toEqual([]);
  });
});

describe('shared table automation policy', () => {
  it.each(['raw', 'result'] as const)(
    'applies one %s policy to all linked automations at execution time',
    async (kind) => {
      const f = fixture();
      const a = f.create([processNode('one')], [binding('shared', kind)]);
      const b = f.create([processNode('two')], [binding('shared', kind, false, true)]);
      const other = f.create([processNode('other')], [binding('other', kind)]);
      const table = { kind, tableId: 'shared' };
      expect(f.store.get(b.id)?.tableBindings).toEqual([binding('shared', kind)]);
      f.service.setTablePolicy(table, { runOnChange: false, runOnTrigger: true });
      for (const id of [a.id, b.id]) {
        expect(f.store.get(id)?.tableBindings).toEqual([binding('shared', kind, false, true)]);
        await f.service.runTriggered(id, 'timer');
      }
      expect(f.calls()).toEqual(['one', 'two']);
      f.execute.mockClear();
      const notify = () =>
        kind === 'raw'
          ? f.service.runForRawTables(['shared'])
          : f.service.runForResultTables(['shared']);
      await notify();
      expect(f.calls()).toEqual([]);
      f.service.setTablePolicy(table, { runOnChange: true });
      await notify();
      await Promise.all([f.done(a.id), f.done(b.id)]);
      expect(f.calls().sort()).toEqual(['one', 'two']);
      expect(f.store.get(other.id)?.tableBindings).toEqual([binding('other', kind)]);
    }
  );

  it.each(['raw', 'result'] as const)(
    'saves a %s policy without links and retains it across unlinking and relinking',
    (kind) => {
      const f = fixture();
      const table = { kind, tableId: 'shared' };
      const policy = { runOnChange: true, runOnTrigger: false };
      f.service.setTablePolicy(table, policy);
      const a = f.create([processNode()], [binding('shared', kind, false, true)]);
      expect(f.store.get(a.id)?.tableBindings).toEqual([{ ...table, ...policy }]);
      f.service.update(a.id, { tableBindings: [] });
      f.store.delete(a.id);
      const reopened = createAutomationStore({ raw: f.raw } as DatabaseInstance);
      expect(reopened.getTablePolicy(table)).toEqual(policy);
      const b = f.create([processNode()], [binding('shared', kind, false, true)]);
      expect(reopened.get(b.id)?.tableBindings).toEqual([{ ...table, ...policy }]);
    }
  );

  it('migrates conflicting legacy links to one conservative policy only once', () => {
    const f = fixture();
    f.create([processNode()], [binding('shared')]);
    f.create([processNode()], [binding('shared', 'result', false, true)]);
    f.raw.exec(
      'DROP TABLE automation_table_policies; DELETE FROM app_schema_migrations WHERE version = 7'
    );
    migrateMainSchema(f.raw);
    expect(f.service.getTablePolicy({ kind: 'result', tableId: 'shared' })).toEqual({
      runOnChange: false,
      runOnTrigger: false,
    });
    f.service.setTablePolicy({ kind: 'result', tableId: 'shared' }, { runOnChange: true });
    migrateMainSchema(f.raw);
    expect(f.service.getTablePolicy({ kind: 'result', tableId: 'shared' }).runOnChange).toBe(true);
  });
});

describe('replacing a table automation association', () => {
  it.each(['raw', 'result'] as const)(
    'replaces the %s link and its sync action while preserving other links and the shared policy',
    (kind) => {
      const f = fixture();
      const old = f.create(
        [processNode('before'), sync('shared', kind), processNode('after')],
        [binding('shared', kind), binding('other', kind)],
        true
      );
      const next = f.create([processNode('new')], []);
      const third = f.create([processNode('third')], [binding('shared', kind)]);
      f.service.replaceTableAssociation({ kind, tableId: 'shared' }, old.id, next.id);
      expect(f.store.get(old.id)?.tableBindings).toEqual([binding('other', kind)]);
      expect(f.store.get(old.id)?.actionGraph.nodes.map((n) => n.id)).toEqual(['before', 'after']);
      expect(f.store.get(old.id)?.actionGraph.edges).toEqual([
        expect.objectContaining({ sourceNodeId: 'before', targetNodeId: 'after' }),
      ]);
      expect(f.store.get(next.id)?.tableBindings).toEqual([binding('shared', kind)]);
      expect(f.store.get(third.id)?.tableBindings).toEqual([binding('shared', kind)]);
      expect(f.service.getTablePolicy({ kind, tableId: 'shared' })).toEqual({
        runOnChange: true,
        runOnTrigger: false,
      });
    }
  );
  it('rolls back the old association when the new association cannot be saved', () => {
    const f = fixture();
    const old = f.create([sync('shared')], [binding('shared')]);
    const next = f.create([processNode()], []);
    f.raw.exec(
      `CREATE TRIGGER reject_new_link BEFORE UPDATE ON automations WHEN NEW.id = '${next.id}' BEGIN SELECT RAISE(ABORT, 'test failure'); END`
    );
    expect(() =>
      f.service.replaceTableAssociation({ kind: 'result', tableId: 'shared' }, old.id, next.id)
    ).toThrow('test failure');
    expect(f.store.get(old.id)?.tableBindings).toEqual([binding('shared')]);
    expect(f.store.get(old.id)?.actionGraph.nodes.map((n) => n.id)).toEqual(['shared']);
    expect(f.store.get(next.id)?.tableBindings).toEqual([]);
  });
  it('rejects an already linked replacement without changing either association', () => {
    const f = fixture();
    const old = f.create([processNode()], [binding('shared')]);
    const next = f.create([processNode()], [binding('shared')]);
    expect(() =>
      f.service.replaceTableAssociation({ kind: 'result', tableId: 'shared' }, old.id, next.id)
    ).toThrow('already linked');
    expect(f.store.get(old.id)?.tableBindings).toHaveLength(1);
    expect(f.store.get(next.id)?.tableBindings).toHaveLength(1);
  });
});

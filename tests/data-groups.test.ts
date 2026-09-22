/**
 * Grouping coverage: per-scope groups, member assignment, group-aware
 * dashboard ordering, and dissolve semantics (members fall back to
 * ungrouped — never deleted).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';

const tempRoots: string[] = [];
const stores: DataTaskStore[] = [];

function openStore(): { store: DataTaskStore; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-groups-'));
  tempRoots.push(root);
  const store = createDataTaskStore(path.join(root, 'workspace.duckdb'));
  stores.push(store);
  return { store, root };
}

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

function writeCsv(root: string, name: string): string {
  const file = path.join(root, name);
  fs.writeFileSync(file, 'id,name\n1,a\n2,b\n');
  return file;
}

describe('data groups', () => {
  it('creates, lists, renames, and scopes groups independently', async () => {
    const { store } = openStore();

    const taskGroup = await store.createGroup({ scope: 'task', name: 'Alpha' });
    const inputGroup = await store.createGroup({ scope: 'input', name: 'Alpha' });

    expect(taskGroup.scope).toBe('task');
    expect(inputGroup.scope).toBe('input');
    expect(taskGroup.id).not.toBe(inputGroup.id);

    expect((await store.listGroups('task')).map((group) => group.id)).toEqual([taskGroup.id]);
    expect((await store.listGroups('input')).map((group) => group.id)).toEqual([inputGroup.id]);
    expect(await store.listGroups('output')).toEqual([]);

    await store.renameGroup({ id: taskGroup.id, name: 'Renamed' });
    expect((await store.listGroups('task'))[0].name).toBe('Renamed');

    await expect(store.createGroup({ scope: 'task', name: '  Renamed  ' })).rejects.toThrow();
    await expect(store.createGroup({ scope: 'task', name: '   ' })).rejects.toThrow();
  });

  it('assigns tasks to groups and orders grouped rows before ungrouped', async () => {
    const { store } = openStore();
    const t1 = await store.createTask({ name: 'task one' });
    const t2 = await store.createTask({ name: 'task two' });
    const t3 = await store.createTask({ name: 'task three' });
    const t4 = await store.createTask({ name: 'task four' });

    const g1 = await store.createGroup({ scope: 'task', name: 'first' });
    const g2 = await store.createGroup({ scope: 'task', name: 'second' });
    await store.assignGroup({ scope: 'task', ids: [t1.id, t3.id], groupId: g1.id });
    await store.assignGroup({ scope: 'task', ids: [t2.id], groupId: g2.id });

    const dashboard = await store.getDashboard({ taskLimit: 10 });
    // g1 was created first → its section leads; ungrouped rows trail.
    expect(dashboard.tasks.map((task) => task.groupId)).toEqual([g1.id, g1.id, g2.id, null]);
    expect(new Set(dashboard.tasks.slice(0, 2).map((task) => task.id))).toEqual(
      new Set([t1.id, t3.id])
    );
    expect(dashboard.tasks[3].id).toBe(t4.id);
    expect(dashboard.groups.map((group) => group.id)).toEqual(
      expect.arrayContaining([g1.id, g2.id])
    );
  });

  it('assigns input datasets, keeps scope predicates separate, and unassigns', async () => {
    const { store, root } = openStore();
    const ds1 = await store.importDataset({ filePath: writeCsv(root, 'a.csv') });
    const ds2 = await store.importDataset({ filePath: writeCsv(root, 'b.csv') });
    const task = await store.createTask({ name: 'loose task' });

    const group = await store.createGroup({ scope: 'input', name: 'sources' });
    await store.assignGroup({ scope: 'input', ids: [ds1.id, ds2.id], groupId: group.id });

    let dashboard = await store.getDashboard({
      includeTasks: true,
      includeDatasets: true,
      datasetLimit: 10,
      taskLimit: 10,
    });
    expect(dashboard.datasets.every((dataset) => dataset.groupId === group.id)).toBe(true);

    // Scope mismatch: a task id assigned under 'input' must not move.
    await store.assignGroup({ scope: 'input', ids: [task.id], groupId: group.id });
    dashboard = await store.getDashboard({ includeTasks: true, taskLimit: 10 });
    expect(dashboard.tasks[0].groupId).toBeNull();

    // Null groupId returns rows to the ungrouped section.
    await store.assignGroup({ scope: 'input', ids: [ds1.id], groupId: null });
    dashboard = await store.getDashboard({ includeDatasets: true, datasetLimit: 10 });
    const byId = new Map(dashboard.datasets.map((dataset) => [dataset.id, dataset.groupId]));
    expect(byId.get(ds1.id)).toBeNull();
    expect(byId.get(ds2.id)).toBe(group.id);
  });

  it('assigns output tables and dissolving a group ungroups its members', async () => {
    const { store } = openStore();
    const out1 = await store.createOutputTable({ name: 'out one' });
    const out2 = await store.createOutputTable({ name: 'out two' });

    const group = await store.createGroup({ scope: 'output', name: 'exports' });
    await store.assignGroup({ scope: 'output', ids: [out1.id, out2.id], groupId: group.id });

    let dashboard = await store.getDashboard({
      includeTasks: false,
      includeDatasets: false,
      includeOutputTables: true,
      outputLimit: 10,
    });
    expect(dashboard.outputTables.every((table) => table.groupId === group.id)).toBe(true);

    await store.deleteGroup(group.id);
    dashboard = await store.getDashboard({
      includeTasks: false,
      includeDatasets: false,
      includeOutputTables: true,
      outputLimit: 10,
    });
    expect(dashboard.groups.find((item) => item.id === group.id)).toBeUndefined();
    expect(dashboard.outputTables.every((table) => table.groupId === null)).toBe(true);
  });

  it('rejects assignment to a group of a different scope or a missing group', async () => {
    const { store } = openStore();
    const task = await store.createTask({ name: 'task' });
    const inputGroup = await store.createGroup({ scope: 'input', name: 'sources' });

    await expect(
      store.assignGroup({ scope: 'task', ids: [task.id], groupId: inputGroup.id })
    ).rejects.toThrow();
    await expect(
      store.assignGroup({ scope: 'task', ids: [task.id], groupId: 'missing' })
    ).rejects.toThrow();
    await store.assignGroup({ scope: 'task', ids: [], groupId: inputGroup.id });
  });
});

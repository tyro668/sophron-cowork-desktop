/**
 * Grouping coverage: per-scope groups, member assignment, group-aware
 * dashboard ordering, and dissolve semantics (members fall back to
 * ungrouped — never deleted).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../src/main/data/data-pipeline-store';

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];

function openStore(): { store: DataPipelineStore; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-groups-'));
  tempRoots.push(root);
  const store = createDataPipelineStore(path.join(root, 'workspace.duckdb'));
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

    const pipelineGroup = await store.createGroup({ scope: 'pipeline', name: 'Alpha' });
    const inputGroup = await store.createGroup({ scope: 'raw', name: 'Alpha' });

    expect(pipelineGroup.scope).toBe('pipeline');
    expect(inputGroup.scope).toBe('raw');
    expect(pipelineGroup.id).not.toBe(inputGroup.id);

    expect((await store.listGroups('pipeline')).map((group) => group.id)).toEqual([
      pipelineGroup.id,
    ]);
    expect((await store.listGroups('raw')).map((group) => group.id)).toEqual([inputGroup.id]);
    expect(await store.listGroups('result')).toEqual([]);

    await store.renameGroup({ id: pipelineGroup.id, name: 'Renamed' });
    expect((await store.listGroups('pipeline'))[0].name).toBe('Renamed');

    await expect(store.createGroup({ scope: 'pipeline', name: '  Renamed  ' })).rejects.toThrow();
    await expect(store.createGroup({ scope: 'pipeline', name: '   ' })).rejects.toThrow();
  });

  it('assigns pipelines to groups and orders grouped rows before ungrouped', async () => {
    const { store } = openStore();
    const t1 = await store.createPipeline({ name: 'pipeline one' });
    const t2 = await store.createPipeline({ name: 'pipeline two' });
    const t3 = await store.createPipeline({ name: 'pipeline three' });
    const t4 = await store.createPipeline({ name: 'pipeline four' });

    const g1 = await store.createGroup({ scope: 'pipeline', name: 'first' });
    const g2 = await store.createGroup({ scope: 'pipeline', name: 'second' });
    await store.assignGroup({ scope: 'pipeline', ids: [t1.id, t3.id], groupId: g1.id });
    await store.assignGroup({ scope: 'pipeline', ids: [t2.id], groupId: g2.id });

    const dashboard = await store.getDashboard({ pipelineLimit: 10 });
    // g1 was created first → its section leads; ungrouped rows trail.
    expect(dashboard.pipelines.map((pipeline) => pipeline.groupId)).toEqual([
      g1.id,
      g1.id,
      g2.id,
      null,
    ]);
    expect(new Set(dashboard.pipelines.slice(0, 2).map((pipeline) => pipeline.id))).toEqual(
      new Set([t1.id, t3.id])
    );
    expect(dashboard.pipelines[3].id).toBe(t4.id);
    expect(dashboard.groups.map((group) => group.id)).toEqual(
      expect.arrayContaining([g1.id, g2.id])
    );
  });

  it('assigns input rawTables, keeps scope predicates separate, and unassigns', async () => {
    const { store, root } = openStore();
    const ds1 = await store.importRawTable({ filePath: writeCsv(root, 'a.csv') });
    const ds2 = await store.importRawTable({ filePath: writeCsv(root, 'b.csv') });
    const pipeline = await store.createPipeline({ name: 'loose pipeline' });

    const group = await store.createGroup({ scope: 'raw', name: 'sources' });
    await store.assignGroup({ scope: 'raw', ids: [ds1.id, ds2.id], groupId: group.id });

    let dashboard = await store.getDashboard({
      includePipelines: true,
      includeRawTables: true,
      rawTableLimit: 10,
      pipelineLimit: 10,
    });
    expect(dashboard.rawTables.every((rawTable) => rawTable.groupId === group.id)).toBe(true);

    // Scope mismatch: a pipeline id assigned under 'input' must not move.
    await store.assignGroup({ scope: 'raw', ids: [pipeline.id], groupId: group.id });
    dashboard = await store.getDashboard({ includePipelines: true, pipelineLimit: 10 });
    expect(dashboard.pipelines[0].groupId).toBeNull();

    // Null groupId returns rows to the ungrouped section.
    await store.assignGroup({ scope: 'raw', ids: [ds1.id], groupId: null });
    dashboard = await store.getDashboard({ includeRawTables: true, rawTableLimit: 10 });
    const byId = new Map(dashboard.rawTables.map((rawTable) => [rawTable.id, rawTable.groupId]));
    expect(byId.get(ds1.id)).toBeNull();
    expect(byId.get(ds2.id)).toBe(group.id);
  });

  it('assigns output tables and dissolving a group ungroups its members', async () => {
    const { store } = openStore();
    const out1 = await store.createResultTable({ name: 'out one' });
    const out2 = await store.createResultTable({ name: 'out two' });

    const group = await store.createGroup({ scope: 'result', name: 'exports' });
    await store.assignGroup({ scope: 'result', ids: [out1.id, out2.id], groupId: group.id });

    let dashboard = await store.getDashboard({
      includePipelines: false,
      includeRawTables: false,
      includeResultTables: true,
      outputLimit: 10,
    });
    expect(dashboard.resultTables.every((table) => table.groupId === group.id)).toBe(true);

    await store.deleteGroup(group.id);
    dashboard = await store.getDashboard({
      includePipelines: false,
      includeRawTables: false,
      includeResultTables: true,
      outputLimit: 10,
    });
    expect(dashboard.groups.find((item) => item.id === group.id)).toBeUndefined();
    expect(dashboard.resultTables.every((table) => table.groupId === null)).toBe(true);
  });

  it('rejects assignment to a group of a different scope or a missing group', async () => {
    const { store } = openStore();
    const pipeline = await store.createPipeline({ name: 'pipeline' });
    const inputGroup = await store.createGroup({ scope: 'raw', name: 'sources' });

    await expect(
      store.assignGroup({ scope: 'pipeline', ids: [pipeline.id], groupId: inputGroup.id })
    ).rejects.toThrow();
    await expect(
      store.assignGroup({ scope: 'pipeline', ids: [pipeline.id], groupId: 'missing' })
    ).rejects.toThrow();
    await store.assignGroup({ scope: 'pipeline', ids: [], groupId: inputGroup.id });
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrateMainSchema, type DatabaseInstance } from '../src/main/db/database';
import {
  createAutomationStore,
  type AutomationStore,
} from '../src/main/automation/automation-store';
import type { AutomationCreateInput } from '../src/shared/automation/types';

const dbs: Database.Database[] = [];
afterEach(() => {
  while (dbs.length > 0) dbs.pop()?.close();
});

function fixture(): { store: AutomationStore; create: (name: string) => string } {
  const raw = new Database(':memory:');
  dbs.push(raw);
  migrateMainSchema(raw);
  const store = createAutomationStore({ raw } as DatabaseInstance);
  const input: Omit<AutomationCreateInput, 'name'> = {
    trigger: { kind: 'manual', timezone: 'UTC' },
    actionGraph: {
      version: 1,
      edges: [],
      nodes: [{ id: 'node', type: 'test', enabled: true, config: {} }],
    },
  };
  return {
    store,
    create: (name) => store.create({ ...input, name }).id,
  };
}

describe('automation groups', () => {
  it('creates the automation_groups schema on a fresh database', () => {
    const { store } = fixture();
    expect(store.listGroups()).toEqual([]);
  });

  it('creates, lists, and renames groups', () => {
    const { store } = fixture();
    const group = store.createGroup({ name: '  夜间任务  ' });
    expect(group.name).toBe('夜间任务');
    expect(store.listGroups().map((g) => g.id)).toEqual([group.id]);
    expect(store.renameGroup({ id: group.id, name: '白天任务' })).toBe(true);
    expect(store.listGroups()[0]?.name).toBe('白天任务');
    expect(store.renameGroup({ id: 'missing', name: 'x' })).toBe(false);
  });

  it('rejects empty and duplicate group names', () => {
    const { store } = fixture();
    expect(() => store.createGroup({ name: '  ' })).toThrow();
    store.createGroup({ name: 'A' });
    expect(() => store.createGroup({ name: 'A' })).toThrow();
    const other = store.createGroup({ name: 'B' });
    expect(() => store.renameGroup({ id: other.id, name: 'A' })).toThrow();
    expect(store.renameGroup({ id: other.id, name: 'B' })).toBe(true);
  });

  it('orders grouped automations first, then ungrouped, each by updated time', async () => {
    const { store, create } = fixture();
    const sleep = () => new Promise((resolve) => setTimeout(resolve, 2));
    const older = create('older');
    await sleep();
    const grouped = create('grouped');
    await sleep();
    const newest = create('newest');
    const group = store.createGroup({ name: 'G' });
    store.assignToGroup({ ids: [grouped], groupId: group.id });
    const ordered = store.list().automations.map((a) => a.name);
    expect(ordered[0]).toBe('grouped');
    // ungrouped keep updated_at DESC
    expect(ordered.slice(1)).toEqual(['newest', 'older']);
    void older;
    void newest;
  });

  it('assigns and ungroups automations', () => {
    const { store, create } = fixture();
    const a = create('a');
    const b = create('b');
    const group = store.createGroup({ name: 'G' });
    store.assignToGroup({ ids: [a, b], groupId: group.id });
    expect(store.get(a)?.groupId).toBe(group.id);
    expect(store.get(b)?.groupId).toBe(group.id);
    store.assignToGroup({ ids: [a], groupId: null });
    expect(store.get(a)?.groupId).toBeNull();
    expect(store.get(b)?.groupId).toBe(group.id);
  });

  it('rejects assigning to a missing group', () => {
    const { store, create } = fixture();
    const a = create('a');
    expect(() => store.assignToGroup({ ids: [a], groupId: 'missing' })).toThrow();
    expect(store.get(a)?.groupId).toBeNull();
  });

  it('dissolving a group returns members to ungrouped without deleting them', () => {
    const { store, create } = fixture();
    const a = create('a');
    const group = store.createGroup({ name: 'G' });
    store.assignToGroup({ ids: [a], groupId: group.id });
    expect(store.deleteGroup(group.id)).toBe(true);
    expect(store.listGroups()).toEqual([]);
    const automation = store.get(a);
    expect(automation).not.toBeNull();
    expect(automation?.groupId).toBeNull();
    expect(store.deleteGroup(group.id)).toBe(false);
  });
});

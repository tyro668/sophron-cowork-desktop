import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateMainSchema } from '../../src/main/db/database';
import { createSqliteScriptVersionStore } from '../../src/main/automation/script-packages/version-store';

let db: Database.Database | null = null;
afterEach(() => db?.close());

describe('script package version store (cowork.db)', () => {
  it('keeps version metadata that references git commits', () => {
    db = new Database(':memory:');
    migrateMainSchema(db);
    const store = createSqliteScriptVersionStore(db);
    store.insert({
      packageId: 'fx',
      version: 1,
      commit: 'a'.repeat(40),
      status: 'published',
      source: 'chat',
      entry: 'main.py',
      runtime: 'python',
      baseVersion: null,
      createdAt: 1,
      updatedAt: 1,
      publishedAt: 1,
    });
    store.insert({
      packageId: 'fx',
      version: 2,
      commit: 'b'.repeat(40),
      status: 'draft',
      source: 'ai_repair',
      entry: 'main.py',
      runtime: 'python',
      rulePrompt: '选择器失效',
      baseVersion: 1,
      automationId: 'auto-1',
      createdAt: 2,
      updatedAt: 2,
    });
    store.update('fx', 2, { commit: 'c'.repeat(40), rows: 12, updatedAt: 3 });
    const rows = store.list('fx');
    expect(rows.map((row) => row.version)).toEqual([1, 2]);
    expect(rows[1]).toMatchObject({
      commit: 'c'.repeat(40),
      source: 'ai_repair',
      automationId: 'auto-1',
      rows: 12,
      baseVersion: 1,
      updatedAt: 3,
    });
    store.delete('fx', 2);
    expect(store.list('fx')).toHaveLength(1);
    expect(store.list('other')).toEqual([]);
  });
});

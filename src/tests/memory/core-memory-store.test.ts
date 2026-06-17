import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CoreMemoryStore } from '../../main/memory/core-memory-store';

describe('CoreMemoryStore', () => {
  let tempRoot: string;
  let filePath: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-core-memory-'));
    filePath = path.join(tempRoot, 'core_memory.json');
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('keeps newly applied memories when the store is at capacity', () => {
    const store = new CoreMemoryStore(filePath, 2);
    store.applyActions([
      { op: 'upsert', category: 'preferences', key: 'language', value: '中文' },
      { op: 'upsert', category: 'skills', key: 'typescript', value: '熟悉 TypeScript' },
    ]);

    store.applyActions([
      { op: 'upsert', category: 'interests', key: 'memory', value: '关注 memory 系统' },
    ]);

    const keys = store.getEntries().map((entry) => entry.combinedKey);
    expect(keys).toContain('interests.memory');
    expect(keys).toHaveLength(2);
  });

  it('loads legacy key-value files and saves structured entries', () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        'identity.name': 'Jack',
      }),
      'utf8'
    );

    const store = new CoreMemoryStore(filePath);
    const [entry] = store.getEntries();
    expect(entry).toMatchObject({
      combinedKey: 'identity.name',
      value: 'Jack',
      status: 'active',
      confidence: 0.74,
    });

    store.applyActions([{ op: 'upsert', category: 'preferences', key: 'language', value: '中文' }]);

    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(Array.isArray(persisted.entries)).toBe(true);
    expect(persisted.entries.some((item) => item.status === 'active')).toBe(true);
    expect(persisted.entries.some((item) => item.combined_key === 'identity.name')).toBe(true);
  });
});

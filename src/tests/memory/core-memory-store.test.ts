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
      {
        op: 'upsert',
        category: 'preferences',
        key: 'language',
        value: '中文',
        confidence: 0.92,
        sourceType: 'explicit_user_statement',
      },
      {
        op: 'upsert',
        category: 'skills',
        key: 'typescript',
        value: '熟悉 TypeScript',
        confidence: 0.88,
        sourceType: 'explicit_user_statement',
      },
    ]);

    store.applyActions([
      {
        op: 'upsert',
        category: 'interests',
        key: 'memory',
        value: '关注 memory 系统',
        confidence: 0.78,
        sourceType: 'llm_inference',
      },
    ]);

    const keys = store.getEntries().map((entry) => entry.combinedKey);
    expect(keys).toContain('interests.memory');
    expect(keys).toHaveLength(2);
  });

  it('loads structured entries only when confidence signals are present', () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        entries: [
          {
            combined_key: 'identity.name',
            category: 'identity',
            key: 'name',
            value: 'Jack',
            confidence_signals: {
              source_type: 'explicit_user_statement',
              extraction_confidence: 0.92,
              evidence_count: 1,
              corroboration_count: 0,
              contradiction_count: 0,
              user_verified: false,
              calculation_version: 1,
            },
            status: 'active',
            evidence: [],
            created_at: '2026-06-17T00:00:00.000Z',
            updated_at: '2026-06-17T00:00:00.000Z',
          },
          {
            combined_key: 'preferences.language',
            category: 'preferences',
            key: 'language',
            value: '中文',
            status: 'active',
            evidence: [],
            created_at: '2026-06-17T00:00:00.000Z',
            updated_at: '2026-06-17T00:00:00.000Z',
          },
        ],
      }),
      'utf8'
    );

    const store = new CoreMemoryStore(filePath, 4);
    const entries = store.getEntries();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({
      combinedKey: 'identity.name',
      value: 'Jack',
      status: 'active',
      confidenceSignals: {
        sourceType: 'explicit_user_statement',
      },
    });
    expect(entry.confidence).toBeGreaterThan(0);

    store.applyActions([
      {
        op: 'upsert',
        category: 'preferences',
        key: 'language',
        value: '中文',
        confidence: 0.9,
        sourceType: 'explicit_user_statement',
      },
    ]);

    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(Array.isArray(persisted.entries)).toBe(true);
    expect(persisted.entries.some((item) => item.status === 'active')).toBe(true);
    expect(persisted.entries.some((item) => item.combined_key === 'identity.name')).toBe(true);
    expect(persisted.entries.some((item) => item.combined_key === 'preferences.language')).toBe(true);
    expect(persisted.entries.some((item) => item.confidence_signals)).toBe(true);
  });
});

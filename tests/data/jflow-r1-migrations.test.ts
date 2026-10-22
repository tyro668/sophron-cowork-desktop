import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../../src/main/data/data-pipeline-store';
import type { DatabaseInstance } from '../../src/main/db/database';
import { addDecimalPrecision } from '../../src/main/data/store/migrations';
import { assertIncrementalWriteAllowed } from '../../src/main/data/store/services/workflow-executor';
import { inputSourceFingerprint } from '../../src/main/data/store/source-fingerprint';

const roots: string[] = [];
const stores: DataPipelineStore[] = [];
const dbs: Database.Database[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function open(root: string, raw: Database.Database): DataPipelineStore {
  const store = createDataPipelineStore(path.join(root, 'workspace.duckdb'), {
    metadataDb: { raw } as unknown as DatabaseInstance,
  });
  stores.push(store);
  return store;
}

function nodeConfig(raw: Database.Database, id: string): Record<string, unknown> {
  const row = raw.prepare('SELECT config_json FROM data_workflow_nodes WHERE id = ?').get(id) as {
    config_json: string;
  };
  return JSON.parse(row.config_json) as Record<string, unknown>;
}

describe('v23 decimal_precision', () => {
  it('pins the pre-v23 physical type for scale-only decimals', () => {
    expect(
      addDecimalPrecision('cast', {
        conversions: [
          { field: 'a', type: 'decimal', scale: 2 },
          { field: 'b', type: 'decimal', scale: 4, precision: 10 },
          { field: 'c', type: 'text' },
        ],
      })
    ).toEqual({
      conversions: [
        { field: 'a', type: 'decimal', scale: 2, precision: 18 },
        { field: 'b', type: 'decimal', scale: 4, precision: 10 },
        { field: 'c', type: 'text' },
      ],
    });
    expect(addDecimalPrecision('cast', { conversions: [{ field: 'c', type: 'text' }] })).toBeNull();
    expect(addDecimalPrecision('filter', { condition: 'x' })).toBeNull();
  });
});

describe('v24–v26 one-time migrations', () => {
  it('migrates output intent/refs, registers physical outputs, allowPartial, fingerprints', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jflow-mig-'));
    roots.push(root);
    const raw = new Database(path.join(root, 'meta.sqlite'));
    dbs.push(raw);
    const store = open(root, raw);
    await store.getDashboard({});
    store.close();
    stores.splice(0);

    const now = 1;
    raw
      .prepare(
        `INSERT INTO data_pipelines (id, name, status, node_count, source_path, created_at, updated_at)
         VALUES ('p1', 'p', 'draft', 4, '/data/in.csv', 1, 1)`
      )
      .run();
    const insertNode = raw.prepare(
      `INSERT INTO data_workflow_nodes (id, pipeline_id, node_key, ordinal, operator_type, label, x, y, config_json, created_at, updated_at)
       VALUES (?, 'p1', ?, 0, ?, ?, 0, 0, ?, ?, ?)`
    );
    insertNode.run(
      'p1__in',
      'in',
      'input',
      'in',
      JSON.stringify({ source: 'pipeline', incrementalBy: 'ts' }),
      now,
      now
    );
    insertNode.run(
      'p1__legacy',
      'legacy',
      'output',
      'o1',
      JSON.stringify({ destination: 'duckdb_table', table: '老结果', mode: 'replace' }),
      now,
      now
    );
    insertNode.run(
      'p1__new',
      'new',
      'output',
      'o2',
      JSON.stringify({ outputStrategy: 'auto', mode: 'merge', mergeKeys: ['k'] }),
      now,
      now
    );
    raw
      .prepare(
        `INSERT INTO data_pipeline_watermarks (pipeline_id, node_id, column_name, watermark_value, updated_at)
         VALUES ('p1', 'p1__in', 'ts', '5', 1)`
      )
      .run();
    raw.prepare('DELETE FROM data_schema_migrations WHERE version >= 24').run();
    raw.prepare('ALTER TABLE data_pipeline_watermarks DROP COLUMN source_fingerprint').run();

    const reopened = open(root, raw);
    await reopened.getDashboard({});

    const legacy = nodeConfig(raw, 'p1__legacy');
    expect(legacy.intent).toBe('bound');
    const registered = raw
      .prepare('SELECT id, table_name, source_kind FROM data_raw_tables WHERE table_name = ?')
      .get('老结果') as { id: string; table_name: string; source_kind: string };
    expect(registered.source_kind).toBe('output');
    expect(legacy.outputResultTableId).toBe(registered.id);
    expect(legacy.ref).toEqual({ uri: `local:result/${registered.id}`, name: '老结果' });
    expect(legacy.allowPartial).toBe(true);

    const fresh = nodeConfig(raw, 'p1__new');
    expect(fresh.intent).toBe('new');
    expect(fresh.mode).toBe('merge');
    expect(fresh.allowPartial).toBeUndefined();

    const input = nodeConfig(raw, 'p1__in');
    expect(input.ref).toEqual({ uri: 'local:pipeline/p1', name: null });

    const wm = raw
      .prepare('SELECT source_fingerprint FROM data_pipeline_watermarks WHERE node_id = ?')
      .get('p1__in') as { source_fingerprint: string };
    expect(wm.source_fingerprint).toBe(inputSourceFingerprint(input, '/data/in.csv'));
  });

  it('fingerprint changes with resource, read options and incremental column, not lookback', () => {
    const base = { source: 'file', filePath: '/a.csv', incrementalBy: 'ts' };
    const fp = inputSourceFingerprint(base, null);
    expect(inputSourceFingerprint({ ...base, lookback: '1d' }, null)).toBe(fp);
    expect(inputSourceFingerprint({ ...base, filePath: '/b.csv' }, null)).not.toBe(fp);
    expect(inputSourceFingerprint({ ...base, sheet: 'S2' }, null)).not.toBe(fp);
    expect(inputSourceFingerprint({ ...base, range: 'A1:B2' }, null)).not.toBe(fp);
    expect(inputSourceFingerprint({ ...base, incrementalBy: 'id' }, null)).not.toBe(fp);
    const pipe = { source: 'pipeline', incrementalBy: 'ts' };
    expect(inputSourceFingerprint(pipe, '/x.csv')).not.toBe(inputSourceFingerprint(pipe, '/y.csv'));
  });
});

describe('E_INCR_REPLACE', () => {
  const node = (id: string, type: string, config: Record<string, unknown>) =>
    ({ id, type, label: id, config }) as never;
  it('rejects incremental source + replace unless allowPartial', () => {
    const input = node('i', 'input', { source: 'file', filePath: '/a.csv', incrementalBy: 'ts' });
    expect(() =>
      assertIncrementalWriteAllowed([input, node('o', 'output', { mode: 'replace' })])
    ).toThrow(/E_INCR_REPLACE/);
    expect(() =>
      assertIncrementalWriteAllowed([
        input,
        node('o', 'output', { mode: 'replace', allowPartial: true }),
      ])
    ).not.toThrow();
    expect(() =>
      assertIncrementalWriteAllowed([input, node('o', 'output', { mode: 'append' })])
    ).not.toThrow();
    const rawInput = node('i', 'input', {
      source: 'rawTable',
      rawTableId: 'r',
      incrementalBy: 'ts',
    });
    expect(() =>
      assertIncrementalWriteAllowed([rawInput, node('o', 'output', { mode: 'replace' })])
    ).not.toThrow();
  });
});

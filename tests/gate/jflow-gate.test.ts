/**
 * Gate: the three 场景_ pipelines, written in jflow (tests/jflow/fixtures), compiled by the app's
 * compiler and run by the app's own executor against a copy of the local workspace data, must
 * reproduce the reviewed baselines — and so must the export → re-import round trip and the 15
 * counterexamples (mutated inputs). Skipped (with the reason logged) when the local workspace data
 * or any of the three 场景_ pipelines is absent.
 */
import { afterAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { DuckDBInstance } from '@duckdb/node-api';
import { createDataPipelineStore } from '../../src/main/data/data-pipeline-store';
import type { DatabaseInstance } from '../../src/main/db/database';
import {
  compileWorkflowJflow,
  exportWorkflowJflow,
  parseJflow,
  type JflowCatalog,
} from '../../src/shared/jflow';

const DATA = process.env.SOPHRON_GATE_DATA || path.join(os.homedir(), '.config/sophron/data');
const HAVE_DATA =
  fs.existsSync(path.join(DATA, 'cowork.db')) && fs.existsSync(path.join(DATA, 'workspace.duckdb'));
const FIX = path.join(__dirname, '../jflow/fixtures');

const SCENARIOS = {
  sales: { pipeline: '场景_9月门店达成加工', rows: 44, hash: 'ce6f8ec9779b' },
  stock: { pipeline: '场景_缺货预警加工', rows: 13, hash: 'e23a439b12e2' },
  recon: { pipeline: '场景_银企对账加工', rows: 7, hash: '4fadefaf8241' },
} as const;
type ScenarioKey = keyof typeof SCENARIOS;

interface Counterexample {
  scenario: ScenarioKey;
  id: string;
  description: string;
  mutate: Record<string, string>;
  expect: { rows: number; hash: string } | { error: string };
}
const COUNTEREXAMPLES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'counterexamples.json'), 'utf8')
) as Counterexample[];

const roots: string[] = [];
afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

async function withDuck<T>(
  db: string,
  fn: (run: (sql: string) => Promise<Record<string, unknown>[]>) => Promise<T>
) {
  const inst = await DuckDBInstance.create(db);
  const con = await inst.connect();
  try {
    return await fn(
      async (sql) => (await con.runAndReadAll(sql)).getRowObjectsJson() as Record<string, unknown>[]
    );
  } finally {
    con.closeSync();
    inst.closeSync();
  }
}

/** Same hash as the reviewed baselines: sha1 of the JSON rows ordered by all columns. */
async function hashTable(db: string, table: string) {
  const rows = await withDuck(db, (q) => q(`select * from ${table} t order by all`));
  const text = `${JSON.stringify(rows)}\n`; // byte-identical to the baseline capture (console.log)
  return { rows: rows.length, hash: createHash('sha1').update(text).digest('hex').slice(0, 12) };
}

function copyWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jflow-gate-'));
  roots.push(root);
  for (const f of fs.readdirSync(DATA)) {
    if (f.startsWith('cowork.db'))
      fs.copyFileSync(path.join(DATA, f), path.join(root, f.replace('cowork.db', 'meta.db')));
  }
  fs.copyFileSync(path.join(DATA, 'workspace.duckdb'), path.join(root, 'ws.duckdb'));
  return root;
}

async function catalogFor(root: string, raw: Database.Database): Promise<JflowCatalog> {
  const tables = raw
    .prepare('select id, name, table_name, source_kind from data_raw_tables')
    .all() as Array<{
    id: string;
    name: string;
    table_name: string;
    source_kind: string | null;
  }>;
  const cols = await withDuck(path.join(root, 'ws.duckdb'), (q) =>
    q(
      "select table_name, column_name, data_type from information_schema.columns where table_schema = 'main' order by ordinal_position"
    )
  );
  const byTable = new Map<string, Array<{ name: string; type: string }>>();
  for (const c of cols) {
    const list = byTable.get(String(c.table_name)) ?? [];
    list.push({ name: String(c.column_name), type: String(c.data_type) });
    byTable.set(String(c.table_name), list);
  }
  return {
    tables: tables.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.source_kind === 'output' ? ('result' as const) : ('raw' as const),
      columns: byTable.get(t.table_name) ?? null,
    })),
  };
}

/** Run one scenario's jflow (optionally after mutating its sources) and hash the result. */
async function runScenario(key: ScenarioKey, mutate: Record<string, string> = {}) {
  const root = copyWorkspace();
  const text = fs.readFileSync(path.join(FIX, `${key}.jflow`), 'utf8');
  const sources = parseJflow(text).ast!.sources;
  if (Object.keys(mutate).length) {
    const meta = new Database(path.join(root, 'meta.db'), { readonly: true });
    const tableOf = (alias: string) => {
      const s = sources.find((x) => x.alias === alias)!;
      const id = s.ref.arg.replace(/^local:raw\//, '');
      return (
        meta.prepare('select table_name from data_raw_tables where id = ?').get(id) as {
          table_name: string;
        }
      ).table_name;
    };
    const plan = Object.entries(mutate).map(([alias, sql]) => [tableOf(alias), sql] as const);
    meta.close();
    await withDuck(path.join(root, 'ws.duckdb'), async (q) => {
      for (const [table, sql] of plan) {
        // Recreate (not DELETE/INSERT) so DuckDB can widen types the mutation needs.
        await q(`CREATE TABLE main.__gate_tmp AS ${sql.replace(/\bS\b/g, `main.${table}`)}`);
        await q(`DROP TABLE main.${table}`);
        await q(`ALTER TABLE main.__gate_tmp RENAME TO ${table}`);
      }
    });
  }
  const raw = new Database(path.join(root, 'meta.db'));
  const store = createDataPipelineStore(path.join(root, 'ws.duckdb'), {
    metadataDb: { raw } as unknown as DatabaseInstance,
  });
  try {
    const catalog = await catalogFor(root, raw);
    const pid = (
      raw.prepare('select id from data_pipelines where name = ?').get(SCENARIOS[key].pipeline) as {
        id: string;
      }
    ).id;
    const runText = async (source: string) => {
      const compiled = compileWorkflowJflow(source, catalog, pid);
      const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
      if (errors.length) throw new Error(`compile: ${JSON.stringify(errors)}`);
      await store.savePipelineWorkflow(pid, {
        nodes: compiled.nodes,
        edges: compiled.edges,
      } as never);
      await store.runPipeline(pid);
      const row = raw.prepare('select result_table from data_pipelines where id = ?').get(pid) as {
        result_table: string;
      };
      return hashTable(path.join(root, 'ws.duckdb'), row.result_table);
    };
    const first = await runText(text);
    // export the saved graph and run the re-imported text again
    const saved = await store.getPipelineWorkflow(pid);
    const exported = exportWorkflowJflow(saved.nodes, saved.edges, {
      pipelineName: SCENARIOS[key].pipeline,
    });
    expect(exported.diagnostics).toEqual([]);
    const second = await runText(exported.text);
    return { first, second };
  } finally {
    await (store as unknown as { close?: () => Promise<void> | void }).close?.();
    raw.close();
  }
}

function missingGatePipelines(): string[] {
  if (!HAVE_DATA) return [];
  const db = new Database(path.join(DATA, 'cowork.db'), { readonly: true, fileMustExist: true });
  try {
    return Object.values(SCENARIOS)
      .map((s) => s.pipeline)
      .filter((name) => !db.prepare('select 1 from data_pipelines where name = ?').get(name));
  } catch {
    return Object.values(SCENARIOS).map((s) => s.pipeline);
  } finally {
    db.close();
  }
}
const MISSING_PIPELINES = missingGatePipelines();
const GATE_SKIP_REASON = !HAVE_DATA
  ? `local workspace data not found in ${DATA}`
  : MISSING_PIPELINES.length
    ? `required 场景_ pipelines absent from the local workspace (${MISSING_PIPELINES.join(', ')})`
    : '';
if (GATE_SKIP_REASON) console.warn(`[jflow gate] skipped: ${GATE_SKIP_REASON}`);

describe.skipIf(Boolean(GATE_SKIP_REASON))(
  'jflow gate (app executor, local workspace data)',
  () => {
    for (const key of Object.keys(SCENARIOS) as ScenarioKey[]) {
      it(`${key}: baseline ${SCENARIOS[key].rows} rows / ${SCENARIOS[key].hash}, also after export → re-import`, async () => {
        const { first, second } = await runScenario(key);
        expect(first).toEqual({ rows: SCENARIOS[key].rows, hash: SCENARIOS[key].hash });
        expect(second).toEqual(first);
      }, 180_000);
    }
    for (const cx of COUNTEREXAMPLES) {
      it(`counterexample ${cx.id} (${cx.scenario}): ${cx.description}`, async () => {
        if ('error' in cx.expect) {
          await expect(runScenario(cx.scenario, cx.mutate)).rejects.toThrow(cx.expect.error);
        } else {
          const { first, second } = await runScenario(cx.scenario, cx.mutate);
          expect(first).toEqual(cx.expect);
          expect(second).toEqual(first);
        }
      }, 180_000);
    }
  }
);

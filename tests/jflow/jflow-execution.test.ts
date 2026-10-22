/**
 * End-to-end: jflow text → parse/bind/validate/compile → app executor → result rows → reverse
 * export → recompile → identical rows. Uses the app's own DataPipelineStore.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../../src/main/data/data-pipeline-store';
import {
  compileWorkflowJflow,
  exportWorkflowJflow,
  type JflowCatalog,
} from '../../src/shared/jflow';

const roots: string[] = [];
const stores: DataPipelineStore[] = [];
afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

async function rows(db: string, sql: string) {
  const inst = await DuckDBInstance.create(db);
  const con = await inst.connect();
  try {
    return (await con.runAndReadAll(sql)).getRowObjectsJson() as Record<string, unknown>[];
  } finally {
    con.closeSync();
    inst.closeSync();
  }
}

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jflow-e2e-'));
  roots.push(root);
  const db = path.join(root, 'workspace.duckdb');
  const store = createDataPipelineStore(db, { now: () => 1_780_000_000_000 });
  stores.push(store);
  const csv = async (name: string, lines: string[]) => {
    const p = path.join(root, `${name}.csv`);
    fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
    return store.importRawTable({ name, sourceKind: 'csv', filePath: p });
  };
  return { root, db, store, csv };
}

async function runText(
  store: DataPipelineStore,
  db: string,
  pipelineId: string,
  text: string,
  catalog: JflowCatalog
) {
  const compiled = compileWorkflowJflow(text, catalog, pipelineId);
  expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  await store.savePipelineWorkflow(pipelineId, {
    nodes: compiled.nodes,
    edges: compiled.edges,
  } as never);
  const run = await store.runPipeline(pipelineId);
  expect(run.status).toBe('completed');
  const saved = await store.getPipelineWorkflow(pipelineId);
  const out = saved.nodes.find((n) => n.type === 'output')!;
  const table = String((out.config as { table?: string }).table ?? '');
  return { saved, data: await rows(db, `select * from "${table}" order by all`) };
}

describe('jflow end-to-end through the app executor', () => {
  it('union + lookup + group + derive + sort + write, then round-trips through reverse export', async () => {
    const { db, store, csv } = await setup();
    const east = await csv('east', [
      '区域,门店,品类,销售额,销量',
      '华东,E1,饮料,100.5,3',
      '华东,E1,零食,50,2',
      '华东,E2,饮料,30,1',
    ]);
    const north = await csv('north', [
      '区域,门店,品类,销售额,销量',
      '华北,N1,饮料,10,1',
      '华北,N1,饮料,15,2',
    ]);
    const target = await csv('target', [
      '区域,门店,品类,目标销售额',
      '华东,E1,饮料,200',
      '华北,N1,饮料,50',
    ]);
    const pipeline = await store.createPipeline({ name: 'jflow e2e', sourceRawTableId: east.id });
    const catalog: JflowCatalog = {
      tables: [east, north, target].map((t) => ({
        id: t.id,
        name: t.name,
        kind: 'raw' as const,
        columns: null,
      })),
    };
    const text = `pipeline jflow_e2e

source e = @id('local:raw/${east.id}', 'east')
source n = @name('north')
source t = @id('local:raw/${target.id}', 'target')

let 北 = n
  | group [区域] = cast([区域] as text), [门店] = cast([门店] as text), [品类] = cast([品类] as text) (agg
      [销售额] = cast(sum([销售额]) as decimal(18,4)),
      [销量] = cast(sum([销量]) as integer))

e
  | cast [区域] as text, [门店] as text, [品类] as text, [销售额] as decimal(18,4), [销量] as integer
  | union 北
  | lookup t on [区域], [门店], [品类] get [目标销售额]
  | derive [达成率] = round([销售额] / nullif(cast([目标销售额] as decimal(18,4)), 0), 4),
           [档位] = if [销售额] >= 100 then '高' elseif [销售额] >= 40 then '中' else '低' end
  | sort [区域], [门店], [品类]
  | write @new('jflow_e2e_out')
`;
    const first = await runText(store, db, pipeline.id, text, catalog);
    expect(first.data.map((r) => `${r['门店']}/${r['品类']}/${r['档位']}`).sort()).toEqual(
      ['E1/零食/中', 'E1/饮料/高', 'E2/饮料/低', 'N1/饮料/低'].sort()
    );
    expect(first.data).toHaveLength(4);
    const n1 = first.data.find((r) => r['门店'] === 'N1')!;
    expect(Number(n1['销售额'])).toBe(25);
    expect(Number(n1['达成率'])).toBe(0.5);
    expect(first.data.find((r) => r['门店'] === 'E1' && r['品类'] === '饮料')!['档位']).toBe('高');

    // reverse export of the saved workflow: bound output, composites merged, stable ids
    const exported = exportWorkflowJflow(first.saved.nodes, first.saved.edges, {
      pipelineName: 'jflow_e2e',
    });
    expect(exported.diagnostics).toEqual([]);
    expect(exported.text).toContain(`write @id('local:result/`);
    expect(exported.text).toContain('| lookup ');
    const resultTable = (
      first.saved.nodes.find((n) => n.type === 'output')!.config as { outputResultTableId: string }
    ).outputResultTableId;
    const again = await runText(store, db, pipeline.id, exported.text, {
      tables: [...catalog.tables, { id: resultTable, name: 'jflow_e2e_out', kind: 'result' }],
    });
    expect(again.data).toEqual(first.data);
    expect(new Set(again.saved.nodes.map((n) => n.id))).toEqual(
      new Set(first.saved.nodes.map((n) => n.id))
    );
  }, 120_000);

  it('lookup fails on duplicate dimension keys (strict unique-key assertion)', async () => {
    const { db, store, csv } = await setup();
    const facts = await csv('facts', ['k,v', 'a,1', 'b,2']);
    const dim = await csv('dim', ['k,name', 'a,A', 'a,A2']);
    const pipeline = await store.createPipeline({
      name: 'jflow lookup dup',
      sourceRawTableId: facts.id,
    });
    const catalog: JflowCatalog = {
      tables: [facts, dim].map((t) => ({ id: t.id, name: t.name, kind: 'raw' as const })),
    };
    const compiled = compileWorkflowJflow(
      `source f = @name('facts')\nsource d = @name('dim')\nf | lookup d on [k] get [name] | write @new('dup_out')\n`,
      catalog,
      pipeline.id
    );
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    } as never);
    const run = await store
      .runPipeline(pipeline.id)
      .catch((e: unknown) => ({ status: 'failed', error: String(e) }));
    expect(run.status).not.toBe('completed');
    void db;
  }, 120_000);
});

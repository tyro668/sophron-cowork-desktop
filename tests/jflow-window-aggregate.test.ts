import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { createDataPipelineStore } from '../src/main/data/data-pipeline-store';
import {
  applyJflowFix,
  compileWorkflowJflow,
  expressionAggregateIssue,
  exportWorkflowJflow,
} from '../src/shared/jflow';
import { parseJflowExpr } from '../src/shared/jflow/parse';
import { fmtExpr } from '../src/shared/jflow/format';
import { parseExpression } from '../src/shared/expression/parser';
import { describeWindowValue, windowSuggestionAt } from '../src/shared/expression/window-suggest';
import { buildWorkflowPlan } from '../src/shared/workflow-plan/build';
import { propagateWorkflowPlanSchemas } from '../src/shared/workflow-plan/schema';
import { buildWindowCompareExpression } from '../src/shared/calculate-field/window-compare';
import { parseConditionTree, buildFilterConditionTree } from '../src/shared/filter-condition';

const TABLE = { id: 't1', name: 's', kind: 'raw' as const, columns: null };
const doc = (step: string) =>
  `source s = @id('local:raw/t1', 's')\ns\n  ${step}\n  | write @new('o')\n`;
const compile = (step: string) => compileWorkflowJflow(doc(step), { tables: [TABLE] }, 'p1');
const errors = (step: string) => compile(step).diagnostics.filter((d) => d.severity === 'error');

describe('jflow window values: parse / format', () => {
  it.each([
    ['avg([销售额]) over ()', 'avg([销售额]) over ()'],
    ['avg([销售额]) over (by: [区域])', 'avg([销售额]) over (by: [区域])'],
    ['avg([销售额]) over (partition by [区域])', 'avg([销售额]) over (by: [区域])'],
    ['rank() over (by: [区域] sort: -[销售额])', 'rank() over (by: [区域] sort: -[销售额])'],
    ['sum([x]) over (by: [a], [b] sort: [d])', 'sum([x]) over (by: [a], [b] sort: [d])'],
  ])('%s', (input, expected) => {
    const parsed = parseJflowExpr(input);
    expect(parsed.diagnostics).toEqual([]);
    expect(fmtExpr(parsed.ast!, 'jflow')).toBe(expected);
    const cfg = fmtExpr(parsed.ast!, 'cfg');
    // the stored dialect stays SQL-style and the app parser reads both forms
    expect(cfg).not.toContain('by:');
    expect(() => parseExpression(cfg)).not.toThrow();
    expect(() => parseExpression(expected)).not.toThrow();
  });
});

describe('jflow window values: diagnostics and quick-fixes', () => {
  it('nested aggregate keeps E_AGG_NESTED with a group + over () fix', () => {
    const errs = errors('| group [门店] (agg [均] = avg(sum([销售额])))');
    expect(errs.map((e) => e.code)).toEqual(['E_AGG_NESTED']);
    expect(errs[0].hint).toContain('over ()');
    const fixed = applyJflowFix(
      doc('| group [门店] (agg [均] = avg(sum([销售额])))'),
      errs[0].fix!
    );
    expect(fixed).toContain('group [门店] (agg [销售额合计] = sum([销售额]))');
    expect(fixed).toContain('derive [均] = avg([销售额合计]) over ()');
    expect(
      compileWorkflowJflow(fixed, { tables: [TABLE] }, 'p1').diagnostics.filter(
        (d) => d.severity === 'error'
      )
    ).toEqual([]);
  });

  it('nested fix on an exported workflow (with #! id pragmas) re-imports without id clashes', () => {
    const compiled = compileWorkflowJflow(
      doc('| group [门店] (agg [a] = sum([销售额]), [b] = avg([销售额])) | derive [x] = 1'),
      { tables: [TABLE] },
      'p1'
    );
    const group = compiled.nodes.find((n) => n.type === 'aggregate')!;
    (group.config as { metrics: Array<{ expression: string }> }).metrics[1].expression =
      'sum([销售额])';
    const text = exportWorkflowJflow(compiled.nodes, compiled.edges, {}).text;
    const fix = compileWorkflowJflow(text, { tables: [TABLE] }, 'p1').diagnostics.find(
      (d) => d.code === 'E_AGG_NESTED'
    )!.fix!;
    const fixed = applyJflowFix(text, fix);
    expect(compileWorkflowJflow(fixed, { tables: [TABLE] }, 'p1').diagnostics).toEqual([]);
  });

  it.each([
    "| derive [达标] = if [销售额] >= avg([销售额]) then '达标' else '不达标' end",
    '| where [销售额] > avg([销售额])',
  ])('bare aggregate in row context offers "add over ()": %s', (step) => {
    const errs = errors(step);
    expect(errs[0].code).toBe('E_AGG_ROW');
    const fixed = applyJflowFix(doc(step), errs[0].fix!);
    expect(fixed).toContain('avg([销售额]) over ()');
    expect(
      compileWorkflowJflow(fixed, { tables: [TABLE] }, 'p1').diagnostics.filter(
        (d) => d.severity === 'error'
      )
    ).toEqual([]);
  });

  it('form lint: row and metric contexts', () => {
    expect(expressionAggregateIssue('avg([销售额]) over ()', 'row')).toBeNull();
    expect(expressionAggregateIssue('[销售额] - avg([销售额])', 'row')?.fixText).toMatch(
      /avg\(\[销售额\]\) over ?\(\)/
    );
    expect(expressionAggregateIssue('sum([销售额])', 'metric')?.code).toBe('E_AGG_NESTED');
    expect(expressionAggregateIssue('[销售额] * 2', 'metric')).toBeNull();
  });
});

describe('window helpers', () => {
  it('suggests over after an aggregate call only', () => {
    expect(windowSuggestionAt('avg([销售额]) ')?.options.map((o) => o.apply)).toEqual([
      'over ()',
      'over (by: ',
    ]);
    expect(windowSuggestionAt('avg([销售额]) ov')?.from).toBe(11);
    expect(windowSuggestionAt('upper([a]) ')).toBeNull();
    expect(windowSuggestionAt('avg([销售额])')).toBeNull();
  });

  it('describes window values for field lists and lineage', () => {
    expect(describeWindowValue('avg([销售额]) over ()')?.label).toBe('avg · 全部行');
    expect(describeWindowValue('[x] / sum([销售额]) over (by: [区域])')?.label).toBe(
      'sum · 按 区域'
    );
    expect(describeWindowValue('[销售额] * 2')).toBeNull();
  });

  it('builds wizard compare expressions', () => {
    expect(buildWindowCompareExpression({ fn: 'avg', field: '销售额' })).toBe(
      'avg([销售额]) over ()'
    );
    expect(
      buildWindowCompareExpression({
        fn: 'sum',
        field: '销售额',
        partitionBy: ['区域'],
        mode: 'ratio',
      })
    ).toContain('over (by: [区域])');
    expect(
      buildWindowCompareExpression({
        fn: 'avg',
        field: '销售额',
        mode: 'flag',
        flagLabels: ['达标', '不达标'],
      })
    ).toBe("if [销售额] >= avg([销售额]) over () then '达标' else '不达标' end");
  });

  it('filter condition keeps a window value on the right-hand side', () => {
    const condition = '[销售额] > avg([销售额]) over (by: [区域])';
    const tree = parseConditionTree(condition);
    expect(buildFilterConditionTree(tree)).toBe(condition);
  });
});

async function readRows(db: string, sql: string) {
  const inst = await DuckDBInstance.create(db);
  const con = await inst.connect();
  try {
    return (await con.runAndReadAll(sql)).getRowObjectsJson();
  } finally {
    con.closeSync();
    inst.closeSync();
  }
}

async function run(step: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jflow-win-'));
  const db = path.join(root, 'w.duckdb');
  const store = createDataPipelineStore(db, { now: () => 1 });
  try {
    const csv = path.join(root, 's.csv');
    fs.writeFileSync(csv, '区域,门店,销售额\n华东,A,10\n华东,B,30\n华北,C,5\n华北,C,15\n');
    const table = await store.importRawTable({ name: 's', sourceKind: 'csv', filePath: csv });
    const pipeline = await store.createPipeline({ name: 'w', sourceRawTableId: table.id });
    const text = `source s = @id('local:raw/${table.id}', 's')\ns\n  ${step}\n  | write @new('o')\n`;
    const compiled = compileWorkflowJflow(
      text,
      { tables: [{ ...TABLE, id: table.id }] },
      pipeline.id
    );
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    } as never);
    const result = await store.runPipeline(pipeline.id);
    expect(result.status).toBe('completed');
    const saved = await store.getPipelineWorkflow(pipeline.id);
    const output = saved.nodes.find((n) => n.type === 'output')!;
    const rows = await readRows(
      db,
      `select * from "${(output.config as { table: string }).table}" order by all`
    );
    const exported = exportWorkflowJflow(saved.nodes, saved.edges, {}).text;
    return { rows, exported };
  } finally {
    store.close();
  }
}

describe('jflow window values: execute + round-trip', () => {
  it('derive chain references an earlier window field', async () => {
    const step = '| derive [均值] = avg([销售额]) over (by: [区域]), [差] = [销售额] - [均值]';
    const { rows, exported } = await run(step);
    expect(rows.map((r) => [r.均值, r.差])).toEqual([
      [20, -10],
      [20, 10],
      [10, -5],
      [10, 5],
    ]);
    expect(exported).toContain(step);
  });

  it('inline if flag', async () => {
    const step =
      "| derive [达标] = if [销售额] >= avg([销售额]) over () then '达标' else '不达标' end";
    const { rows, exported } = await run(step);
    expect(rows.map((r) => r.达标)).toEqual(['不达标', '达标', '不达标', '达标']);
    expect(exported).toContain(step);
  });

  it('where with a window value', async () => {
    const step = '| where [销售额] > avg([销售额]) over (by: [区域])';
    const { rows, exported } = await run(step);
    expect(rows.map((r) => r.销售额)).toEqual(['30', '15']);
    expect(Object.keys(rows[0])).toEqual(['区域', '门店', '销售额']);
    expect(exported).toContain(step);
  });

  it('rank and ratio', async () => {
    const rank = await run('| derive [名次] = rank() over (by: [区域] sort: -[销售额])');
    expect(rank.rows.map((r) => r.名次)).toEqual(['2', '1', '2', '1']);
    expect(rank.exported).toContain('rank() over (by: [区域] sort: -[销售额])');
    const ratio = await run('| derive [占比] = [销售额] / sum([销售额]) over ()');
    expect(ratio.rows.map((r) => r.占比)).toEqual([10 / 60, 30 / 60, 5 / 60, 15 / 60]);
  });

  it('two levels: group total vs average across groups', async () => {
    const { rows } = await run(
      "| group [门店] (agg [合计] = sum([销售额])) | derive [均] = avg([合计]) over (), [达标] = if [合计] >= [均] then '达标' else '不达标' end"
    );
    expect(rows.map((r) => [r.门店, r.达标])).toEqual([
      ['A', '不达标'],
      ['B', '达标'],
      ['C', '达标'],
    ]);
  });
});

describe('draft schema keeps window / aggregate columns typed', () => {
  it('group → over () → flag', () => {
    const compiled = compile(
      "| group [门店] (agg [合计] = sum([销售额])) | derive [均值] = avg([合计]) over (), [标记] = if [合计] >= [均值] then '达标' else '未达标' end"
    );
    const { plan } = buildWorkflowPlan({ nodes: compiled.nodes, edges: compiled.edges } as never);
    const { schemas } = propagateWorkflowPlanSchemas(plan, (n) =>
      n.type === 'input'
        ? [
            { name: '门店', type: 'text' },
            { name: '销售额', type: 'decimal' },
          ]
        : null
    );
    const derive = compiled.nodes.find((n) => n.type === 'derive')!;
    expect(schemas.get(derive.id)?.columns).toEqual([
      { name: '门店', type: 'text' },
      { name: '合计', type: 'decimal' },
      { name: '均值', type: 'decimal' },
      { name: '标记', type: 'text' },
    ]);
  });
});

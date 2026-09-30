import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DuckDBInstance } from '@duckdb/node-api';
import { formatSqlQuery, normalizeSqlQuery } from '../src/shared/sql-query';
import { SqlQueryConfigSchema } from '../src/shared/operator-schemas/sql-query';
import {
  parsePrepOperatorDsl,
  parsePrepDsl,
  compilePrepWorkflowToFlow,
  exportPrepWorkflowDsl,
} from '../src/shared/prep-dsl';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';
import { buildSqlQuery, describeSqlQuery } from '../src/main/data/operators/sql-query';

const roots: string[] = [];
const stores: DataTaskStore[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

async function fixture(sql: string, tail = '') {
  const root = mkdtempSync(join(tmpdir(), 'sophron-sql-operator-'));
  roots.push(root);
  const sourcePath = join(root, 'input.csv');
  writeFileSync(sourcePath, 'id,group_name,amount\n1,A,10\n2,A,20\n3,B,5\n');
  const store = createDataTaskStore(join(root, 'workspace.duckdb'));
  stores.push(store);
  const task = await store.createTask({ name: 'SQL test', sourcePath });
  const parsed = parsePrepDsl(
    `input source task as src\n | sql ${JSON.stringify(sql)}\n${tail}\n | output table "sql_result"`
  );
  expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  const flow = compilePrepWorkflowToFlow(parsed.ast!);
  expect(flow.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  const workflow = { nodes: flow.nodes, edges: flow.edges };
  return { store, task, workflow };
}

async function previewOutput(
  store: DataTaskStore,
  taskId: string,
  workflow: Awaited<ReturnType<typeof fixture>>['workflow']
) {
  const output = workflow.nodes.find((node) => node.type === 'output')!;
  return store.previewWorkflowNode({
    taskId,
    nodeId: output.id,
    nodeType: output.type,
    nodeConfig: output.config,
  });
}

describe('SQL query lexical contract and DSL', () => {
  it.each([
    "SELECT ';' AS s; -- final comment",
    '/* outer /* nested */ comment */ SELECT $$x;y$$ AS s;',
    "SELECT E'it\\'s; fine' AS s;",
    'SELECT "column;name" FROM input;',
  ])('preserves quoted delimiters: %s', (sql) => {
    expect(SqlQueryConfigSchema.safeParse({ sql }).success).toBe(true);
    expect(normalizeSqlQuery(sql)).toContain('SELECT');
  });
  it.each([
    '',
    '-- empty',
    'DELETE FROM input',
    'CREATE TABLE x AS SELECT 1',
    'SELECT 1; SELECT 2',
    "SELECT 'unterminated",
    '/* open',
    'SELECT 1; /* comment */ DROP TABLE x',
  ])('rejects invalid query framing: %s', (sql) => {
    expect(SqlQueryConfigSchema.safeParse({ sql }).success).toBe(false);
  });
  it('round-trips multiline SQL, quotes, backslashes, comments and pipes through DSL', async () => {
    const sql = `-- # comment | stays intact\nWITH totals AS (SELECT group_name, sum(amount) AS total FROM input GROUP BY group_name)\nSELECT *, 'a|b\\c' AS "引用" FROM totals;`;
    const { workflow } = await fixture(sql);
    const exported = exportPrepWorkflowDsl(workflow.nodes, workflow.edges);
    const parsed = parsePrepDsl(exported);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    const again = compilePrepWorkflowToFlow(parsed.ast!);
    expect(again.nodes.find((node) => node.type === 'sql_query')?.config?.sql).toBe(sql);
    expect(parsePrepOperatorDsl(`sql ${JSON.stringify(sql)}`, 'sql_query').diagnostics).toEqual([]);
  });
});

describe('SQL query native execution', () => {
  it('binds CTEs and window functions, infers downstream fields before running, and previews actual results', async () => {
    const sql = `WITH totals AS (SELECT group_name, sum(amount) AS total FROM input GROUP BY group_name)\nSELECT *, row_number() OVER (ORDER BY total DESC) AS position FROM totals; -- done`;
    const { store, task, workflow } = await fixture(sql, ' | filter [total] > 10');
    const saved = await store.saveTaskWorkflow(task.id, workflow);
    const node = saved.nodes.find((item) => item.type === 'sql_query')!;
    const columns = await store.getWorkflowNodeColumns({
      taskId: task.id,
      nodeId: node.id,
      nodeType: node.type,
      nodeConfig: node.config,
      workflow: saved,
    });
    expect(columns).toEqual(['group_name', 'total', 'position']);
    await store.runTask(task.id);
    const preview = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: node.id,
      nodeType: node.type,
      nodeConfig: node.config,
    });
    expect(preview.columns).toEqual(columns);
    expect(preview.rows).toHaveLength(2);
    expect(Number(preview.rows[0].total)).toBe(30);
    const output = await previewOutput(store, task.id, workflow);
    expect(output.rows).toHaveLength(1);
  });
  it('infers chained SQL outputs including list types and executes a self join', async () => {
    const { store, task, workflow } = await fixture(
      'SELECT id, [amount, amount * 2] AS values_list FROM input',
      ` | sql ${JSON.stringify('SELECT a.id, list_sum(a.values_list) AS total FROM input a JOIN input b ON a.id = b.id')}\n | filter [total] > 25`
    );
    await store.saveTaskWorkflow(task.id, workflow);
    await store.runTask(task.id);
    const output = await previewOutput(store, task.id, workflow);
    expect(output.columns).toEqual(['id', 'total']);
    expect(output.rows).toHaveLength(2);
  });
  it('reports SQL syntax and binding failures before save, and checks downstream renamed fields', async () => {
    const { store, task, workflow } = await fixture(
      'SELECT amount AS renamed FROM input',
      ' | filter [amount] > 0'
    );
    await expect(store.saveTaskWorkflow(task.id, workflow)).rejects.toThrow(/amount/);
    const node = workflow.nodes.find((item) => item.type === 'sql_query')!;
    node.config!.sql = 'SELECT missing_field FROM input';
    await expect(store.saveTaskWorkflow(task.id, workflow)).rejects.toThrow(/missing_field/);
    node.config!.sql = 'SELECT * FRM input';
    await expect(store.saveTaskWorkflow(task.id, workflow)).rejects.toThrow();
  });
  it('keeps SQL after an untyped calculated column executable', async () => {
    const { store, task, workflow } = await fixture('SELECT * FROM input');
    const dsl = `input source task as src\n | derive [doubled] = [amount] * 2\n | sql ${JSON.stringify('SELECT sum(doubled) AS total FROM input')}\n | output table "sql_result"`;
    const flow = compilePrepWorkflowToFlow(parsePrepDsl(dsl).ast!);
    await store.saveTaskWorkflow(task.id, { ...workflow, nodes: flow.nodes, edges: flow.edges });
    await store.runTask(task.id);
    expect(Number((await previewOutput(store, task.id, workflow)).rows[0].total)).toBe(70);
  });
  it('prevents statement injection and validates schemas without running expressions', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      await connection.run('CREATE TABLE protected (id INTEGER); CREATE SEQUENCE seq START 1');
      const schema = await describeSqlQuery(
        connection,
        buildSqlQuery("SELECT nextval('seq') AS value", 'SELECT 1')
      );
      expect(schema[0].name).toBe('value');
      expect(
        (await connection.runAndReadAll("SELECT nextval('seq') AS value")).getRowObjectsJson()[0]
          .value
      ).toBe('1');
      for (const sql of [
        'SELECT 1) AS x; DROP TABLE protected; --',
        'WITH x AS (DELETE FROM protected RETURNING *) SELECT * FROM x',
        'SELECT 1; DROP TABLE protected',
      ]) {
        await expect(
          (async () => describeSqlQuery(connection, buildSqlQuery(sql, 'SELECT 1')))()
        ).rejects.toThrow();
      }
      expect(
        (
          await connection.runAndReadAll('SELECT count(*) AS n FROM protected')
        ).getRowObjectsJson()[0].n
      ).toBe('0');
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });
});

describe('formatSqlQuery', () => {
  it('breaks clauses onto separate lines and expands the select list', () => {
    expect(formatSqlQuery('select a, b from input where a > 0')).toBe(
      'SELECT\n    a,\n    b\nFROM input\nWHERE a > 0\n'
    );
  });

  it('handles multi-word clause heads, joins, and function calls', () => {
    expect(
      formatSqlQuery(
        'select count(*) as c, sum(x) from input a left join t2 b on a.id=b.id group by a having count(*)>1 order by c desc limit 10;'
      )
    ).toBe(
      'SELECT\n    count(*) AS c,\n    sum(x)\nFROM input a\nLEFT JOIN t2 b ON a.id = b.id\nGROUP BY a\nHAVING count(*) > 1\nORDER BY c DESC\nLIMIT 10;\n'
    );
  });

  it('preserves quoted identifiers and unary signs', () => {
    expect(formatSqlQuery('select "采购成本人民币", -1 as neg from input')).toBe(
      'SELECT\n    "采购成本人民币",\n    -1 AS neg\nFROM input\n'
    );
  });

  it('returns the original text when quoting is unterminated', () => {
    const broken = "select 'oops from input";
    expect(formatSqlQuery(broken)).toBe(broken);
  });
});

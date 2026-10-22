import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../src/main/data/data-pipeline-store';
import { compileTestJflow, jflowTestWorkflow, parseTestJflow } from './helpers/jflow-test-workflow';

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

describe('operator DSL execution cases', () => {
  it('sorts by a backtick-quoted field containing spaces', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const pricesPath = path.join(tempRoot, 'unit-prices.csv');
    fs.writeFileSync(
      pricesPath,
      ['Product,Unit Price,记录数', 'B,10,1', 'A,5,1', 'C,20,1'].join('\n') + '\n',
      'utf8'
    );

    const pipeline = await store.createPipeline({
      name: 'Executable quoted-field sort',
      sourcePath: pricesPath,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
      source prices = @id('local:pipeline/self')

      prices
        | drop [记录数]
        | sort [Unit Price]
        | write @new('operator_quoted_sort_output')
    `
    );

    const workflow = await store.getPipelineWorkflow(pipeline.id);
    expect(workflow.nodes.find((node) => node.type === 'sort')?.config.orderBy).toEqual([
      { field: 'Unit Price', direction: 'asc' },
    ]);

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    const rows = await queryRows(
      dbPath,
      'SELECT Product, "Unit Price" FROM operator_quoted_sort_output'
    );
    expect(rows.map((row) => Number(row['Unit Price']))).toEqual([5, 10, 20]);
  });

  it('executes a reusable cleaning workflow across current single-input operators', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const ordersPath = path.join(tempRoot, 'orders.csv');
    fs.writeFileSync(
      ordersPath,
      [
        'order_id,dt,region,rev,profit,status,updated_at',
        '1,2026-01-01,East,100,40,PAID,2026-01-02',
        '1,2026-01-01,East,120,50,PAID,2026-01-03',
        '2,2026-01-02,,0,0,PAID,2026-01-04',
        '3,2026-01-03,N/A,30,10,PAID,2026-01-05',
        '4,2026-01-04,West,20,5,REFUND,2026-01-06',
      ].join('\n') + '\n',
      'utf8'
    );

    const pipeline = await store.createPipeline({
      name: 'Executable cleaning operators',
      sourcePath: ordersPath,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
        source orders = @id('local:pipeline/self')

        orders
          | select [order_id], [dt], [region], [rev], [profit], [status], [updated_at]
          | rename [dt] as [order_date], [rev] as [revenue]
          | cast [order_date] as date format: '%Y-%m-%d' on_error: null, [revenue] as float on_error: null, [profit] as float on_error: null
          | nullify [region] values ('', 'N/A')
          | fill [region] with 'UNKNOWN'
          | distinct by: [order_id] sort: -[updated_at] keep: first
          | derive [margin] = [profit] / nullif([revenue], 0)
          | where [status] = 'PAID' and [revenue] > 0
          | group [region] (agg [total_revenue] = sum([revenue]), [row_count] = count(*))
          | sort -[total_revenue]
          | write @new('operator_cleaning_output')
      `
    );

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.resultTable).toBe('operator_cleaning_output');
    expect(completed.rowCount).toBe(2);

    const rows = await queryRows(
      dbPath,
      'SELECT region, total_revenue, row_count FROM operator_cleaning_output ORDER BY total_revenue DESC'
    );
    expect(
      rows.map((row) => ({
        region: row.region,
        total_revenue: Number(row.total_revenue),
        row_count: Number(row.row_count),
      }))
    ).toEqual([
      { region: 'East', total_revenue: 120, row_count: 1 },
      { region: 'UNKNOWN', total_revenue: 30, row_count: 1 },
    ]);
  });

  it('nullifies text markers safely after a column has already been converted', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const pricesPath = path.join(tempRoot, 'typed-missing-markers.csv');
    fs.writeFileSync(pricesPath, ['adj_close', '8.34', '16.14'].join('\n') + '\n', 'utf8');

    const pipeline = await store.createPipeline({
      name: 'Typed missing marker comparison',
      sourcePath: pricesPath,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
      source prices = @id('local:pipeline/self')

      prices
        | cast [adj_close] as decimal on_error: null
        | nullify [adj_close] values ('NULL', 'N/A')
        | write @new('typed_missing_marker_output')
    `
    );

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.rowCount).toBe(2);

    const rows = await queryRows(
      dbPath,
      'SELECT adj_close FROM typed_missing_marker_output ORDER BY adj_close'
    );
    expect(rows.map((row) => Number(row.adj_close))).toEqual([8.34, 16.14]);
  });

  it('executes derive window expressions without introducing a separate window operator', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const ordersPath = path.join(tempRoot, 'ranked-orders.csv');
    fs.writeFileSync(
      ordersPath,
      [
        'order_id,region,revenue',
        '1,East,10',
        '2,East,30',
        '3,East,20',
        '4,West,5',
        '5,West,40',
      ].join('\n') + '\n',
      'utf8'
    );

    const pipeline = await store.createPipeline({
      name: 'Executable window derive',
      sourcePath: ordersPath,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
        source orders = @id('local:pipeline/self')

        orders
          | cast [revenue] as float on_error: null
          | derive [rn] = row_number() over (partition by [region] order by [revenue] desc)
          | where [rn] <= 2
          | sort [region], [rn]
          | write @new('operator_window_derive_output')
      `
    );

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.resultTable).toBe('operator_window_derive_output');
    expect(completed.rowCount).toBe(4);

    const rows = await queryRows(
      dbPath,
      'SELECT order_id, region, revenue, rn FROM operator_window_derive_output ORDER BY region, rn'
    );
    expect(
      rows.map((row) => ({
        order_id: String(row.order_id),
        region: row.region,
        revenue: Number(row.revenue),
        rn: Number(row.rn),
      }))
    ).toEqual([
      { order_id: '2', region: 'East', revenue: 30, rn: 1 },
      { order_id: '3', region: 'East', revenue: 20, rn: 2 },
      { order_id: '5', region: 'West', revenue: 40, rn: 1 },
      { order_id: '4', region: 'West', revenue: 5, rn: 2 },
    ]);
  });

  it('overwrites an existing field when derive targets the same field name', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const pricesPath = path.join(tempRoot, 'prices.csv');
    fs.writeFileSync(
      pricesPath,
      ['Ticker,Adj Close', 'FIRE,$8.34', 'SYMC,$16.14'].join('\n') + '\n',
      'utf8'
    );

    const pipeline = await store.createPipeline({
      name: 'Executable same-field derive',
      sourcePath: pricesPath,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
        source prices = @id('local:pipeline/self')

        prices
          | derive replace [Adj Close] = cast(replace([Adj Close], '$', '') as decimal(18,2))
          | write @new('operator_same_field_derive_output')
      `
    );

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.resultTable).toBe('operator_same_field_derive_output');

    const rows = await queryRows(
      dbPath,
      'SELECT "Ticker", "Adj Close" FROM operator_same_field_derive_output ORDER BY "Ticker"'
    );
    expect(rows.map((row) => row.Ticker)).toEqual(['FIRE', 'SYMC']);
    expect(Number(rows[0]['Adj Close'])).toBe(8.34);
    expect(Number(rows[1]['Adj Close'])).toBe(16.14);
  });

  it('preserves decimal values when filtering and sorting by the same column', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const profitPath = path.join(tempRoot, 'profit.csv');
    fs.writeFileSync(
      profitPath,
      [
        'Row ID,Profit,Sales',
        '1,-5.5,10',
        '2,29.64,66.12',
        '3,3.12,314.22',
        '4,106.14,408.3',
        '5,0,12',
      ].join('\n') + '\n',
      'utf8'
    );

    const pipeline = await store.createPipeline({
      name: 'Executable profit filter sort',
      sourcePath: profitPath,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
      source profit = @id('local:pipeline/self')

      profit
        | where [Profit] >= 0
        | sort [Profit]
        | write @new('operator_profit_filter_sort_output')
    `
    );

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.resultTable).toBe('operator_profit_filter_sort_output');

    const rows = await queryRows(
      dbPath,
      'SELECT "Row ID", Profit, Sales FROM operator_profit_filter_sort_output ORDER BY Profit ASC'
    );
    expect(rows.map((row) => Number(row.Profit))).toEqual([0, 3.12, 29.64, 106.14]);
  });

  it('preserves decimal values when filtering and sorting a rawTable input source', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const profitPath = path.join(tempRoot, 'profit-rawTable.csv');
    fs.writeFileSync(
      profitPath,
      [
        'Row ID,Profit,Sales',
        '1,-5.5,10',
        '2,29.64,66.12',
        '3,3.12,314.22',
        '4,106.14,408.3',
        '5,0,12',
      ].join('\n') + '\n',
      'utf8'
    );
    const input = await store.importRawTable({
      name: 'profit rawTable',
      sourceKind: 'csv',
      filePath: profitPath,
    });

    const pipeline = await store.createPipeline({
      name: 'Executable profit rawTable filter sort',
      sourceRawTableId: input.id,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:raw/${input.id}')

      src
        | where [Profit] >= 0
        | sort [Profit]
        | write @new('operator_profit_rawTable_filter_sort_output')
    `
    );

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.resultTable).toBe('operator_profit_rawTable_filter_sort_output');

    const rows = await queryRows(
      dbPath,
      'SELECT "Row ID", Profit, Sales FROM operator_profit_rawTable_filter_sort_output ORDER BY Profit ASC'
    );
    expect(rows.map((row) => Number(row.Profit))).toEqual([0, 3.12, 29.64, 106.14]);
  });

  it('converts text to date with try_strptime and partial error rows', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const datesPath = path.join(tempRoot, 'dates.csv');
    fs.writeFileSync(
      datesPath,
      ['id,val', '1,2024-03-15', '2,invalid', '3,2024-06-01'].join('\n') + '\n',
      'utf8'
    );

    const pipeline = await store.createPipeline({
      name: 'try_strptime partial error',
      sourcePath: datesPath,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
      source dates = @id('local:pipeline/self')

      dates
        | cast [val] as date on_error: null format: '%Y-%m-%d'
        | write @new('operator_try_strptime_output')
    `
    );

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    const resultTable = completed.resultTable!;

    const rows = await queryRows(dbPath, `SELECT id, val FROM ${resultTable} ORDER BY id`);
    expect(rows.map((r) => String(r.id))).toEqual(['1', '2', '3']);
    expect(String(rows[0].val)).toBe('2024-03-15');
    expect(rows[1].val).toBeNull();
    expect(String(rows[2].val)).toBe('2024-06-01');
  });

  it('converts text to datetime with try_strptime and mixed timezone offsets', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const tsPath = path.join(tempRoot, 'timestamps.csv');
    fs.writeFileSync(
      tsPath,
      [
        'id,val',
        '1,2024-03-15T10:00:00+08:00',
        '2,2024-03-15T02:00:00Z',
        '3,2024-12-25T23:59:59+14:00',
      ].join('\n') + '\n',
      'utf8'
    );

    const pipeline = await store.createPipeline({
      name: 'try_strptime tz offsets',
      sourcePath: tsPath,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
      source timestamps = @id('local:pipeline/self')

      timestamps
        | cast [val] as datetime on_error: null
        | write @new('operator_try_strptime_tz_output')
    `
    );

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    const resultTable = completed.resultTable!;

    const rows = await queryRows(
      dbPath,
      `SELECT id, val AT TIME ZONE 'UTC' AS val FROM ${resultTable} ORDER BY id`
    );
    expect(rows.map((r) => String(r.id))).toEqual(['1', '2', '3']);
    expect(String(rows[0].val)).toContain('02:00:00');
    expect(String(rows[1].val)).toContain('02:00:00');
    expect(String(rows[2].val)).toContain('09:59:59');
  });

  it('converts to decimal with scale 0', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const decPath = path.join(tempRoot, 'decimal0.csv');
    fs.writeFileSync(decPath, ['id,val', '1,12.34', '2,56.78', '3,9.99'].join('\n') + '\n', 'utf8');

    const pipeline = await store.createPipeline({
      name: 'decimal scale 0',
      sourcePath: decPath,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
      source dec0 = @id('local:pipeline/self')

      dec0
        | cast [val] as decimal(18,0) on_error: null
        | write @new('operator_decimal_scale_0_output')
    `
    );

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    const resultTable = completed.resultTable!;

    const rows = await queryRows(dbPath, `SELECT id, val FROM ${resultTable} ORDER BY id`);
    expect(rows.map((r) => Number(r.val))).toEqual([12, 57, 10]);
  });

  it('converts to decimal with scale 18', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const decPath = path.join(tempRoot, 'decimal18.csv');
    fs.writeFileSync(
      decPath,
      ['id,val', '1,3.141592653589793238', '2,2.718281828459045235', '3,invalid'].join('\n') + '\n',
      'utf8'
    );

    const pipeline = await store.createPipeline({
      name: 'decimal scale 18',
      sourcePath: decPath,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
      source dec18 = @id('local:pipeline/self')

      dec18
        | cast [val] as decimal(19,18) on_error: null
        | write @new('operator_decimal_scale_18_output')
    `
    );

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    const resultTable = completed.resultTable!;

    const rows = await queryRows(
      dbPath,
      `SELECT id, val::VARCHAR AS val_str FROM ${resultTable} ORDER BY id`
    );
    expect(rows[0].val_str).toBe('3.141592653589793238');
    expect(rows[1].val_str).toBe('2.718281828459045235');
  });

  it('fails at execution time for scale 19 (exceeds DECIMAL(18,19))', async () => {
    const { store, tempRoot } = createStore();
    const decPath = path.join(tempRoot, 'decimal19.csv');
    fs.writeFileSync(decPath, ['id,val', '1,1.23'].join('\n') + '\n', 'utf8');

    const pipeline = await store.createPipeline({
      name: 'decimal scale 19',
      sourcePath: decPath,
    });
    const dsl = (type: string) => `
      source dec19 = @id('local:pipeline/self')
      dec19
        | cast [val] as ${type} on_error: null
        | write @new('operator_decimal_scale_19_output')
    `;
    // jflow rejects the scale up front …
    const rejected = compileTestJflow(parseTestJflow(dsl('decimal(18,19)')).ast!);
    expect(rejected.diagnostics.map((d) => d.code)).toContain('E_TYPE_DECIMAL');
    // … and save-time plan validation rejects a node config carrying it before any run
    const compiled = compileTestJflow(parseTestJflow(dsl('decimal(18,2)')).ast!);
    const nodes = JSON.parse(JSON.stringify(compiled.nodes).replace('"scale":2', '"scale":19'));
    await expect(
      store.savePipelineWorkflow(pipeline.id, {
        nodes,
        edges: compiled.edges,
      })
    ).rejects.toThrow(/scale|Too big/i);
  });

  it('converts with on_error keep', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const keepPath = path.join(tempRoot, 'keep.csv');
    fs.writeFileSync(keepPath, ['id,val', '1,123', '2,abc', '3,456'].join('\n') + '\n', 'utf8');

    const pipeline = await store.createPipeline({
      name: 'on_error keep',
      sourcePath: keepPath,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
      source keep = @id('local:pipeline/self')

      keep
        | cast [val] as integer on_error: keep
        | write @new('operator_keep_output')
    `
    );

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    const resultTable = completed.resultTable!;

    const rows = await queryRows(dbPath, `SELECT id, val FROM ${resultTable} ORDER BY id`);
    expect(rows.map((r) => String(r.id))).toEqual(['1', '2', '3']);
    expect(String(rows[0].val)).toBe('123');
    expect(String(rows[1].val)).toBe('abc');
    expect(String(rows[2].val)).toBe('456');
  });

  it('does not mutate runtime unnest config with compile-time JSON metadata', async () => {
    const { store, tempRoot } = createStore();
    const jsonPath = path.join(tempRoot, 'unnest-json.csv');
    fs.writeFileSync(
      jsonPath,
      ['id,payload', '1,{"name": "alpha"}', '2,{"name": "beta"}'].join('\n') + '\n',
      'utf8'
    );

    const pipeline = await store.createPipeline({
      name: 'unnest json no config leak',
      sourcePath: jsonPath,
    });
    const parsed = parseTestJflow(`
      source json_src = @id('local:pipeline/self')

      json_src
        | unnest json [payload]
        | write @new('operator_unnest_json_output')
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    expect(parsed.ast).not.toBeNull();
    const workflow = compileTestJflow(parsed.ast!);
    expect(workflow.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const unnestNode = workflow.nodes.find((node) => node.type === 'unnest');
    expect(unnestNode).toBeDefined();

    const completed = await store.runPipeline(pipeline.id, {
      workflow: { nodes: workflow.nodes, edges: workflow.edges },
    });
    expect(completed.status).toBe('completed');
    expect(unnestNode!.config).not.toHaveProperty('_jsonType');
    expect(unnestNode!.config).not.toHaveProperty('_jsonKeys');
  });

  it('fails explicitly when the JSON unnest column does not exist instead of silently passing through', async () => {
    const { store, tempRoot } = createStore();
    const jsonPath = path.join(tempRoot, 'unnest-json-missing.csv');
    fs.writeFileSync(jsonPath, ['id,payload', '1,{"name":"alpha"}'].join('\n') + '\n', 'utf8');

    const pipeline = await store.createPipeline({
      name: 'unnest json missing column',
      sourcePath: jsonPath,
    });
    await expect(
      saveWorkflowDsl(
        store,
        pipeline.id,
        `
      source json_src = @id('local:pipeline/self')

      json_src
        | unnest json [ghost_column]
        | write @new('operator_unnest_json_missing_output')
    `
      )
    ).rejects.toThrow(/ghost_column|not in the upstream columns/i);
  });

  it('appends rows on re-run when the output mode is append', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const sourcePath = path.join(tempRoot, 'append-source.csv');
    fs.writeFileSync(sourcePath, ['id,name', '1,a', '2,b'].join('\n') + '\n', 'utf8');

    const pipeline = await store.createPipeline({
      name: 'append output mode',
      sourcePath,
    });
    await saveWorkflowDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self')

      src
        | write @new('operator_append_output') mode: append
    `
    );

    await expect(store.runPipeline(pipeline.id)).resolves.toMatchObject({ status: 'completed' });
    await expect(store.runPipeline(pipeline.id)).resolves.toMatchObject({ status: 'completed' });

    const rows = await queryRows(dbPath, 'SELECT id FROM operator_append_output ORDER BY id');
    expect(rows.map((row) => String(row.id))).toEqual(['1', '1', '2', '2']);
  });

  it('fails on re-run when the output mode is error_if_exists', async () => {
    const { store, tempRoot } = createStore();
    const sourcePath = path.join(tempRoot, 'exists-source.csv');
    fs.writeFileSync(sourcePath, ['id', '1'].join('\n') + '\n', 'utf8');

    const pipeline = await store.createPipeline({
      name: 'error_if_exists output mode',
      sourcePath,
    });
    // error_if_exists is a physical-table write mode with no jflow spelling; set it on the node.
    const graph = jflowTestWorkflow(
      "source src = @id('local:pipeline/self')\nsrc | write @new('operator_exists_output')\n"
    );
    await store.savePipelineWorkflow(pipeline.id, {
      nodes: graph.nodes.map((node) =>
        node.type === 'output'
          ? { ...node, config: { ...node.config, mode: 'error_if_exists' } }
          : node
      ),
      edges: graph.edges,
    });

    await expect(store.runPipeline(pipeline.id)).resolves.toMatchObject({ status: 'completed' });
    await expect(store.runPipeline(pipeline.id)).rejects.toThrow(/already exists|error_if_exists/i);
  });
});

function createStore(): { dbPath: string; store: DataPipelineStore; tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-operator-dsl-'));
  tempRoots.push(tempRoot);
  const dbPath = path.join(tempRoot, 'workspace.duckdb');
  const store = createDataPipelineStore(dbPath, {
    now: () => 1_780_000_000_000,
  });
  stores.push(store);
  return { dbPath, store, tempRoot };
}

async function saveWorkflowDsl(
  store: DataPipelineStore,
  pipelineId: string,
  dsl: string
): Promise<void> {
  const parsed = parseTestJflow(dsl);
  expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
  expect(parsed.ast).not.toBeNull();

  const compiled = compileTestJflow(parsed.ast!);
  expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
  await store.savePipelineWorkflow(pipelineId, {
    nodes: compiled.nodes,
    edges: compiled.edges,
  });
}

async function queryRows(dbPath: string, sql: string): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

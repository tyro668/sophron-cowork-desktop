import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';
import { compilePrepWorkflowToFlow, parsePrepDsl } from '../src/shared/prep-dsl';

const tempRoots: string[] = [];
const stores: DataTaskStore[] = [];

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

    const task = await store.createTask({
      name: 'Executable cleaning operators',
      sourcePath: ordersPath,
    });
    await saveWorkflowDsl(
      store,
      task.id,
      `
        input source task as orders
          | select [order_id], [dt], [region], [rev], [profit], [status], [updated_at]
          | map [dt] to [order_date], [rev] to [revenue]
          | cast [order_date] as date format "%Y-%m-%d" on_error null, [revenue] as float on_error null, [profit] as float on_error null
          | missing value [region] nullify values ("", "N/A"), [region] fill "UNKNOWN"
          | deduplicate by [order_id] keep last order by [updated_at] desc
          | derive [margin] = [profit] / nullif([revenue], 0)
          | filter [status] = "PAID" and [revenue] > 0
          | aggregate by [region] metrics sum([revenue]) as [total_revenue], count(*) as [row_count]
          | sort by [total_revenue] desc
          | output table "operator_cleaning_output" mode replace
      `
    );

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.outputTable).toBe('operator_cleaning_output');
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

    const task = await store.createTask({
      name: 'Executable window derive',
      sourcePath: ordersPath,
    });
    await saveWorkflowDsl(
      store,
      task.id,
      `
        input source task as orders
          | cast [revenue] as float on_error null
          | derive [rn] = row_number() over(partition by [region] order by [revenue] desc)
          | filter [rn] <= 2
          | sort by [region] asc, [rn] asc
          | output table "operator_window_derive_output" mode replace
      `
    );

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.outputTable).toBe('operator_window_derive_output');
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

    const task = await store.createTask({
      name: 'Executable same-field derive',
      sourcePath: pricesPath,
    });
    await saveWorkflowDsl(
      store,
      task.id,
      `
        input source task as prices
          | derive [\`Adj Close\`] = CAST(REPLACE([\`Adj Close\`], '$', '') AS DECIMAL(18,2))
          | output table "operator_same_field_derive_output" mode replace
      `
    );

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.outputTable).toBe('operator_same_field_derive_output');

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

    const task = await store.createTask({
      name: 'Executable profit filter sort',
      sourcePath: profitPath,
    });
    await saveWorkflowDsl(
      store,
      task.id,
      `
        input source task as profit
          | filter [Profit] >= 0
          | sort by [Profit] asc
          | output table "operator_profit_filter_sort_output" mode replace
      `
    );

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.outputTable).toBe('operator_profit_filter_sort_output');

    const rows = await queryRows(
      dbPath,
      'SELECT "Row ID", Profit, Sales FROM operator_profit_filter_sort_output ORDER BY Profit ASC'
    );
    expect(rows.map((row) => Number(row.Profit))).toEqual([0, 3.12, 29.64, 106.14]);
  });

  it('preserves decimal values when filtering and sorting a dataset input source', async () => {
    const { dbPath, store, tempRoot } = createStore();
    const profitPath = path.join(tempRoot, 'profit-dataset.csv');
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
    const input = await store.importDataset({
      name: 'profit dataset',
      sourceKind: 'csv',
      filePath: profitPath,
    });

    const task = await store.createTask({
      name: 'Executable profit dataset filter sort',
      sourceInputTableId: input.id,
    });
    await saveWorkflowDsl(
      store,
      task.id,
      `
        input source dataset "${input.id}" as src
          | filter [Profit] >= 0
          | sort by [Profit] asc
          | output table "operator_profit_dataset_filter_sort_output" mode replace
      `
    );

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.outputTable).toBe('operator_profit_dataset_filter_sort_output');

    const rows = await queryRows(
      dbPath,
      'SELECT "Row ID", Profit, Sales FROM operator_profit_dataset_filter_sort_output ORDER BY Profit ASC'
    );
    expect(rows.map((row) => Number(row.Profit))).toEqual([0, 3.12, 29.64, 106.14]);
  });
});

function createStore(): { dbPath: string; store: DataTaskStore; tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-operator-dsl-'));
  tempRoots.push(tempRoot);
  const dbPath = path.join(tempRoot, 'workspace.duckdb');
  const store = createDataTaskStore(dbPath, {
    now: () => 1_780_000_000_000,
  });
  stores.push(store);
  return { dbPath, store, tempRoot };
}

async function saveWorkflowDsl(store: DataTaskStore, taskId: string, dsl: string): Promise<void> {
  const parsed = parsePrepDsl(dsl);
  expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
  expect(parsed.ast).not.toBeNull();

  const compiled = compilePrepWorkflowToFlow(parsed.ast!);
  expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
  await store.saveTaskWorkflow(taskId, {
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

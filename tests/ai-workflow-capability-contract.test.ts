import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';
import { validateGeneratedExecutableWorkflow } from '../src/main/data/workflow/generated-workflow-graph-validator';
import {
  compileWorkflowJavaScript,
  executeWorkflowJavaScriptInSandbox,
} from '../src/main/data/workflow/javascript-runtime';
import { AI_PREP_DSL_OPERATION_CAPABILITIES } from '../src/main/data/workflow/prep-dsl-capability-profile';
import { lowerGeneratedWorkflowIrSemantics } from '../src/main/data/workflow/workflow-ir-lowerer';
import { compileLoweredWorkflowToPlatformNodes } from '../src/main/data/workflow/workflow-node-compiler';

const CORE_OPERATION_TYPES = [
  'select',
  'rename',
  'convert_type',
  'missing_value',
  'deduplicate',
  'derive',
  'filter',
  'sort',
  'drop',
  'limit',
] as const;
const AGGREGATE_OPERATION_TYPES = ['aggregate'] as const;
const PIVOT_OPERATION_TYPES = ['pivot'] as const;
const UNPIVOT_OPERATION_TYPES = ['unpivot'] as const;
const UNNEST_OPERATION_TYPES = ['unnest'] as const;
const CERTIFIED_OPERATION_GROUPS = [
  CORE_OPERATION_TYPES,
  AGGREGATE_OPERATION_TYPES,
  PIVOT_OPERATION_TYPES,
  UNPIVOT_OPERATION_TYPES,
  UNNEST_OPERATION_TYPES,
] as const;

const tempRoots: string[] = [];
const stores: DataTaskStore[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('AI workflow capability contract', () => {
  it('keeps executable certification coverage synchronized with every AI-enabled operation', () => {
    const enabled = Object.values(AI_PREP_DSL_OPERATION_CAPABILITIES)
      .filter((capability) => capability.aiEnabled)
      .map((capability) => capability.irType)
      .sort();
    const certified = [...new Set(CERTIFIED_OPERATION_GROUPS.flat())].sort();

    expect(certified).toEqual(enabled);
  });

  it('executes the certified core cleaning operations through native platform nodes', async () => {
    const result = await runCertifiedWorkflow({
      name: 'core-cleaning',
      csv: [
        'order_id,region,rev,profit,status,updated_at,obsolete',
        '1,East,$100,20,PAID,2026-01-01,x',
        '1,East,$120,36,PAID,2026-01-02,x',
        '2,,$80,24,PAID,2026-01-01,y',
        '3,West,$90,45,REFUND,2026-01-03,z',
        '4,North,$50,5,PAID,2026-01-04,q',
      ].join('\n'),
      columns: [
        { name: 'order_id', type: 'integer' },
        { name: 'region', type: 'text' },
        { name: 'rev', type: 'text' },
        { name: 'profit', type: 'integer' },
        { name: 'status', type: 'text' },
        { name: 'updated_at', type: 'date' },
        { name: 'obsolete', type: 'text' },
      ],
      expectedOperationTypes: CORE_OPERATION_TYPES,
      javascriptSource: workflowSource([
        {
          name: 'selectColumns',
          type: 'select',
          payload:
            '{ columns: ["order_id", "region", "rev", "profit", "status", "updated_at", "obsolete"] }',
        },
        {
          name: 'renameRevenue',
          type: 'rename',
          payload: '{ source: "rev", target: "revenue" }',
        },
        {
          name: 'convertRevenue',
          type: 'convert_type',
          payload:
            '{ column: "revenue", targetType: "decimal", options: { removePrefix: "$", scale: 2 } }',
        },
        {
          name: 'fillRegion',
          type: 'missing_value',
          payload:
            '{ config: { strategy: "by_column", rules: [{ column: "region", method: "literal_fill", value: "UNKNOWN" }] } }',
        },
        {
          name: 'deduplicateOrders',
          type: 'deduplicate',
          payload:
            '{ config: { columns: ["order_id"], keep: "first", orderBy: [{ field: "updated_at", direction: "desc" }] } }',
        },
        {
          name: 'deriveMargin',
          type: 'derive',
          payload: '{ column: "margin", expression: expr(row => row["profit"] / row["revenue"]) }',
        },
        {
          name: 'filterProfitablePaidOrders',
          type: 'filter',
          payload: '{ condition: expr(row => row["status"] === "PAID" && row["margin"] >= 0.2) }',
        },
        {
          name: 'sortRevenue',
          type: 'sort',
          payload: '{ column: expr(row => row["revenue"]), direction: "desc" }',
        },
        {
          name: 'dropInternalColumns',
          type: 'drop',
          payload: '{ columns: ["status", "updated_at", "obsolete"] }',
        },
        {
          name: 'limitRows',
          type: 'limit',
          payload: '{ config: { mode: "limit", limit: 2, unit: "rows", offset: 0, orderBy: [] } }',
        },
      ]),
    });

    expect(result.plan.nodes.map((node) => node.type)).toEqual([
      'input_source',
      'field_select',
      'field_mapping',
      'calculate_field',
      'field_select',
      'field_mapping',
      'missing_value',
      'deduplicate',
      'calculate_field',
      'filter',
      'sort',
      'field_select',
      'limit',
      'output',
    ]);
    const rows = await queryRows(
      result.dbPath,
      `SELECT order_id, region, revenue, profit, margin FROM ${result.outputTable} ORDER BY revenue DESC`
    );
    expect(
      rows.map((row) => ({
        order_id: Number(row.order_id),
        region: String(row.region),
        revenue: Number(row.revenue),
        profit: Number(row.profit),
        margin: Number(row.margin),
      }))
    ).toEqual([
      { order_id: 1, region: 'East', revenue: 120, profit: 36, margin: 0.3 },
      { order_id: 2, region: 'UNKNOWN', revenue: 80, profit: 24, margin: 0.3 },
    ]);
  });

  it('executes aggregate through native platform nodes', async () => {
    const result = await runCertifiedWorkflow({
      name: 'aggregate',
      csv: ['region,amount', 'East,10', 'East,20', 'West,5'].join('\n'),
      columns: [
        { name: 'region', type: 'text' },
        { name: 'amount', type: 'integer' },
      ],
      expectedOperationTypes: AGGREGATE_OPERATION_TYPES,
      javascriptSource: workflowSource([
        {
          name: 'aggregateRevenue',
          type: 'aggregate',
          payload:
            '{ groupBy: [expr(row => row["region"])], metrics: [{ fn: "sum", expression: expr(row => row["amount"]), alias: "total_amount" }, { fn: "count", expression: "*", alias: "row_count" }] }',
        },
      ]),
    });

    expect(result.plan.nodes.map((node) => node.type)).toEqual([
      'input_source',
      'aggregate',
      'output',
    ]);
    const rows = await queryRows(
      result.dbPath,
      `SELECT region, total_amount, row_count FROM ${result.outputTable} ORDER BY region`
    );
    expect(
      rows.map((row) => ({
        region: String(row.region),
        total_amount: Number(row.total_amount),
        row_count: Number(row.row_count),
      }))
    ).toEqual([
      { region: 'East', total_amount: 30, row_count: 2 },
      { region: 'West', total_amount: 5, row_count: 1 },
    ]);
  });

  it('executes pivot through native platform nodes', async () => {
    const result = await runCertifiedWorkflow({
      name: 'pivot',
      csv: ['region,quarter,revenue', 'East,Q1,10', 'East,Q2,20', 'West,Q1,5', 'West,Q2,7'].join(
        '\n'
      ),
      columns: [
        { name: 'region', type: 'text' },
        { name: 'quarter', type: 'text' },
        { name: 'revenue', type: 'integer' },
      ],
      expectedOperationTypes: PIVOT_OPERATION_TYPES,
      javascriptSource: workflowSource([
        {
          name: 'pivotQuarter',
          type: 'pivot',
          payload:
            '{ config: { on: ["quarter"], values: ["Q1", "Q2"], using: [{ function: "sum", expression: expr(row => row["revenue"]), alias: "sales" }], groupBy: ["region"] } }',
        },
      ]),
    });

    expect(result.plan.nodes.map((node) => node.type)).toEqual(['input_source', 'pivot', 'output']);
    const rows = await queryRows(
      result.dbPath,
      `SELECT * FROM ${result.outputTable} ORDER BY region`
    );
    expect(
      rows.map((row) => ({
        region: String(row.region),
        Q1_sales: Number(row.Q1_sales),
        Q2_sales: Number(row.Q2_sales),
      }))
    ).toEqual([
      { region: 'East', Q1_sales: 10, Q2_sales: 20 },
      { region: 'West', Q1_sales: 5, Q2_sales: 7 },
    ]);
  });

  it('executes unpivot through native platform nodes', async () => {
    const result = await runCertifiedWorkflow({
      name: 'unpivot',
      csv: ['region,Q1,Q2', 'East,10,20', 'West,5,7'].join('\n'),
      columns: [
        { name: 'region', type: 'text' },
        { name: 'Q1', type: 'integer' },
        { name: 'Q2', type: 'integer' },
      ],
      expectedOperationTypes: UNPIVOT_OPERATION_TYPES,
      javascriptSource: workflowSource([
        {
          name: 'unpivotQuarter',
          type: 'unpivot',
          payload:
            '{ config: { mode: "columns", columns: ["Q1", "Q2"], nameColumn: "quarter", valueColumn: "revenue", includeNulls: false } }',
        },
      ]),
    });

    expect(result.plan.nodes.map((node) => node.type)).toEqual([
      'input_source',
      'unpivot',
      'output',
    ]);
    const rows = await queryRows(
      result.dbPath,
      `SELECT region, quarter, revenue FROM ${result.outputTable} ORDER BY region, quarter`
    );
    expect(
      rows.map((row) => ({
        region: String(row.region),
        quarter: String(row.quarter),
        revenue: Number(row.revenue),
      }))
    ).toEqual([
      { region: 'East', quarter: 'Q1', revenue: 10 },
      { region: 'East', quarter: 'Q2', revenue: 20 },
      { region: 'West', quarter: 'Q1', revenue: 5 },
      { region: 'West', quarter: 'Q2', revenue: 7 },
    ]);
  });

  it('executes JSON unnest through native platform nodes', async () => {
    const result = await runCertifiedWorkflow({
      name: 'unnest',
      csv: ['id,items', '1,"[10,20]"', '2,"[30]"'].join('\n'),
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'items', type: 'text' },
      ],
      expectedOperationTypes: UNNEST_OPERATION_TYPES,
      javascriptSource: workflowSource([
        {
          name: 'unnestItems',
          type: 'unnest',
          payload:
            '{ config: { sourceKind: "json", column: "items", alias: "item", path: "$", recursive: false, keepParentNames: false } }',
        },
      ]),
    });

    expect(result.plan.nodes.map((node) => node.type)).toEqual([
      'input_source',
      'unnest',
      'output',
    ]);
    const rows = await queryRows(
      result.dbPath,
      `SELECT id, CAST(item AS INTEGER) AS item FROM ${result.outputTable} ORDER BY id, item`
    );
    expect(
      rows.map((row) => ({
        id: Number(row.id),
        item: Number(row.item),
      }))
    ).toEqual([
      { id: 1, item: 10 },
      { id: 1, item: 20 },
      { id: 2, item: 30 },
    ]);
  });
});

interface WorkflowStepSource {
  name: string;
  type: string;
  payload: string;
}

function workflowSource(steps: WorkflowStepSource[]): string {
  const helpers = steps.map(
    (step) =>
      `function ${step.name}(input) {\n  return workflow.step(input, ${JSON.stringify(step.type)}, ${step.payload});\n}`
  );
  const main = [
    'function main() {',
    '  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });',
    ...steps.map(
      (step, index) =>
        `  const value${index + 1} = ${step.name}(${index === 0 ? 'input' : `value${index}`});`
    ),
    `  return workflow.output(value${steps.length}, OUTPUT_TABLE_NAME, { mode: "replace" });`,
    '}',
  ].join('\n');
  return [...helpers, main].join('\n\n');
}

async function runCertifiedWorkflow(input: {
  name: string;
  csv: string;
  columns: Array<{ name: string; type?: string }>;
  javascriptSource: string;
  expectedOperationTypes: readonly string[];
}): Promise<{
  dbPath: string;
  outputTable: string;
  plan: ReturnType<typeof compileLoweredWorkflowToPlatformNodes>;
}> {
  const { dbPath, store, tempRoot } = createStore(input.name);
  const csvPath = path.join(tempRoot, `${input.name}.csv`);
  fs.writeFileSync(csvPath, `${input.csv}\n`, 'utf8');
  const dataset = await store.importDataset({
    name: `${input.name} input`,
    sourceKind: 'csv',
    filePath: csvPath,
  });
  const task = await store.createTask({
    name: `${input.name} task`,
    sourceDatasetId: dataset.id,
  });
  const outputTable = `ai_contract_${input.name.replace(/[^A-Za-z0-9_]/g, '_')}_output`;

  const compiled = compileWorkflowJavaScript(input.javascriptSource, { columns: input.columns });
  const ir = executeWorkflowJavaScriptInSandbox({
    compiled,
    inputTableId: dataset.id,
    outputTableName: outputTable,
  });
  expect(ir.operations.map((operation) => operation.type)).toEqual(input.expectedOperationTypes);

  const semantics = lowerGeneratedWorkflowIrSemantics({
    ir,
    requirement: `certify ${input.name}`,
    columns: input.columns,
  });
  const plan = compileLoweredWorkflowToPlatformNodes({
    semantics,
    bindings: {
      inputTableId: dataset.id,
      inputTableName: dataset.name,
      outputTableName: outputTable,
    },
  });
  for (const node of plan.nodes.slice(1, -1)) {
    expect(node.config).not.toHaveProperty('dsl');
  }
  expect(validateGeneratedExecutableWorkflow({ nodes: plan.nodes, edges: plan.edges })).toEqual([]);

  await store.saveTaskWorkflow(task.id, { nodes: plan.nodes, edges: plan.edges });
  const saved = await store.getTaskWorkflow(task.id);
  expect(saved.nodes.map((node) => node.type)).toEqual(plan.nodes.map((node) => node.type));
  const completed = await store.runTask(task.id);
  expect(completed.status).toBe('completed');
  expect(completed.outputTable).toBe(outputTable);

  return { dbPath, outputTable, plan };
}

function createStore(name: string): { dbPath: string; store: DataTaskStore; tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `sophron-ai-capability-${name}-`));
  tempRoots.push(tempRoot);
  const dbPath = path.join(tempRoot, 'workspace.duckdb');
  const store = createDataTaskStore(dbPath, { now: () => 1_780_000_000_000 });
  stores.push(store);
  return { dbPath, store, tempRoot };
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

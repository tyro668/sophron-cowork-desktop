import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import * as XLSX from 'xlsx';
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

describe('DuckDB data task store', () => {
  it('resolves dynamic pivot empty-string names without merging conflicting values', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const sourcePath = path.join(tempRoot, 'pivot-empty.csv');
    fs.writeFileSync(sourcePath, 'id,amount\n1,10\n2,20\n3,30\n4,40\n', 'utf8');

    const store = createDataTaskStore(dbPath, { now: () => 1_780_000_000_000 });
    stores.push(store);
    const task = await store.createTask({ name: 'Dynamic empty pivot', sourcePath });
    const parsed = parsePrepDsl(`
      input source task as source

      from source
        | derive [status] = case when [id] = 1 then "" when [id] = 2 then "empty" when [id] = 3 then "empty_0" else "paid" end
        | derive [segment] = case when [id] = 1 or [id] = 3 then "east" else "west" end
        | select [status], [segment], [amount]
        | pivot on [status], [segment] using sum([amount])
        | output table "pivot_empty_output" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const saved = await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    const pivotNode = saved.nodes.find((node) => node.type === 'pivot');
    expect(pivotNode).toBeTruthy();
    const preview = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: pivotNode!.id,
      nodeType: pivotNode!.type,
      nodeConfig: pivotNode!.config,
    });
    expect(preview.columns).toHaveLength(8);
    expect(preview.columns).toEqual(
      expect.arrayContaining([
        'empty_1_east_sum_amount',
        'empty_west_sum_amount',
        'empty_0_east_sum_amount',
        'paid_west_sum_amount',
      ])
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({
      empty_1_east_sum_amount: '10',
      empty_west_sum_amount: '20',
      empty_0_east_sum_amount: '30',
      paid_west_sum_amount: '40',
    });
  });

  it('executes a dynamic pivot when the resolved input has no rows', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const sourcePath = path.join(tempRoot, 'empty-pivot.csv');
    fs.writeFileSync(sourcePath, 'region,status,amount\n', 'utf8');

    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);
    const task = await store.createTask({ name: 'Empty dynamic pivot', sourcePath });
    const parsed = parsePrepDsl(`
      input source task as source

      from source
        | pivot on [status] using sum([amount]) group by [region]
        | output table "empty_pivot_output" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const saved = await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    const pivotNode = saved.nodes.find((node) => node.type === 'pivot');
    expect(pivotNode).toBeTruthy();
    const preview = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: pivotNode!.id,
      nodeType: pivotNode!.type,
      nodeConfig: pivotNode!.config,
    });
    expect(preview.columns).toEqual(['region']);
    expect(preview.rows).toEqual([]);
  });

  it('starts without demo tasks or demo datasets', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'));
    stores.push(store);

    const dashboard = await store.getDashboard();
    expect(dashboard.summary.taskCount).toBe(0);
    expect(dashboard.summary.workflowNodeCount).toBe(0);
    expect(dashboard.tasks).toHaveLength(0);
    expect(dashboard.datasets).toHaveLength(0);
  });

  it('paginates dashboard tasks while keeping real total counts', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    let now = 1_780_000_000_000;
    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => now,
    });
    stores.push(store);

    for (let index = 1; index <= 23; index += 1) {
      now += 1_000;
      await store.createTask({ name: `Paged task ${String(index).padStart(2, '0')}` });
    }

    const firstPage = await store.getDashboard({ taskOffset: 0, taskLimit: 10 });
    expect(firstPage.totalTasks).toBe(23);
    expect(firstPage.tasks).toHaveLength(10);
    expect(firstPage.tasks[0]?.name).toBe('Paged task 23');

    const thirdPage = await store.getDashboard({ taskOffset: 20, taskLimit: 10 });
    expect(thirdPage.totalTasks).toBe(23);
    expect(thirdPage.tasks.map((task) => task.name)).toEqual([
      'Paged task 03',
      'Paged task 02',
      'Paged task 01',
    ]);
  });

  it('updates data task names', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const task = await store.createTask({ name: 'Original task' });
    const updated = await store.updateTask({ id: task.id, name: 'Renamed task' });
    expect(updated.id).toBe(task.id);
    expect(updated.name).toBe('Renamed task');

    const dashboard = await store.getDashboard({ query: 'Renamed task' });
    expect(dashboard.tasks).toHaveLength(1);
    expect(dashboard.tasks[0]?.name).toBe('Renamed task');
  });

  it('imports datasets and runs a local data cleaning task', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const csvPath = path.join(tempRoot, 'events.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n1,Alice\n2,Bob\n,\n', 'utf8');

    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importDataset({ filePath: csvPath });
    expect(imported.name).toBe('events');
    expect(imported.columnCount).toBe(2);
    expect(imported.rowCount).toBeGreaterThan(0);

    const task = await store.createTask({ name: 'Clean events', sourcePath: csvPath });
    expect(task.status).toBe('pending');
    const workflow = await store.getTaskWorkflow(task.id);
    expect(workflow.nodes).toHaveLength(0);
    expect(workflow.edges).toHaveLength(0);

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.columnCount).toBe(2);
    expect(completed.rowCount).toBe(2);
    expect(completed.outputTable).toMatch(/^clean_task_/);

    const dashboard = await store.getDashboard({ query: 'events' });
    expect(dashboard.summary.taskCount).toBe(1);
    expect(dashboard.summary.workflowNodeCount).toBe(0);
    expect(dashboard.summary.statusCounts.completed).toBe(1);
    expect(dashboard.summary.statusCounts.failed).toBe(0);
    expect(dashboard.tasks).toHaveLength(1);
    expect(dashboard.datasets).toHaveLength(1);

    const outputDashboard = await store.getDashboard({
      includeTasks: false,
      includeDatasets: false,
      includeOutputTables: true,
    });
    expect(outputDashboard.outputTables).toHaveLength(0);

    expect(await store.deleteTask(completed.id)).toBe(true);
    const afterDelete = await store.getDashboard({ query: 'Clean events' });
    expect(afterDelete.summary.taskCount).toBe(0);
    expect(afterDelete.summary.statusCounts.completed).toBe(0);
    expect(afterDelete.tasks).toHaveLength(0);
  });

  it('serializes concurrent task runs on the shared DuckDB connection', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const csvPath = path.join(tempRoot, 'queued.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');
    const firstTask = await store.createTask({ name: 'First queued task', sourcePath: csvPath });
    const secondTask = await store.createTask({ name: 'Second queued task', sourcePath: csvPath });
    const internals = store as unknown as {
      ctx: { runSql: (sql: string) => Promise<void> };
      taskService: {
        executor: {
          cleanSourceIntoTaskOutput: (
            task: { id: string },
            sourcePath: string | null,
            workflow: unknown,
            outputMode: unknown
          ) => Promise<{
            outputTable: string;
            rowCount: number;
            columnCount: number;
            sourceDatasetId: string | null;
          }>;
        };
      };
    };
    const executor = internals.taskService.executor;
    const originalCleanSourceIntoTaskOutput = executor.cleanSourceIntoTaskOutput.bind(executor);
    let activeRuns = 0;
    let maxActiveRuns = 0;
    let callCount = 0;
    let releaseFirstRun!: () => void;
    executor.cleanSourceIntoTaskOutput = async (task) => {
      callCount += 1;
      activeRuns += 1;
      maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
      if (callCount === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstRun = resolve;
        });
      }
      activeRuns -= 1;
      const outputTable = `serialized_output_${task.id.replace(/[^A-Za-z0-9]/g, '_')}`;
      await internals.ctx.runSql(`CREATE TABLE "${outputTable}" AS SELECT 1 AS value`);
      return {
        outputTable,
        rowCount: 1,
        columnCount: 1,
        sourceDatasetId: null,
      };
    };

    try {
      const firstRun = store.runTask(firstTask.id);
      await waitFor(() => callCount === 1);
      const secondRun = store.runTask(secondTask.id);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(callCount).toBe(1);

      releaseFirstRun();
      await firstRun;
      await secondRun;

      expect(callCount).toBe(2);
      expect(maxActiveRuns).toBe(1);
    } finally {
      executor.cleanSourceIntoTaskOutput = originalCleanSourceIntoTaskOutput;
    }
  });

  it('imports an Excel workbook as an input table', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const workbookPath = path.join(tempRoot, 'orders.xlsx');
    writeWorkbook(workbookPath, [
      ['id', 'amount'],
      [1, 10],
      [2, 20],
    ]);

    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importDataset({ filePath: workbookPath });
    expect(imported.name).toBe('orders');
    expect(imported.columnCount).toBe(2);
    expect(imported.rowCount).toBe(2);
    expect(await store.deleteDataset(imported.id)).toBe(true);
    const dashboard = await store.getDashboard({ query: 'orders' });
    expect(dashboard.datasets).toHaveLength(0);
  });

  it('persists Excel sheet and header-row input table configuration', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const workbookPath = path.join(tempRoot, 'configured-orders.xlsx');
    writeWorkbookSheets(workbookPath, {
      Raw: [['skip'], [1]],
      Orders: [['report title'], ['id', 'amount'], [1, 10], [2, 20]],
    });

    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importDataset({
      filePath: workbookPath,
      sourceKind: 'excel',
      config: {
        sourceKind: 'excel',
        sheetName: 'Orders',
        sheetNames: [],
        headerMode: 'manual',
        headerRow: 2,
      },
    });
    expect(imported.sourceKind).toBe('excel');
    expect(imported.inputConfig.sourceKind).toBe('excel');
    if (imported.inputConfig.sourceKind !== 'excel') {
      throw new Error('Expected imported input configuration to be Excel');
    }
    expect(imported.inputConfig.sheetName).toBe('Orders');
    expect(imported.inputConfig.headerMode).toBe('manual');
    expect(imported.inputConfig.headerRow).toBe(2);
    expect(imported.inputConfig.sheetNames).toEqual(['Raw', 'Orders']);
    expect(imported.rowCount).toBe(2);
    expect(imported.columnCount).toBe(2);
  });

  it('stores and exposes semantic column types for input, output, and task tables', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const workbookPath = path.join(tempRoot, 'typed-orders.xlsx');
    writeWorkbook(workbookPath, [
      [
        'text_col',
        'date_col',
        'datetime_col',
        'integer_col',
        'float_col',
        'decimal_col',
        'boolean_col',
      ],
      ['A001', '2026-06-10', '2026-06-10 12:30:45', '3,302', '1.23e4', '12.34', 'true'],
      ['A002', '2026-06-11', '2026-06-11 08:15:00', '-1,832', '5.67e2', '56.78', 'false'],
      ['A003', '2026-06-12', '2026-06-12 09:00:00', '-3，431', '9,876.5', '1,234.56', 'true'],
    ]);

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importDataset({ filePath: workbookPath });
    const inputPreview = await store.previewDataset({ id: imported.id });
    expect(inputPreview.columnTypes.map((column) => column.type)).toEqual([
      'text',
      'date',
      'datetime',
      'integer',
      'float',
      'decimal',
      'boolean',
    ]);
    expect(inputPreview.rows.map((row) => String(row.integer_col))).toEqual([
      '3302',
      '-1832',
      '-3431',
    ]);
    expect(Number(inputPreview.rows[2]?.float_col)).toBeCloseTo(9876.5);
    expect(Number(inputPreview.rows[2]?.decimal_col)).toBeCloseTo(1234.56);

    const outputTable = await store.createOutputTable({ name: 'Typed output' });
    await store.updateOutputTable({ id: outputTable.id, sourceDatasetId: imported.id });
    const outputPreview = await store.previewDataset({ id: outputTable.id });
    expect(outputPreview.columnTypes.map((column) => column.type)).toEqual(
      inputPreview.columnTypes.map((column) => column.type)
    );

    const task = await store.createTask({ name: 'Typed task' });
    const parsed = parsePrepDsl(`
      input source dataset "${imported.id}" as typed

      from typed
        | cast [text_col] as text,
               [date_col] as date format "%Y-%m-%d",
               [datetime_col] as datetime format "%Y-%m-%d %H:%M:%S",
               [integer_col] as integer,
               [float_col] as float,
               [decimal_col] as decimal,
               [boolean_col] as boolean
        | output table "typed_task_output" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const saved = await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });
    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    const outputNode = saved.nodes.find((node) => node.type === 'output');
    expect(outputNode).toBeTruthy();
    const taskColumnTypes = await store.getWorkflowNodeColumnTypes({
      taskId: task.id,
      nodeId: outputNode!.id,
      nodeType: outputNode!.type,
      nodeConfig: outputNode!.config,
    });
    expect(taskColumnTypes.map((column) => column.type)).toEqual([
      'text',
      'date',
      'datetime',
      'integer',
      'float',
      'decimal',
      'boolean',
    ]);
  });

  it('lists Excel input tables without reading the source workbook', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const workbookPath = path.join(tempRoot, 'large-orders.xlsx');
    writeWorkbookSheets(workbookPath, {
      Orders: [
        ['id', 'amount'],
        [1, 10],
      ],
    });

    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'));
    stores.push(store);

    const imported = await store.importDataset({ filePath: workbookPath, sourceKind: 'excel' });
    fs.unlinkSync(workbookPath);
    fs.mkdirSync(workbookPath);

    const dashboard = await store.getDashboard({
      includeTasks: false,
      includeDatasets: true,
      datasetLimit: 10,
    });
    expect(dashboard.datasets).toHaveLength(1);
    expect(dashboard.datasets[0]?.id).toBe(imported.id);
    expect(dashboard.datasets[0]?.inputConfig.sourceKind).toBe('excel');
  });

  it('previews input table data using the current configuration', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const workbookPath = path.join(tempRoot, 'preview-orders.xlsx');
    writeWorkbookSheets(workbookPath, {
      Raw: [['ignored'], ['x']],
      Orders: [['report title'], ['id', 'amount'], [1, 10], [2, 20]],
    });

    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'));
    stores.push(store);

    const preview = await store.previewInputTable({
      filePath: workbookPath,
      sourceKind: 'excel',
      config: {
        sourceKind: 'excel',
        sheetName: 'Orders',
        sheetNames: [],
        headerMode: 'manual',
        headerRow: 2,
      },
      limit: 1,
      offset: 1,
    });

    expect(preview.columns).toEqual(['id', 'amount']);
    expect(preview.rows).toEqual([{ id: '2', amount: '20' }]);
    expect(preview.columnTypes.map((column) => column.type)).toEqual(['integer', 'integer']);
    expect(preview.fileCount).toBe(1);
    expect(preview.limit).toBe(1);
    expect(preview.offset).toBe(1);
    expect(preview.totalRows).toBe(2);
  });

  it('previews stored input table rows from DuckDB', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const csvPath = path.join(tempRoot, 'stored-customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob\n3,Carol\n', 'utf8');

    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'));
    stores.push(store);

    const imported = await store.importDataset({ filePath: csvPath, name: 'Customers' });
    const preview = await store.previewDataset({ id: imported.id, limit: 1, offset: 1 });

    expect(preview.columns).toEqual(['id', 'name']);
    expect(String(preview.rows[0]?.id)).toBe('2');
    expect(preview.rows[0]?.name).toBe('Bob');
    expect(preview.fileCount).toBe(1);
    expect(preview.limit).toBe(1);
    expect(preview.offset).toBe(1);
    expect(preview.totalRows).toBe(3);
  });

  it('creates and updates output table metadata separately from input tables', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const sourcePath = path.join(tempRoot, 'source.csv');
    fs.writeFileSync(sourcePath, 'id,value\n1,A\n2,B\n', 'utf8');
    const source = await store.importDataset({ filePath: sourcePath, name: 'Source input' });

    const created = await store.createOutputTable({ name: 'Draft output' });
    expect(created.name).toBe('Draft output');
    expect(created.sourceDatasetId).toBeNull();
    expect(created.tableName).toMatch(/^output_/);

    const renamed = await store.updateOutputTable({
      id: created.id,
      name: 'Final output',
      sourceDatasetId: source.id,
    });
    expect(renamed.name).toBe('Final output');
    expect(renamed.sourceDatasetId).toBe(source.id);
    expect(renamed.rowCount).toBe(2);
    expect(renamed.columnCount).toBe(2);

    const dashboard = await store.getDashboard({
      includeTasks: false,
      includeDatasets: true,
      includeOutputTables: true,
    });
    expect(dashboard.datasets).toHaveLength(1);
    expect(dashboard.outputTables).toHaveLength(1);
    expect(dashboard.outputTables[0]?.name).toBe('Final output');
    expect(dashboard.outputTables[0]?.sourceDatasetId).toBe(source.id);

    const preview = await store.previewDataset({ id: created.id });
    expect(preview.rows).toHaveLength(2);
    expect(preview.totalRows).toBe(2);
  });

  it('cleans legacy task output metadata from configured output tables', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');

    const initialStore = createDataTaskStore(dbPath);
    stores.push(initialStore);
    await initialStore.getDashboard();
    stores.pop()?.close();

    const instance = await DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    try {
      await connection.run(`
        INSERT INTO data_datasets (
          id, name, source_path, source_kind, config_json, file_count,
          table_name, row_count, column_count, created_at, updated_at
        )
        VALUES
          ('legacy-configured-output', 'Configured output', 'duckdb://outputs/output_legacy', 'output', '{}', 0, 'output_legacy', 0, 0, 1, 1),
          ('legacy-task-output', 'Task output dirty row', '/tmp/source.csv', 'output', '{}', 0, 'clean_task_legacy', 10, 2, 1, 1)
      `);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }

    const store = createDataTaskStore(dbPath);
    stores.push(store);
    const dashboard = await store.getDashboard({
      includeTasks: false,
      includeDatasets: true,
      includeOutputTables: true,
    });

    expect(dashboard.datasets).toHaveLength(0);
    expect(dashboard.outputTables).toHaveLength(1);
    expect(dashboard.outputTables[0]?.id).toBe('legacy-configured-output');

    stores.pop()?.close();
    const verifyInstance = await DuckDBInstance.create(dbPath);
    const verifyConnection = await verifyInstance.connect();
    try {
      const reader = await verifyConnection.runAndReadAll(
        'SELECT id, config_json FROM data_datasets ORDER BY id'
      );
      expect(reader.getRowObjectsJson()).toEqual([
        {
          id: 'legacy-configured-output',
          config_json: '{"kind":"output_table"}',
        },
      ]);
    } finally {
      verifyConnection.closeSync();
      verifyInstance.closeSync();
    }
  });

  it('imports a folder by merging Excel and CSV files into one input table', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const sourceFolder = path.join(tempRoot, 'monthly-inputs');
    fs.mkdirSync(sourceFolder);
    fs.writeFileSync(path.join(sourceFolder, 'customers.csv'), 'id,name\n1,Alice\n', 'utf8');
    writeWorkbook(path.join(sourceFolder, 'regions.xlsx'), [
      ['id', 'region'],
      [2, '华东'],
    ]);

    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importDataset({ filePath: sourceFolder });
    expect(imported.name).toBe('monthly-inputs');
    expect(imported.sourcePath).toBe(sourceFolder);
    expect(imported.sourceKind).toBe('folder');
    expect(imported.fileCount).toBe(2);
    expect(imported.inputConfig.sourceKind).toBe('folder');
    expect(imported.columnCount).toBe(4);
    expect(imported.rowCount).toBe(2);
  });

  it('loads dashboard task and input-table lists lazily', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const excelPath = path.join(tempRoot, 'orders.xlsx');
    const csvPath = path.join(tempRoot, 'customers.csv');
    writeWorkbook(excelPath, [
      ['id', 'amount'],
      [1, 10],
    ]);
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');

    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);
    await store.createTask({ name: 'Paged task 01' });
    await store.createTask({ name: 'Paged task 02' });
    await store.importDataset({ filePath: excelPath });
    const csvDataset = await store.importDataset({ filePath: csvPath });
    await store.createTask({ name: 'Uses customers', sourcePath: csvPath });

    const tasksOnly = await store.getDashboard({
      includeTasks: true,
      includeDatasets: false,
      taskOffset: 0,
      taskLimit: 1,
    });
    expect(tasksOnly.tasks).toHaveLength(1);
    expect(tasksOnly.datasets).toHaveLength(0);
    expect(tasksOnly.totalTasks).toBe(3);
    expect(tasksOnly.totalDatasets).toBe(0);

    const csvTablesOnly = await store.getDashboard({
      includeTasks: false,
      includeDatasets: true,
      datasetSourceKind: 'csv',
      datasetOffset: 0,
      datasetLimit: 1,
    });
    expect(csvTablesOnly.tasks).toHaveLength(0);
    expect(csvTablesOnly.datasets).toHaveLength(1);
    expect(csvTablesOnly.datasets[0]?.id).toBe(csvDataset.id);
    expect(csvTablesOnly.datasets[0]?.relatedTaskNames).toEqual(['Uses customers']);
    expect(csvTablesOnly.totalTasks).toBe(3);
    expect(csvTablesOnly.totalDatasets).toBe(1);
  });

  it('updates an existing input table in place', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const firstCsvPath = path.join(tempRoot, 'first.csv');
    const nextCsvPath = path.join(tempRoot, 'next.csv');
    fs.writeFileSync(firstCsvPath, 'id,name\n1,Alice\n', 'utf8');
    fs.writeFileSync(nextCsvPath, 'id,name,region\n1,Alice,East\n2,Bob,West\n', 'utf8');

    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importDataset({ filePath: firstCsvPath, name: 'Customers' });
    const renamed = await store.updateDataset({ id: imported.id, name: 'Customer Inputs' });
    expect(renamed.id).toBe(imported.id);
    expect(renamed.tableName).toBe(imported.tableName);
    expect(renamed.name).toBe('Customer Inputs');

    const updated = await store.updateDataset({
      id: imported.id,
      filePath: nextCsvPath,
      name: 'Customer Inputs 2026',
    });
    expect(updated.id).toBe(imported.id);
    expect(updated.tableName).toBe(imported.tableName);
    expect(updated.name).toBe('Customer Inputs 2026');
    expect(updated.sourcePath).toBe(nextCsvPath);
    expect(updated.rowCount).toBe(2);
    expect(updated.columnCount).toBe(3);

    const dashboard = await store.getDashboard({ query: 'Customer Inputs' });
    expect(dashboard.datasets).toHaveLength(1);
  });

  it('persists workflow operators and edges', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const task = await store.createTask({ name: 'Workflow draft' });
    expect((await store.getTaskWorkflow(task.id)).nodes).toHaveLength(0);
    const saved = await store.saveTaskWorkflow(task.id, {
      nodes: [
        {
          id: 'node_source',
          type: 'input_source',
          label: '数据源',
          x: 40,
          y: 120,
          config: { output: 'raw' },
        },
        {
          id: 'node_missing',
          type: 'missing_value',
          label: '缺失值处理',
          x: 180,
          y: 120,
          config: { strategy: 'drop_rows_by_nulls', condition: 'any_null' },
        },
      ],
      edges: [
        {
          id: 'edge_source_missing',
          sourceNodeId: 'node_source',
          targetNodeId: 'node_missing',
        },
      ],
    });
    expect(saved.nodes).toHaveLength(2);
    expect(saved.edges).toHaveLength(1);
    expect(saved.task.nodeCount).toBe(2);

    stores.pop()?.close();
    const reopenedStore = createDataTaskStore(dbPath);
    stores.push(reopenedStore);
    const reopened = await reopenedStore.getTaskWorkflow(task.id);
    expect(reopened.nodes.map((node) => node.id)).toEqual([
      expect.stringMatching(/__node_source$/),
      expect.stringMatching(/__node_missing$/),
    ]);
    expect(reopened.edges[0]?.sourceNodeId).toMatch(/__node_source$/);
  });

  it('creates an associated output table when saving an automatic output node', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const sourcePath = path.join(tempRoot, 'sales.csv');
    fs.writeFileSync(sourcePath, 'sale_id,amount\n1,20\n2,30\n', 'utf8');
    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const task = await store.createTask({ name: 'Auto publish', sourcePath });
    const parsed = parsePrepDsl(`
      input source task as sales

      from sales
        | output table "temporary_name" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes.map((node) =>
        node.type === 'output'
          ? {
              ...node,
              config: {
                ...node.config,
                outputStrategy: 'auto',
                outputTableName: 'Sales curated output',
              },
            }
          : node
      ),
      edges: compiled.edges,
    });

    const outputNode = saved.nodes.find((node) => node.type === 'output');
    expect(outputNode?.config.outputStrategy).toBe('auto');
    expect(outputNode?.config.outputTableName).toBe('Sales curated output');
    expect(outputNode?.config.outputDatasetId).toEqual(expect.any(String));
    expect(outputNode?.config.table).toEqual(expect.stringMatching(/^output_/));

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.outputTable).toBe(outputNode?.config.table);
    expect(completed.rowCount).toBe(2);

    const workflowAfterRun = await store.getTaskWorkflow(task.id);
    const outputNodeAfterRun = workflowAfterRun.nodes.find((node) => node.type === 'output');
    expect(outputNodeAfterRun?.config.outputStrategy).toBe('auto');
    expect(outputNodeAfterRun?.config.outputTableName).toBe('Sales curated output');
    expect(outputNodeAfterRun?.config.outputDatasetId).toBe(outputNode?.config.outputDatasetId);

    const dashboard = await store.getDashboard({
      includeTasks: false,
      includeDatasets: false,
      includeOutputTables: true,
    });
    expect(dashboard.outputTables).toHaveLength(1);
    expect(dashboard.outputTables[0]?.name).toBe('Sales curated output');
    expect(dashboard.outputTables[0]?.relatedTaskNames).toEqual(['Auto publish']);

    const renamedNodes = saved.nodes.map((node) => {
      const config = { ...node.config };
      if (node.type === 'output') {
        config.outputTableName = 'Sales final output';
        delete config.table;
      }
      return {
        id: node.id,
        type: node.type,
        label: node.label,
        x: node.x,
        y: node.y,
        config,
      };
    });
    const resaved = await store.saveTaskWorkflow(task.id, {
      nodes: renamedNodes,
      edges: saved.edges,
    });
    const resavedOutputNode = resaved.nodes.find((node) => node.type === 'output');
    expect(resavedOutputNode?.config.outputStrategy).toBe('auto');
    expect(resavedOutputNode?.config.outputTableName).toBe('Sales final output');
    expect(resavedOutputNode?.config.outputDatasetId).toBe(outputNode?.config.outputDatasetId);
    const dashboardAfterResave = await store.getDashboard({
      includeTasks: false,
      includeDatasets: false,
      includeOutputTables: true,
    });
    expect(dashboardAfterResave.outputTables).toHaveLength(1);
    expect(dashboardAfterResave.outputTables[0]?.name).toBe('Sales final output');
  });

  it('runs a saved DSL workflow with a left join', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'orders.csv');
    const customersPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(
      ordersPath,
      'order_id,customer_id,revenue\n1,c1,20\n2,c2,5\n3,c9,30\n',
      'utf8'
    );
    fs.writeFileSync(customersPath, 'customer_id,name\nc1,Alice\nc2,Bob\n', 'utf8');

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    await store.importDataset({ filePath: customersPath, name: 'customers' });
    const task = await store.createTask({ name: 'Join orders', sourcePath: ordersPath });
    const parsed = parsePrepDsl(`
      input source task as orders
      input source dataset "customers" as customers

      from orders
        | cast [revenue] as float on_error null
        | join left customers
            on [orders].[customer_id] = [customers].[customer_id]
            keep left *, [customers].[name] as [customer_name]
            expect many_to_one
        | filter [revenue] > 10
        | output table "orders_joined" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.outputTable).toBe('orders_joined');
    expect(completed.rowCount).toBe(2);

    stores.pop()?.close();
    const instance = await DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    try {
      const reader = await connection.runAndReadAll(
        'SELECT order_id, customer_name FROM orders_joined ORDER BY order_id'
      );
      expect(reader.getRowObjectsJson()).toEqual([
        { order_id: '1', customer_name: 'Alice' },
        { order_id: '3', customer_name: null },
      ]);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  it('warns when a join violates its declared cardinality', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'orders.csv');
    const customersPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(ordersPath, 'order_id,customer_id\n1,c1\n', 'utf8');
    fs.writeFileSync(customersPath, 'customer_id,name\nc1,Alice\nc1,Alicia\n', 'utf8');

    const store = createDataTaskStore(dbPath, { now: () => 1_780_000_000_000 });
    stores.push(store);
    await store.importDataset({ filePath: customersPath, name: 'customers' });
    const task = await store.createTask({ name: 'Cardinality warning', sourcePath: ordersPath });
    const parsed = parsePrepDsl(`
      input source task as orders
      input source dataset "customers" as customers

      from orders
        | join left customers
            on [orders].[customer_id] = [customers].[customer_id]
            keep left *, [customers].[name]
            expect many_to_one
        | output table "cardinality_warning" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    await store.saveTaskWorkflow(task.id, { nodes: compiled.nodes, edges: compiled.edges });

    const result = await store.runTaskWithDiagnostics(task.id);
    expect(result.task.status).toBe('completed');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          code: 'joinCardinalityMismatch',
          params: expect.objectContaining({ expectation: 'many_to_one', side: 'right' }),
        }),
      ])
    );
  });

  it('writes workflow output nodes into selected output tables', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'orders.csv');
    fs.writeFileSync(
      ordersPath,
      'order_id,customer_id,revenue\n1,c1,20\n2,c2,5\n3,c3,30\n',
      'utf8'
    );

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const outputTable = await store.createOutputTable({ name: 'Orders output' });
    const task = await store.createTask({ name: 'Publish orders', sourcePath: ordersPath });
    const parsed = parsePrepDsl(`
      input source task as orders

      from orders
        | cast [revenue] as float on_error null
        | filter [revenue] > 10
        | output table "ignored_output" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes.map((node) =>
        node.type === 'output'
          ? {
              ...node,
              config: {
                ...node.config,
                outputDatasetId: outputTable.id,
                table: 'ignored_output',
              },
            }
          : node
      ),
      edges: compiled.edges,
    });

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.outputTable).toBe(outputTable.tableName);
    expect(completed.rowCount).toBe(2);

    const dashboard = await store.getDashboard({
      includeTasks: false,
      includeDatasets: false,
      includeOutputTables: true,
    });
    expect(dashboard.outputTables).toHaveLength(1);
    expect(dashboard.outputTables[0]?.name).toBe('Orders output');
    expect(dashboard.outputTables[0]?.tableName).toBe(outputTable.tableName);
    expect(dashboard.outputTables[0]?.relatedTaskNames).toEqual(['Publish orders']);

    const preview = await store.previewDataset({ id: outputTable.id });
    expect(preview.totalRows).toBe(2);

    stores.pop()?.close();
    const instance = await DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    try {
      const reader = await connection.runAndReadAll(
        `SELECT order_id FROM ${outputTable.tableName} ORDER BY order_id`
      );
      expect(reader.getRowObjectsJson()).toEqual([{ order_id: '1' }, { order_id: '3' }]);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  it('runs workflows that only read from configured input tables without a task source file', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const customersPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(customersPath, 'customer_id,name\nc1,Alice\nc2,Bob\n', 'utf8');

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    await store.importDataset({ filePath: customersPath, name: 'customers' });
    const task = await store.createTask({ name: 'Dataset only workflow' });
    const parsed = parsePrepDsl(`
      input source dataset "customers" as customers

      from customers
        | output table "customers_copy" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.outputTable).toBe('customers_copy');
    expect(completed.rowCount).toBe(2);
  });

  it('runs unsaved workflow overrides into a temporary table without overwriting the saved output', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'orders.csv');
    fs.writeFileSync(
      ordersPath,
      'order_id,customer_id,revenue\n1,c1,20\n2,c2,5\n3,c3,30\n',
      'utf8'
    );

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const outputTable = await store.createOutputTable({ name: 'Formal output' });
    const task = await store.createTask({ name: 'Draft run', sourcePath: ordersPath });
    const parsed = parsePrepDsl(`
      input source task as orders

      from orders
        | cast [revenue] as float on_error null
        | filter [revenue] > 25
        | output table "ignored_output" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes.map((node) =>
        node.type === 'output'
          ? {
              ...node,
              config: {
                ...node.config,
                outputDatasetId: outputTable.id,
              },
            }
          : node
      ),
      edges: compiled.edges,
    });

    const formalRun = await store.runTask(task.id);
    expect(formalRun.outputTable).toBe(outputTable.tableName);
    expect(formalRun.rowCount).toBe(1);

    const draftNodes = saved.nodes.map((node) =>
      node.type === 'filter'
        ? {
            id: node.id,
            type: node.type,
            label: node.label,
            x: node.x,
            y: node.y,
            config: {
              ...node.config,
              condition: '[revenue] > 10',
            },
          }
        : {
            id: node.id,
            type: node.type,
            label: node.label,
            x: node.x,
            y: node.y,
            config: node.config,
          }
    );
    const temporaryRun = await store.runTask(task.id, {
      workflow: {
        nodes: draftNodes,
        edges: saved.edges.map((edge) => ({
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        })),
      },
      outputMode: 'temporary',
    });
    expect(temporaryRun.outputTable).toMatch(/^temp_task_/);
    expect(temporaryRun.rowCount).toBe(2);

    const persistedWorkflow = await store.getTaskWorkflow(task.id);
    expect(persistedWorkflow.nodes.find((node) => node.type === 'filter')?.config.condition).toBe(
      '[revenue] > 25'
    );
    const formalPreview = await store.previewDataset({ id: outputTable.id });
    expect(formalPreview.totalRows).toBe(1);
  });

  it('previews cached workflow node data after a task run', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'orders.csv');
    fs.writeFileSync(ordersPath, 'order_id,revenue\n1,20\n2,5\n3,30\n', 'utf8');

    let store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const task = await store.createTask({ name: 'Preview cached node', sourcePath: ordersPath });
    const parsed = parsePrepDsl(`
      input source task as orders

      from orders
        | cast [revenue] as float on_error null
        | filter [revenue] > 10
        | output table "cached_node_output" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });
    const filterNode = saved.nodes.find((node) => node.type === 'filter');
    expect(filterNode).toBeTruthy();

    const beforeRun = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(beforeRun.totalRows).toBe(0);
    await expect(
      store.getWorkflowNodeColumns({
        taskId: task.id,
        nodeId: filterNode!.id,
        nodeType: filterNode!.type,
        nodeConfig: filterNode!.config,
      })
    ).resolves.toEqual([]);

    await store.runTask(task.id);
    await expect(
      store.getWorkflowNodeColumns({
        taskId: task.id,
        nodeId: filterNode!.id,
        nodeType: filterNode!.type,
        nodeConfig: filterNode!.config,
      })
    ).resolves.toEqual(['order_id', 'revenue']);
    const preview = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
      limit: 1,
      offset: 1,
    });

    expect(preview.columns).toEqual(['order_id', 'revenue']);
    expect(preview.totalRows).toBe(2);
    expect(preview.limit).toBe(1);
    expect(preview.offset).toBe(1);
    expect(String(preview.rows[0]?.order_id)).toBe('3');

    stores.pop()?.close();
    store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);
    const reopenedPreview = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(reopenedPreview.columns).toEqual(['order_id', 'revenue']);
    expect(reopenedPreview.totalRows).toBe(2);
  });

  it('keeps temporary workflow node caches for one day then expires them', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'temporary-cache-orders.csv');
    fs.writeFileSync(ordersPath, 'order_id,revenue\n1,20\n2,5\n3,30\n', 'utf8');

    let now = 1_780_000_000_000;
    const store = createDataTaskStore(dbPath, {
      now: () => now,
    });
    stores.push(store);

    const task = await store.createTask({ name: 'Temporary cache', sourcePath: ordersPath });
    const parsed = parsePrepDsl(`
      input source task as orders

      from orders
        | filter [revenue] > 10
        | output table "temporary_cache_output" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });
    const filterNode = saved.nodes.find((node) => node.type === 'filter');
    expect(filterNode).toBeTruthy();

    await store.runTask(task.id, { outputMode: 'temporary' });
    const freshPreview = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(freshPreview.totalRows).toBe(2);

    now += 86_400_001;
    const expiredPreview = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(expiredPreview.totalRows).toBe(0);
    expect(expiredPreview.columns).toEqual([]);
  });

  it('previews input table data and columns before a task run', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'input-orders.csv');
    fs.writeFileSync(ordersPath, 'order_id,revenue\n1,20\n2,5\n', 'utf8');

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const dataset = await store.importDataset({ filePath: ordersPath });
    const task = await store.createTask({ name: 'Input source columns' });
    const parsed = parsePrepDsl(`
      input source dataset "${dataset.id}" as orders

      from orders
        | filter [revenue] > 10
        | output table "input_source_columns_output" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });
    const inputNode = saved.nodes.find((node) => node.type === 'input_source');
    expect(inputNode).toBeTruthy();

    await expect(
      store.getWorkflowNodeColumns({
        taskId: task.id,
        nodeId: inputNode!.id,
        nodeType: inputNode!.type,
        nodeConfig: inputNode!.config,
      })
    ).resolves.toEqual(['order_id', 'revenue']);

    const preview = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: inputNode!.id,
      nodeType: inputNode!.type,
      nodeConfig: inputNode!.config,
    });
    expect(preview.columns).toEqual(['order_id', 'revenue']);
    expect(preview.rows).toEqual([
      { order_id: '1', revenue: '20' },
      { order_id: '2', revenue: '5' },
    ]);
    expect(preview.totalRows).toBe(2);
  });

  it('runs filter expressions with unicode field names and string literals', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'cn-orders.csv');
    fs.writeFileSync(ordersPath, '订单ID,金额\nA1000001,10\nA1000002,20\n', 'utf8');

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const task = await store.createTask({ name: 'Chinese field filter', sourcePath: ordersPath });
    const parsed = parsePrepDsl(`
      input source task as orders

      from orders
        | filter [订单ID]="A1000001"
        | output table "filtered_cn_orders" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const saved = await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.rowCount).toBe(1);

    const filterNode = saved.nodes.find((node) => node.type === 'filter');
    expect(filterNode).toBeTruthy();
    const preview = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(preview.columns).toEqual(['订单ID', '金额']);
    expect(preview.totalRows).toBe(1);
    expect(preview.rows[0]?.['订单ID']).toBe('A1000001');
  });

  it('executes filter conditions with matches, not matches, begin, end, and nested groups', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const citiesPath = path.join(tempRoot, 'cities.csv');
    fs.writeFileSync(
      citiesPath,
      [
        'City,Category',
        'Aachen,Furniture',
        'Albany,Technology',
        'Bremen,Technology',
        'Camden,Office Supplies',
      ].join('\n'),
      'utf8'
    );

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const task = await store.createTask({
      name: 'Regex filter conditions',
      sourcePath: citiesPath,
    });
    const parsed = parsePrepDsl(`
      input source task as cities

      from cities
        | filter ([City] matches ".*en$" or [City] begin "Al") and [Category] not matches "Office.*"
        | output table "filtered_cities_regex" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.rowCount).toBe(3);

    const filterNode = saved.nodes.find((node) => node.type === 'filter');
    expect(filterNode).toBeTruthy();
    const preview = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(preview.columns).toEqual(['City', 'Category']);
    expect(preview.rows.map((row) => row.City)).toEqual(['Aachen', 'Albany', 'Bremen']);
  });

  it('preserves like and end filter behavior during execution', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const citiesPath = path.join(tempRoot, 'cities-like.csv');
    fs.writeFileSync(
      citiesPath,
      ['City,Category', 'Aachen,Furniture', 'Albany,Technology', 'Camden,Office Supplies'].join(
        '\n'
      ),
      'utf8'
    );

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const task = await store.createTask({ name: 'Like filter conditions', sourcePath: citiesPath });
    const parsed = parsePrepDsl(`
      input source task as cities

      from cities
        | filter [City] like "%ach%" and [Category] not like "Office%" and [City] end "en"
        | output table "filtered_cities_like" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.rowCount).toBe(1);

    const filterNode = saved.nodes.find((node) => node.type === 'filter');
    expect(filterNode).toBeTruthy();
    const preview = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(preview.rows.map((row) => row.City)).toEqual(['Aachen']);
  });

  it('executes saved workflows by walking backward from the output node', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'orders.csv');
    fs.writeFileSync(ordersPath, 'order_id,revenue\n1,20\n2,5\n3,30\n', 'utf8');

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const task = await store.createTask({ name: 'Unordered graph', sourcePath: ordersPath });
    const parsed = parsePrepDsl(`
      input source task as orders

      from orders
        | cast [revenue] as float on_error null
        | filter [revenue] > 10
        | output table "unordered_output" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    await store.saveTaskWorkflow(task.id, {
      nodes: [...compiled.nodes].reverse(),
      edges: compiled.edges,
    });

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.outputTable).toBe('unordered_output');
    expect(completed.rowCount).toBe(2);
  });

  it('runs a saved DSL workflow with an asof join', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const eventsPath = path.join(tempRoot, 'events.csv');
    const statusPath = path.join(tempRoot, 'status.csv');
    fs.writeFileSync(
      eventsPath,
      'event_id,device_id,event_time\n1,d1,2024-01-01 10:00:00\n2,d1,2024-01-01 12:00:00\n3,d2,2024-01-01 10:00:00\n',
      'utf8'
    );
    fs.writeFileSync(
      statusPath,
      'device_id,snapshot_time,region\n' +
        'd1,2024-01-01 09:00:00,A\n' +
        'd1,2024-01-01 11:00:00,B\n' +
        'd2,2024-01-01 08:00:00,C\n',
      'utf8'
    );

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    await store.importDataset({ filePath: statusPath, name: 'status' });
    const task = await store.createTask({ name: 'Asof events', sourcePath: eventsPath });
    const parsed = parsePrepDsl(`
      input source task as events
      input source dataset "status" as status

      from events
        | cast [event_time] as datetime
        | join asof status
            on [events].[event_time] >= [status].[snapshot_time]
            by [events].[device_id] = [status].[device_id]
            tolerance 2h
            keep left *, [status].[region] as [status_region]
            expect many_to_one
        | output table "events_with_status" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    await store.saveTaskWorkflow(task.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.outputTable).toBe('events_with_status');
    expect(completed.rowCount).toBe(3);

    stores.pop()?.close();
    const instance = await DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    try {
      const reader = await connection.runAndReadAll(
        'SELECT event_id, status_region FROM events_with_status ORDER BY event_id'
      );
      expect(reader.getRowObjectsJson()).toEqual([
        { event_id: '1', status_region: 'A' },
        { event_id: '2', status_region: 'B' },
        { event_id: '3', status_region: 'C' },
      ]);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  it('removes previously seeded default workflow graphs', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');

    const initialStore = createDataTaskStore(dbPath);
    stores.push(initialStore);
    await initialStore.getDashboard();
    stores.pop()?.close();

    const instance = await DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    try {
      await connection.run(`
        INSERT INTO data_cleaning_tasks (
          id, name, status, node_count, source_path, source_dataset_id, output_table,
          row_count, column_count, error, scheduled_for, created_at, updated_at, last_run_at
        )
        VALUES (
          'legacy-default-task', 'Old default workflow', 'draft', 7, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, 1, 1, NULL
        )
      `);
      await connection.run(`
        INSERT INTO data_workflow_nodes (
          id, task_id, node_key, label, ordinal, operator_type, x, y,
          config_json, created_at, updated_at
        )
        VALUES
          ('legacy-node-1', 'legacy-default-task', 'source', '数据源', 1, 'input_source', 48, 128, '{}', 1, 1),
          ('legacy-node-2', 'legacy-default-task', 'filter', '筛选', 2, 'filter', 190, 128, '{}', 1, 1),
          ('legacy-node-3', 'legacy-default-task', 'deduplicate', '去重', 3, 'deduplicate', 332, 128, '{}', 1, 1),
          ('legacy-node-4', 'legacy-default-task', 'missing', '缺失值处理', 4, 'missing_value', 474, 128, '{}', 1, 1),
          ('legacy-node-5', 'legacy-default-task', 'calculate', '计算字段', 5, 'calculate_field', 190, 270, '{}', 1, 1),
          ('legacy-node-6', 'legacy-default-task', 'mapping', '字段映射', 6, 'field_mapping', 474, 270, '{}', 1, 1),
          ('legacy-node-7', 'legacy-default-task', 'output', '输出', 7, 'output', 474, 412, '{}', 1, 1)
      `);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }

    const store = createDataTaskStore(dbPath);
    stores.push(store);
    const workflow = await store.getTaskWorkflow('legacy-default-task');
    expect(workflow.nodes).toHaveLength(0);
    expect(workflow.edges).toHaveLength(0);
    expect(workflow.task.nodeCount).toBe(0);
  });

  it('persists tasks across store restarts and records failed runs', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');

    const store = createDataTaskStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const task = await store.createTask({ name: 'No source task' });
    expect(task.status).toBe('draft');
    await expect(store.runTask(task.id)).rejects.toThrow(/Data source file is required/);

    const failedDashboard = await store.getDashboard();
    expect(failedDashboard.summary.taskCount).toBe(1);
    expect(failedDashboard.summary.statusCounts.failed).toBe(1);
    expect(failedDashboard.tasks[0]?.status).toBe('failed');

    stores.pop()?.close();

    const reopenedStore = createDataTaskStore(dbPath);
    stores.push(reopenedStore);
    const reopenedDashboard = await reopenedStore.getDashboard();
    expect(reopenedDashboard.summary.taskCount).toBe(1);
    expect(reopenedDashboard.summary.statusCounts.failed).toBe(1);
    expect(reopenedDashboard.tasks[0]?.name).toBe('No source task');
  });

  it('removes legacy seeded demo rows while keeping real tasks', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');

    const initialStore = createDataTaskStore(dbPath);
    stores.push(initialStore);
    await initialStore.getDashboard();
    stores.pop()?.close();

    const instance = await DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    try {
      await connection.run(`
        INSERT INTO data_cleaning_tasks (
          id, name, status, node_count, source_path, source_dataset_id, output_table,
          row_count, column_count, error, scheduled_for, created_at, updated_at, last_run_at
        )
        VALUES
          ('legacy-demo', '用户行为数据清洗', 'running', 6, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1, NULL),
          ('real-task', '用户行为数据清洗', 'draft', 4, '/tmp/real.csv', NULL, NULL, NULL, NULL, NULL, NULL, 2, 2, NULL)
      `);
      await connection.run(`
        INSERT INTO data_workflow_nodes (id, task_id, node_key, label, ordinal, created_at)
        VALUES ('legacy-node', 'legacy-demo', 'load_source', 'load_source', 1, 1)
      `);
      await connection.run(`
        INSERT INTO data_datasets (
          id, name, source_path, table_name, row_count, column_count, created_at, updated_at
        )
        VALUES ('legacy-dataset', '用户行为明细', 'local://samples/user_events.csv', 'demo_dataset_1', 10, 2, 1, 1)
      `);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }

    const store = createDataTaskStore(dbPath);
    stores.push(store);
    const dashboard = await store.getDashboard();
    expect(dashboard.summary.taskCount).toBe(1);
    expect(dashboard.tasks).toHaveLength(1);
    expect(dashboard.tasks[0]?.id).toBe('real-task');
    expect(dashboard.datasets).toHaveLength(0);
  });

  it('keeps the DuckDB backend wired into IPC and packaging config', () => {
    const root = process.cwd();
    const dataIpc = ['data-tasks-ipc.ts', 'input-tables-ipc.ts', 'output-tables-ipc.ts']
      .map((file) => fs.readFileSync(path.join(root, 'src/main/data/ipc', file), 'utf8'))
      .join('\n');
    const preload = fs.readFileSync(path.join(root, 'src/preload/api/data.ts'), 'utf8');
    const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    const builder = fs.readFileSync(path.join(root, 'electron-builder.config.cjs'), 'utf8');

    expect(dataIpc).toContain("handleIpc('data.getDashboard'");
    expect(dataIpc).toContain("handleIpc('data.runTask'");
    expect(dataIpc).toContain("handleIpc('data.updateTask'");
    expect(dataIpc).toContain("handleIpc('data.getTaskWorkflow'");
    expect(dataIpc).toMatch(/handleIpc\(\s*['"]data\.saveTaskWorkflow['"]/);
    expect(dataIpc).toContain("handleIpc('data.importDataset'");
    expect(dataIpc).toContain("handleIpc('data.updateDataset'");
    expect(dataIpc).toContain("handleIpc('data.createOutputTable'");
    expect(dataIpc).toContain("handleIpc('data.updateOutputTable'");
    expect(dataIpc).toContain("handleIpc('data.previewDataset'");
    expect(dataIpc).toContain("'data.getWorkflowNodeColumnTypes'");
    expect(dataIpc).toContain("handleIpc('data.deleteTask'");
    expect(dataIpc).toContain("handleIpc('data.deleteDataset'");
    expect(fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8')).toContain(
      'data: createDataApi()'
    );
    expect(preload).toContain("ipcRenderer.invoke('data.updateTask'");
    expect(preload).toContain("ipcRenderer.invoke('data.importDataset'");
    expect(preload).toContain("ipcRenderer.invoke('data.updateDataset'");
    expect(preload).toContain("ipcRenderer.invoke('data.createOutputTable'");
    expect(preload).toContain("ipcRenderer.invoke('data.updateOutputTable'");
    expect(preload).toContain("ipcRenderer.invoke('data.previewDataset'");
    expect(preload).toContain("ipcRenderer.invoke('data.deleteDataset'");
    expect(preload).toContain("ipcRenderer.invoke('data.getTaskWorkflow'");
    expect(preload).toContain("ipcRenderer.invoke('data.saveTaskWorkflow'");
    expect(preload).toContain("ipcRenderer.invoke('data.deleteTask'");
    expect(vite).toContain("'@duckdb/node-api'");
    expect(builder).toContain("'node_modules/@duckdb/**/*'");
    expect(builder).toContain("'node_modules/@duckdb/**/*.node'");
  });
});

function writeWorkbook(filePath: string, rows: unknown[][]): void {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  XLSX.writeFile(workbook, filePath);
}

function writeWorkbookSheets(filePath: string, sheets: Record<string, unknown[][]>): void {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }
  XLSX.writeFile(workbook, filePath);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(predicate()).toBe(true);
}

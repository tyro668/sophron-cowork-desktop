import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import * as XLSX from '../src/main/utils/xlsx';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../src/main/data/data-pipeline-store';
import { compilePrepWorkflowToFlow, parsePrepDsl } from '../src/shared/prep-dsl';
import { getWorkflowUpstreamSignature } from '../src/shared/workflow-plan';

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

describe('DuckDB data pipeline store', () => {
  it('resolves dynamic pivot empty-string names without merging conflicting values', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const sourcePath = path.join(tempRoot, 'pivot-empty.csv');
    fs.writeFileSync(sourcePath, 'id,amount\n1,10\n2,20\n3,30\n4,40\n', 'utf8');

    const store = createDataPipelineStore(dbPath, { now: () => 1_780_000_000_000 });
    stores.push(store);
    const pipeline = await store.createPipeline({ name: 'Dynamic empty pivot', sourcePath });
    const parsed = parsePrepDsl(`
      input source pipeline as source

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
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    const pivotNode = saved.nodes.find((node) => node.type === 'pivot');
    expect(pivotNode).toBeTruthy();
    const preview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
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

    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);
    const pipeline = await store.createPipeline({ name: 'Empty dynamic pivot', sourcePath });
    const parsed = parsePrepDsl(`
      input source pipeline as source

      from source
        | pivot on [status] using sum([amount]) group by [region]
        | output table "empty_pivot_output" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    const pivotNode = saved.nodes.find((node) => node.type === 'pivot');
    expect(pivotNode).toBeTruthy();
    const preview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
      nodeId: pivotNode!.id,
      nodeType: pivotNode!.type,
      nodeConfig: pivotNode!.config,
    });
    expect(preview.columns).toEqual(['region']);
    expect(preview.rows).toEqual([]);
  });

  it('starts without demo pipelines or demo rawTables', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'));
    stores.push(store);

    const dashboard = await store.getDashboard();
    expect(dashboard.summary.pipelineCount).toBe(0);
    expect(dashboard.summary.workflowNodeCount).toBe(0);
    expect(dashboard.pipelines).toHaveLength(0);
    expect(dashboard.rawTables).toHaveLength(0);
  });

  it('paginates dashboard pipelines while keeping real total counts', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    let now = 1_780_000_000_000;
    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => now,
    });
    stores.push(store);

    for (let index = 1; index <= 23; index += 1) {
      now += 1_000;
      await store.createPipeline({ name: `Paged pipeline ${String(index).padStart(2, '0')}` });
    }

    const firstPage = await store.getDashboard({ pipelineOffset: 0, pipelineLimit: 10 });
    expect(firstPage.totalPipelines).toBe(23);
    expect(firstPage.pipelines).toHaveLength(10);
    expect(firstPage.pipelines[0]?.name).toBe('Paged pipeline 23');

    const thirdPage = await store.getDashboard({ pipelineOffset: 20, pipelineLimit: 10 });
    expect(thirdPage.totalPipelines).toBe(23);
    expect(thirdPage.pipelines.map((pipeline) => pipeline.name)).toEqual([
      'Paged pipeline 03',
      'Paged pipeline 02',
      'Paged pipeline 01',
    ]);
  });

  it('updates data pipeline names', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const pipeline = await store.createPipeline({ name: 'Original pipeline' });
    const updated = await store.updatePipeline({ id: pipeline.id, name: 'Renamed pipeline' });
    expect(updated.id).toBe(pipeline.id);
    expect(updated.name).toBe('Renamed pipeline');

    const dashboard = await store.getDashboard({ query: 'Renamed pipeline' });
    expect(dashboard.pipelines).toHaveLength(1);
    expect(dashboard.pipelines[0]?.name).toBe('Renamed pipeline');
  });

  it('imports rawTables and runs a local data cleaning pipeline', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const csvPath = path.join(tempRoot, 'events.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n1,Alice\n2,Bob\n,\n', 'utf8');

    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importRawTable({ filePath: csvPath });
    expect(imported.name).toBe('events');
    expect(imported.columnCount).toBe(2);
    expect(imported.rowCount).toBeGreaterThan(0);

    const pipeline = await store.createPipeline({ name: 'Clean events', sourcePath: csvPath });
    expect(pipeline.status).toBe('pending');
    const workflow = await store.getPipelineWorkflow(pipeline.id);
    expect(workflow.nodes).toHaveLength(0);
    expect(workflow.edges).toHaveLength(0);

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.columnCount).toBe(2);
    expect(completed.rowCount).toBe(2);
    expect(completed.resultTable).toMatch(/^clean_pipeline_/);

    const dashboard = await store.getDashboard({ query: 'events' });
    expect(dashboard.summary.pipelineCount).toBe(1);
    expect(dashboard.summary.workflowNodeCount).toBe(0);
    expect(dashboard.summary.statusCounts.completed).toBe(1);
    expect(dashboard.summary.statusCounts.failed).toBe(0);
    expect(dashboard.pipelines).toHaveLength(1);
    expect(dashboard.rawTables).toHaveLength(1);

    const outputDashboard = await store.getDashboard({
      includePipelines: false,
      includeRawTables: false,
      includeResultTables: true,
    });
    expect(outputDashboard.resultTables).toHaveLength(0);

    expect(await store.deletePipeline(completed.id)).toBe(true);
    const afterDelete = await store.getDashboard({ query: 'Clean events' });
    expect(afterDelete.summary.pipelineCount).toBe(0);
    expect(afterDelete.summary.statusCounts.completed).toBe(0);
    expect(afterDelete.pipelines).toHaveLength(0);
  });

  it('serializes concurrent pipeline runs on the shared DuckDB connection', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const csvPath = path.join(tempRoot, 'queued.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');
    const firstPipeline = await store.createPipeline({
      name: 'First queued pipeline',
      sourcePath: csvPath,
    });
    const secondPipeline = await store.createPipeline({
      name: 'Second queued pipeline',
      sourcePath: csvPath,
    });
    const internals = store as unknown as {
      ctx: { runSql: (sql: string) => Promise<void> };
      pipelineService: {
        executor: {
          cleanSourceIntoPipelineOutput: (
            pipeline: { id: string },
            sourcePath: string | null,
            workflow: unknown,
            outputMode: unknown
          ) => Promise<{
            resultTable: string;
            rowCount: number;
            columnCount: number;
            sourceRawTableId: string | null;
          }>;
        };
      };
    };
    const executor = internals.pipelineService.executor;
    const originalCleanSourceIntoPipelineOutput =
      executor.cleanSourceIntoPipelineOutput.bind(executor);
    let activeRuns = 0;
    let maxActiveRuns = 0;
    let callCount = 0;
    let releaseFirstRun!: () => void;
    executor.cleanSourceIntoPipelineOutput = async (pipeline) => {
      callCount += 1;
      activeRuns += 1;
      maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
      if (callCount === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstRun = resolve;
        });
      }
      activeRuns -= 1;
      const resultTable = `serialized_output_${pipeline.id.replace(/[^A-Za-z0-9]/g, '_')}`;
      await internals.ctx.runSql(`CREATE TABLE "${resultTable}" AS SELECT 1 AS value`);
      return {
        resultTable,
        rowCount: 1,
        columnCount: 1,
        sourceRawTableId: null,
      };
    };

    try {
      const firstRun = store.runPipeline(firstPipeline.id);
      await waitFor(() => callCount === 1);
      const secondRun = store.runPipeline(secondPipeline.id);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(callCount).toBe(1);

      releaseFirstRun();
      await firstRun;
      await secondRun;

      expect(callCount).toBe(2);
      expect(maxActiveRuns).toBe(1);
    } finally {
      executor.cleanSourceIntoPipelineOutput = originalCleanSourceIntoPipelineOutput;
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

    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importRawTable({ filePath: workbookPath });
    expect(imported.name).toBe('orders');
    expect(imported.columnCount).toBe(2);
    expect(imported.rowCount).toBe(2);
    expect(await store.deleteRawTable(imported.id)).toBe(true);
    const dashboard = await store.getDashboard({ query: 'orders' });
    expect(dashboard.rawTables).toHaveLength(0);
  });

  it('persists Excel sheet and header-row input table configuration', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const workbookPath = path.join(tempRoot, 'configured-orders.xlsx');
    writeWorkbookSheets(workbookPath, {
      Raw: [['skip'], [1]],
      Orders: [['report title'], ['id', 'amount'], [1, 10], [2, 20]],
    });

    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importRawTable({
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

  it('stores and exposes semantic column types for input, output, and pipeline tables', async () => {
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

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importRawTable({ filePath: workbookPath });
    const inputPreview = await store.previewRawTable({ id: imported.id });
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

    const resultTable = await store.createResultTable({ name: 'Typed output' });
    await store.updateResultTable({ id: resultTable.id, sourceRawTableId: imported.id });
    const outputPreview = await store.previewRawTable({ id: resultTable.id });
    expect(outputPreview.columnTypes.map((column) => column.type)).toEqual(
      inputPreview.columnTypes.map((column) => column.type)
    );

    const pipeline = await store.createPipeline({ name: 'Typed pipeline' });
    const parsed = parsePrepDsl(`
      input source rawTable "${imported.id}" as typed

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
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });
    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    const outputNode = saved.nodes.find((node) => node.type === 'output');
    expect(outputNode).toBeTruthy();
    const pipelineColumnTypes = await store.getWorkflowNodeColumnTypes({
      pipelineId: pipeline.id,
      nodeId: outputNode!.id,
      nodeType: outputNode!.type,
      nodeConfig: outputNode!.config,
    });
    expect(pipelineColumnTypes.map((column) => column.type)).toEqual([
      'text',
      'date',
      'datetime',
      'integer',
      'float',
      'decimal',
      'boolean',
    ]);
  });

  it('infers downstream node columns and types from the plan before any run', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'));
    stores.push(store);

    const csvPath = path.join(tempRoot, 'typed-source.csv');
    fs.writeFileSync(csvPath, 'id,name,amount\n1,Alice,10\n2,Bob,20\n', 'utf8');
    const imported = await store.importRawTable({ filePath: csvPath, name: 'Typed source' });

    const pipeline = await store.createPipeline({ name: 'Schema inference pipeline' });
    const parsed = parsePrepDsl(`
      input source rawTable "${imported.id}" as src

      from src
        | select [id], [amount]
        | filter [amount] > 0
        | output table "inferred_output" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });
    const filterNode = saved.nodes.find((node) => node.type === 'filter');
    const selectNode = saved.nodes.find((node) => node.type === 'field_select');
    expect(filterNode).toBeTruthy();
    expect(selectNode).toBeTruthy();

    // No run happened — types propagate through the plan instead of preview tables.
    const filterColumns = await store.getWorkflowNodeColumns({
      pipelineId: pipeline.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(filterColumns).toEqual(['id', 'amount']);

    const filterTypes = await store.getWorkflowNodeColumnTypes({
      pipelineId: pipeline.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(filterTypes.map((column) => column.name).sort()).toEqual(['amount', 'id']);
    expect(filterTypes.every((column) => column.type.length > 0)).toBe(true);

    const preview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(preview.columns).toEqual(['id', 'amount']);
    expect(preview.rows).toEqual([]);
    expect(preview.totalRows).toBe(0);
  });

  it('prefers the draft workflow schema over a materialized cache table', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'));
    stores.push(store);

    const csvPath = path.join(tempRoot, 'draft-source.csv');
    fs.writeFileSync(csvPath, 'id,name,amount\n1,Alice,10\n2,Bob,20\n', 'utf8');
    const imported = await store.importRawTable({ filePath: csvPath, name: 'Draft source' });

    const pipeline = await store.createPipeline({ name: 'Draft schema pipeline' });
    const parsed = parsePrepDsl(`
      input source rawTable "${imported.id}" as src

      from src
        | select [id], [amount]
        | output table "draft_schema_output" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });
    const selectNode = saved.nodes.find((node) => node.type === 'field_select');
    expect(selectNode).toBeTruthy();

    const saveInput = {
      nodes: saved.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        label: node.label,
        x: node.x,
        y: node.y,
        config: node.config,
      })),
      edges: saved.edges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
    };
    // Materialize the select node's cache with the two-column projection.
    await store.runPipelineWithDiagnostics(pipeline.id, {
      workflow: saveInput,
      outputMode: 'temporary',
    });
    await expect(
      store.getWorkflowNodeColumns({
        pipelineId: pipeline.id,
        nodeId: selectNode!.id,
        nodeType: selectNode!.type,
        nodeConfig: selectNode!.config,
      })
    ).resolves.toEqual(['id', 'amount']);

    // The draft narrows the projection — the selector must follow the draft
    // config, not the stale cache table.
    const draftInput = {
      nodes: saveInput.nodes.map((node) =>
        node.id === selectNode!.id ? { ...node, config: { ...node.config, columns: ['id'] } } : node
      ),
      edges: saveInput.edges,
    };
    await expect(
      store.getWorkflowNodeColumns({
        pipelineId: pipeline.id,
        nodeId: selectNode!.id,
        nodeType: selectNode!.type,
        nodeConfig: draftInput.nodes.find((node) => node.id === selectNode!.id)!.config,
        workflow: draftInput,
      })
    ).resolves.toEqual(['id']);
    const draftTypes = await store.getWorkflowNodeColumnTypes({
      pipelineId: pipeline.id,
      nodeId: selectNode!.id,
      nodeType: selectNode!.type,
      nodeConfig: draftInput.nodes.find((node) => node.id === selectNode!.id)!.config,
      workflow: draftInput,
    });
    expect(draftTypes.map((column) => column.name)).toEqual(['id']);
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

    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'));
    stores.push(store);

    const imported = await store.importRawTable({ filePath: workbookPath, sourceKind: 'excel' });
    fs.unlinkSync(workbookPath);
    fs.mkdirSync(workbookPath);

    const dashboard = await store.getDashboard({
      includePipelines: false,
      includeRawTables: true,
      rawTableLimit: 10,
    });
    expect(dashboard.rawTables).toHaveLength(1);
    expect(dashboard.rawTables[0]?.id).toBe(imported.id);
    expect(dashboard.rawTables[0]?.inputConfig.sourceKind).toBe('excel');
  });

  it('previews input table data using the current configuration', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const workbookPath = path.join(tempRoot, 'preview-orders.xlsx');
    writeWorkbookSheets(workbookPath, {
      Raw: [['ignored'], ['x']],
      Orders: [['report title'], ['id', 'amount'], [1, 10], [2, 20]],
    });

    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'));
    stores.push(store);

    const preview = await store.previewRawTableSource({
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

    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'));
    stores.push(store);

    const imported = await store.importRawTable({ filePath: csvPath, name: 'Customers' });
    const preview = await store.previewRawTable({ id: imported.id, limit: 1, offset: 1 });

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
    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const sourcePath = path.join(tempRoot, 'source.csv');
    fs.writeFileSync(sourcePath, 'id,value\n1,A\n2,B\n', 'utf8');
    const source = await store.importRawTable({ filePath: sourcePath, name: 'Source input' });

    const created = await store.createResultTable({ name: 'Draft output' });
    expect(created.name).toBe('Draft output');
    expect(created.sourceRawTableId).toBeNull();
    expect(created.tableName).toMatch(/^output_/);

    const renamed = await store.updateResultTable({
      id: created.id,
      name: 'Final output',
      sourceRawTableId: source.id,
    });
    expect(renamed.name).toBe('Final output');
    expect(renamed.sourceRawTableId).toBe(source.id);
    expect(renamed.rowCount).toBe(2);
    expect(renamed.columnCount).toBe(2);

    const dashboard = await store.getDashboard({
      includePipelines: false,
      includeRawTables: true,
      includeResultTables: true,
    });
    expect(dashboard.rawTables).toHaveLength(1);
    expect(dashboard.resultTables).toHaveLength(1);
    expect(dashboard.resultTables[0]?.name).toBe('Final output');
    expect(dashboard.resultTables[0]?.sourceRawTableId).toBe(source.id);

    const preview = await store.previewRawTable({ id: created.id });
    expect(preview.rows).toHaveLength(2);
    expect(preview.totalRows).toBe(2);
  });

  it('cleans legacy pipeline output metadata from configured output tables', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');

    const initialStore = createDataPipelineStore(dbPath);
    stores.push(initialStore);
    await initialStore.getDashboard();
    stores.pop()?.close();

    const instance = await DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    try {
      await connection.run(`
        INSERT INTO data_raw_tables (
          id, name, source_path, source_kind, config_json, file_count,
          table_name, row_count, column_count, created_at, updated_at
        )
        VALUES
          ('legacy-configured-output', 'Configured output', 'duckdb://outputs/output_legacy', 'output', '{}', 0, 'output_legacy', 0, 0, 1, 1),
          ('legacy-pipeline-output', 'Pipeline output dirty row', '/tmp/source.csv', 'output', '{}', 0, 'clean_pipeline_legacy', 10, 2, 1, 1)
      `);
      // Simulate a pre-ledger database: dropping the ledger makes the next
      // open re-run the versioned migrations (including one-time cleanups).
      await connection.run('DROP TABLE data_schema_migrations');
    } finally {
      connection.closeSync();
      instance.closeSync();
    }

    const store = createDataPipelineStore(dbPath);
    stores.push(store);
    const dashboard = await store.getDashboard({
      includePipelines: false,
      includeRawTables: true,
      includeResultTables: true,
    });

    expect(dashboard.rawTables).toHaveLength(0);
    expect(dashboard.resultTables).toHaveLength(1);
    expect(dashboard.resultTables[0]?.id).toBe('legacy-configured-output');

    stores.pop()?.close();
    const verifyInstance = await DuckDBInstance.create(dbPath);
    const verifyConnection = await verifyInstance.connect();
    try {
      const reader = await verifyConnection.runAndReadAll(
        'SELECT id, config_json FROM data_raw_tables ORDER BY id'
      );
      expect(reader.getRowObjectsJson()).toEqual([
        {
          id: 'legacy-configured-output',
          config_json: '{"kind":"result_table"}',
        },
      ]);
    } finally {
      verifyConnection.closeSync();
      verifyInstance.closeSync();
    }
  });

  it('imports a folder by merging Excel and Csv files into one input table', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const sourceFolder = path.join(tempRoot, 'monthly-inputs');
    fs.mkdirSync(sourceFolder);
    fs.writeFileSync(path.join(sourceFolder, 'customers.csv'), 'id,name\n1,Alice\n', 'utf8');
    writeWorkbook(path.join(sourceFolder, 'regions.xlsx'), [
      ['id', 'region'],
      [2, '华东'],
    ]);

    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importRawTable({ filePath: sourceFolder });
    expect(imported.name).toBe('monthly-inputs');
    expect(imported.sourcePath).toBe(sourceFolder);
    expect(imported.sourceKind).toBe('folder');
    expect(imported.fileCount).toBe(2);
    expect(imported.inputConfig.sourceKind).toBe('folder');
    expect(imported.columnCount).toBe(4);
    expect(imported.rowCount).toBe(2);
  });

  it('loads dashboard pipeline and raw-table lists lazily', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const excelPath = path.join(tempRoot, 'orders.xlsx');
    const csvPath = path.join(tempRoot, 'customers.csv');
    writeWorkbook(excelPath, [
      ['id', 'amount'],
      [1, 10],
    ]);
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');

    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);
    await store.createPipeline({ name: 'Paged pipeline 01' });
    await store.createPipeline({ name: 'Paged pipeline 02' });
    await store.importRawTable({ filePath: excelPath });
    const csvRawTable = await store.importRawTable({ filePath: csvPath });
    await store.createPipeline({ name: 'Uses customers', sourcePath: csvPath });

    const pipelinesOnly = await store.getDashboard({
      includePipelines: true,
      includeRawTables: false,
      pipelineOffset: 0,
      pipelineLimit: 1,
    });
    expect(pipelinesOnly.pipelines).toHaveLength(1);
    expect(pipelinesOnly.rawTables).toHaveLength(0);
    expect(pipelinesOnly.totalPipelines).toBe(3);
    expect(pipelinesOnly.totalRawTables).toBe(0);

    const csvTablesOnly = await store.getDashboard({
      includePipelines: false,
      includeRawTables: true,
      rawTableSourceKind: 'csv',
      rawTableOffset: 0,
      rawTableLimit: 1,
    });
    expect(csvTablesOnly.pipelines).toHaveLength(0);
    expect(csvTablesOnly.rawTables).toHaveLength(1);
    expect(csvTablesOnly.rawTables[0]?.id).toBe(csvRawTable.id);
    expect(csvTablesOnly.rawTables[0]?.relatedPipelineNames).toEqual(['Uses customers']);
    expect(csvTablesOnly.totalPipelines).toBe(3);
    expect(csvTablesOnly.totalRawTables).toBe(1);
  });

  it('updates an existing input table in place', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const firstCsvPath = path.join(tempRoot, 'first.csv');
    const nextCsvPath = path.join(tempRoot, 'next.csv');
    fs.writeFileSync(firstCsvPath, 'id,name\n1,Alice\n', 'utf8');
    fs.writeFileSync(nextCsvPath, 'id,name,region\n1,Alice,East\n2,Bob,West\n', 'utf8');

    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importRawTable({ filePath: firstCsvPath, name: 'Customers' });
    const renamed = await store.updateRawTable({ id: imported.id, name: 'Customer Inputs' });
    expect(renamed.id).toBe(imported.id);
    expect(renamed.tableName).toBe(imported.tableName);
    expect(renamed.name).toBe('Customer Inputs');

    const updated = await store.updateRawTable({
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
    expect(dashboard.rawTables).toHaveLength(1);
  });

  it('persists workflow operators and edges', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const pipeline = await store.createPipeline({ name: 'Workflow draft' });
    expect((await store.getPipelineWorkflow(pipeline.id)).nodes).toHaveLength(0);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
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
    expect(saved.pipeline.nodeCount).toBe(2);

    stores.pop()?.close();
    const reopenedStore = createDataPipelineStore(dbPath);
    stores.push(reopenedStore);
    const reopened = await reopenedStore.getPipelineWorkflow(pipeline.id);
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
    const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const pipeline = await store.createPipeline({ name: 'Auto publish', sourcePath });
    const parsed = parsePrepDsl(`
      input source pipeline as sales

      from sales
        | output table "temporary_name" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes.map((node) =>
        node.type === 'output'
          ? {
              ...node,
              config: {
                ...node.config,
                outputStrategy: 'auto',
                resultTableName: 'Sales curated output',
              },
            }
          : node
      ),
      edges: compiled.edges,
    });

    const outputNode = saved.nodes.find((node) => node.type === 'output');
    expect(outputNode?.config.outputStrategy).toBe('auto');
    expect(outputNode?.config.resultTableName).toBe('Sales curated output');
    expect(outputNode?.config.outputResultTableId).toEqual(expect.any(String));
    expect(outputNode?.config.table).toEqual(expect.stringMatching(/^output_/));

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.resultTable).toBe(outputNode?.config.table);
    expect(completed.rowCount).toBe(2);

    const workflowAfterRun = await store.getPipelineWorkflow(pipeline.id);
    const outputNodeAfterRun = workflowAfterRun.nodes.find((node) => node.type === 'output');
    expect(outputNodeAfterRun?.config.outputStrategy).toBe('auto');
    expect(outputNodeAfterRun?.config.resultTableName).toBe('Sales curated output');
    expect(outputNodeAfterRun?.config.outputResultTableId).toBe(
      outputNode?.config.outputResultTableId
    );

    const dashboard = await store.getDashboard({
      includePipelines: false,
      includeRawTables: false,
      includeResultTables: true,
    });
    expect(dashboard.resultTables).toHaveLength(1);
    expect(dashboard.resultTables[0]?.name).toBe('Sales curated output');
    expect(dashboard.resultTables[0]?.relatedPipelineNames).toEqual(['Auto publish']);
    expect(dashboard.resultTables[0]?.relatedPipelineIds).toEqual([pipeline.id]);

    // File exports build against the materialized table + provenance metadata.
    const resultTableId = dashboard.resultTables[0]!.id;
    const csvExport = await store.buildTableExport({
      tableKind: 'result',
      id: resultTableId,
      format: 'csv',
    });
    expect(csvExport.fileName).toBe('Sales curated output.csv');
    expect(String(csvExport.content)).toContain(',');

    const xlsxExport = await store.buildTableExport({
      tableKind: 'result',
      id: resultTableId,
      format: 'xlsx',
    });
    expect(xlsxExport.fileName).toBe('Sales curated output.xlsx');
    const xlsxRows = XLSX.utils.sheet_to_json<(string | number)[]>(
      XLSX.read(xlsxExport.content, { type: 'buffer' }).Sheets.data,
      { header: 1 }
    );
    expect(xlsxRows.length).toBe(3); // header + 2 rows

    const renamedNodes = saved.nodes.map((node) => {
      const config = { ...node.config };
      if (node.type === 'output') {
        config.resultTableName = 'Sales final output';
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
    const resaved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: renamedNodes,
      edges: saved.edges,
    });
    const resavedOutputNode = resaved.nodes.find((node) => node.type === 'output');
    expect(resavedOutputNode?.config.outputStrategy).toBe('auto');
    expect(resavedOutputNode?.config.resultTableName).toBe('Sales final output');
    expect(resavedOutputNode?.config.outputResultTableId).toBe(
      outputNode?.config.outputResultTableId
    );
    const dashboardAfterResave = await store.getDashboard({
      includePipelines: false,
      includeRawTables: false,
      includeResultTables: true,
    });
    expect(dashboardAfterResave.resultTables).toHaveLength(1);
    expect(dashboardAfterResave.resultTables[0]?.name).toBe('Sales final output');
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

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    await store.importRawTable({ filePath: customersPath, name: 'customers' });
    const pipeline = await store.createPipeline({ name: 'Join orders', sourcePath: ordersPath });
    const parsed = parsePrepDsl(`
      input source pipeline as orders
      input source rawTable "customers" as customers

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
    await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.resultTable).toBe('orders_joined');
    expect(completed.rowCount).toBe(2);

    const stats = await store.getPipelineNodeStats(pipeline.id);
    const joinStat = stats.find((stat) => stat.nodeType === 'join');
    expect(joinStat?.inputRows).toBe(5);
    expect(joinStat?.inputRowsByHandle).toEqual({ left: 3, right: 2 });
    const filterStat = stats.find((stat) => stat.nodeType === 'filter');
    expect(filterStat?.inputRows).toBe(3);
    expect(filterStat?.inputRowsByHandle).toBeUndefined();
    expect(filterStat?.droppedRows).toBe(1);

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

    const store = createDataPipelineStore(dbPath, { now: () => 1_780_000_000_000 });
    stores.push(store);
    await store.importRawTable({ filePath: customersPath, name: 'customers' });
    const pipeline = await store.createPipeline({
      name: 'Cardinality warning',
      sourcePath: ordersPath,
    });
    const parsed = parsePrepDsl(`
      input source pipeline as orders
      input source rawTable "customers" as customers

      from orders
        | join left customers
            on [orders].[customer_id] = [customers].[customer_id]
            keep left *, [customers].[name]
            expect many_to_one
        | output table "cardinality_warning" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    await store.savePipelineWorkflow(pipeline.id, { nodes: compiled.nodes, edges: compiled.edges });

    const result = await store.runPipelineWithDiagnostics(pipeline.id);
    expect(result.pipeline.status).toBe('completed');
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

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const resultTable = await store.createResultTable({ name: 'Orders output' });
    const pipeline = await store.createPipeline({ name: 'Publish orders', sourcePath: ordersPath });
    const parsed = parsePrepDsl(`
      input source pipeline as orders

      from orders
        | cast [revenue] as float on_error null
        | filter [revenue] > 10
        | output table "ignored_output" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes.map((node) =>
        node.type === 'output'
          ? {
              ...node,
              config: {
                ...node.config,
                outputResultTableId: resultTable.id,
                table: 'ignored_output',
              },
            }
          : node
      ),
      edges: compiled.edges,
    });

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.resultTable).toBe(resultTable.tableName);
    expect(completed.rowCount).toBe(2);

    const dashboard = await store.getDashboard({
      includePipelines: false,
      includeRawTables: false,
      includeResultTables: true,
    });
    expect(dashboard.resultTables).toHaveLength(1);
    expect(dashboard.resultTables[0]?.name).toBe('Orders output');
    expect(dashboard.resultTables[0]?.tableName).toBe(resultTable.tableName);
    expect(dashboard.resultTables[0]?.relatedPipelineNames).toEqual(['Publish orders']);

    const preview = await store.previewRawTable({ id: resultTable.id });
    expect(preview.totalRows).toBe(2);

    stores.pop()?.close();
    const instance = await DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    try {
      const reader = await connection.runAndReadAll(
        `SELECT order_id FROM ${resultTable.tableName} ORDER BY order_id`
      );
      expect(reader.getRowObjectsJson()).toEqual([{ order_id: '1' }, { order_id: '3' }]);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  it('runs workflows that only read from configured input tables without a pipeline source file', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const customersPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(customersPath, 'customer_id,name\nc1,Alice\nc2,Bob\n', 'utf8');

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    await store.importRawTable({ filePath: customersPath, name: 'customers' });
    const pipeline = await store.createPipeline({ name: 'RawTable only workflow' });
    const parsed = parsePrepDsl(`
      input source rawTable "customers" as customers

      from customers
        | output table "customers_copy" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.resultTable).toBe('customers_copy');
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

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const resultTable = await store.createResultTable({ name: 'Formal output' });
    const pipeline = await store.createPipeline({ name: 'Draft run', sourcePath: ordersPath });
    const parsed = parsePrepDsl(`
      input source pipeline as orders

      from orders
        | cast [revenue] as float on_error null
        | filter [revenue] > 25
        | output table "ignored_output" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes.map((node) =>
        node.type === 'output'
          ? {
              ...node,
              config: {
                ...node.config,
                outputResultTableId: resultTable.id,
              },
            }
          : node
      ),
      edges: compiled.edges,
    });

    const formalRun = await store.runPipeline(pipeline.id);
    expect(formalRun.resultTable).toBe(resultTable.tableName);
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
    const temporaryRun = await store.runPipeline(pipeline.id, {
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
    expect(temporaryRun.resultTable).toMatch(/^temp_pipeline_/);
    expect(temporaryRun.rowCount).toBe(2);

    const persistedWorkflow = await store.getPipelineWorkflow(pipeline.id);
    expect(persistedWorkflow.nodes.find((node) => node.type === 'filter')?.config.condition).toBe(
      '[revenue] > 25'
    );
    const formalPreview = await store.previewRawTable({ id: resultTable.id });
    expect(formalPreview.totalRows).toBe(1);
  });

  it('previews cached workflow node data after a pipeline run', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'orders.csv');
    fs.writeFileSync(ordersPath, 'order_id,revenue\n1,20\n2,5\n3,30\n', 'utf8');

    let store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const pipeline = await store.createPipeline({
      name: 'Preview cached node',
      sourcePath: ordersPath,
    });
    const parsed = parsePrepDsl(`
      input source pipeline as orders

      from orders
        | cast [revenue] as float on_error null
        | filter [revenue] > 10
        | output table "cached_node_output" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });
    const filterNode = saved.nodes.find((node) => node.type === 'filter');
    expect(filterNode).toBeTruthy();

    const beforeRun = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(beforeRun.totalRows).toBe(0);
    // No materialized table yet — columns resolve through plan inference.
    await expect(
      store.getWorkflowNodeColumns({
        pipelineId: pipeline.id,
        nodeId: filterNode!.id,
        nodeType: filterNode!.type,
        nodeConfig: filterNode!.config,
      })
    ).resolves.toEqual(['order_id', 'revenue']);

    await store.runPipeline(pipeline.id);
    await expect(
      store.getWorkflowNodeColumns({
        pipelineId: pipeline.id,
        nodeId: filterNode!.id,
        nodeType: filterNode!.type,
        nodeConfig: filterNode!.config,
      })
    ).resolves.toEqual(['order_id', 'revenue']);
    const preview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
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
    store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);
    const reopenedPreview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(reopenedPreview.columns).toEqual(['order_id', 'revenue']);
    expect(reopenedPreview.totalRows).toBe(2);
  });

  it('stamps node caches with the generating upstream signature and timestamp', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'signature-orders.csv');
    fs.writeFileSync(ordersPath, 'order_id,revenue\n1,20\n2,5\n3,30\n', 'utf8');

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);
    const pipeline = await store.createPipeline({
      name: 'Cache signature',
      sourcePath: ordersPath,
    });
    const parsed = parsePrepDsl(`
      input source pipeline as orders

      from orders
        | filter [revenue] > 10
        | output table "signature_output" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });
    const filterNode = saved.nodes.find((node) => node.type === 'filter');
    const outputNode = saved.nodes.find((node) => node.type === 'output');
    expect(filterNode).toBeTruthy();
    expect(outputNode).toBeTruthy();

    await store.runPipeline(pipeline.id);

    const preview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    const signatureInput = { nodes: saved.nodes, edges: saved.edges };
    const filterSignature = getWorkflowUpstreamSignature(signatureInput, filterNode!.id);
    expect(preview.generatedAt).toBe(1_780_000_000_000);
    expect(preview.workflowSignature).toBe(filterSignature);

    // Output sinks carry a signature too — their preview is the staged result.
    const outputPreview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
      nodeId: outputNode!.id,
      nodeType: outputNode!.type,
      nodeConfig: outputNode!.config,
    });
    expect(outputPreview.workflowSignature).toBe(
      getWorkflowUpstreamSignature(signatureInput, outputNode!.id)
    );

    // Editing the upstream config changes the signature — the persisted cache
    // signature no longer matches, which is exactly what the stale badge needs.
    const mutatedSignature = getWorkflowUpstreamSignature(
      {
        nodes: saved.nodes.map((node) =>
          node.id === filterNode!.id
            ? { ...node, config: { ...node.config, condition: 'order_id > 1' } }
            : node
        ),
        edges: saved.edges,
      },
      outputNode!.id
    );
    expect(mutatedSignature).not.toBe(outputPreview.workflowSignature);
  });

  it('keeps temporary workflow node caches for one day then expires them', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'temporary-cache-orders.csv');
    fs.writeFileSync(ordersPath, 'order_id,revenue\n1,20\n2,5\n3,30\n', 'utf8');

    let now = 1_780_000_000_000;
    const store = createDataPipelineStore(dbPath, {
      now: () => now,
    });
    stores.push(store);

    const pipeline = await store.createPipeline({
      name: 'Temporary cache',
      sourcePath: ordersPath,
    });
    const parsed = parsePrepDsl(`
      input source pipeline as orders

      from orders
        | filter [revenue] > 10
        | output table "temporary_cache_output" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });
    const filterNode = saved.nodes.find((node) => node.type === 'filter');
    expect(filterNode).toBeTruthy();

    await store.runPipeline(pipeline.id, { outputMode: 'temporary' });
    const freshPreview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(freshPreview.totalRows).toBe(2);

    now += 86_400_001;
    const expiredPreview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
      nodeId: filterNode!.id,
      nodeType: filterNode!.type,
      nodeConfig: filterNode!.config,
    });
    expect(expiredPreview.totalRows).toBe(0);
    // Rows are gone, but the plan-inferred schema still describes the node.
    expect(expiredPreview.columns).toEqual(['order_id', 'revenue']);
  });

  it('previews input table data and columns before a pipeline run', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');
    const ordersPath = path.join(tempRoot, 'input-orders.csv');
    fs.writeFileSync(ordersPath, 'order_id,revenue\n1,20\n2,5\n', 'utf8');

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const rawTable = await store.importRawTable({ filePath: ordersPath });
    const pipeline = await store.createPipeline({ name: 'Input source columns' });
    const parsed = parsePrepDsl(`
      input source rawTable "${rawTable.id}" as orders

      from orders
        | filter [revenue] > 10
        | output table "input_source_columns_output" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });
    const inputNode = saved.nodes.find((node) => node.type === 'input_source');
    expect(inputNode).toBeTruthy();

    await expect(
      store.getWorkflowNodeColumns({
        pipelineId: pipeline.id,
        nodeId: inputNode!.id,
        nodeType: inputNode!.type,
        nodeConfig: inputNode!.config,
      })
    ).resolves.toEqual(['order_id', 'revenue']);

    const preview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
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

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const pipeline = await store.createPipeline({
      name: 'Chinese field filter',
      sourcePath: ordersPath,
    });
    const parsed = parsePrepDsl(`
      input source pipeline as orders

      from orders
        | filter [订单ID]="A1000001"
        | output table "filtered_cn_orders" mode replace
    `);
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.rowCount).toBe(1);

    const filterNode = saved.nodes.find((node) => node.type === 'filter');
    expect(filterNode).toBeTruthy();
    const preview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
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

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const pipeline = await store.createPipeline({
      name: 'Regex filter conditions',
      sourcePath: citiesPath,
    });
    const parsed = parsePrepDsl(`
      input source pipeline as cities

      from cities
        | filter ([City] matches ".*en$" or [City] begin "Al") and [Category] not matches "Office.*"
        | output table "filtered_cities_regex" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.rowCount).toBe(3);

    const filterNode = saved.nodes.find((node) => node.type === 'filter');
    expect(filterNode).toBeTruthy();
    const preview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
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

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const pipeline = await store.createPipeline({
      name: 'Like filter conditions',
      sourcePath: citiesPath,
    });
    const parsed = parsePrepDsl(`
      input source pipeline as cities

      from cities
        | filter [City] like "%ach%" and [Category] not like "Office%" and [City] end "en"
        | output table "filtered_cities_like" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    const saved = await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.rowCount).toBe(1);

    const filterNode = saved.nodes.find((node) => node.type === 'filter');
    expect(filterNode).toBeTruthy();
    const preview = await store.previewWorkflowNode({
      pipelineId: pipeline.id,
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

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const pipeline = await store.createPipeline({
      name: 'Unordered graph',
      sourcePath: ordersPath,
    });
    const parsed = parsePrepDsl(`
      input source pipeline as orders

      from orders
        | cast [revenue] as float on_error null
        | filter [revenue] > 10
        | output table "unordered_output" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    await store.savePipelineWorkflow(pipeline.id, {
      nodes: [...compiled.nodes].reverse(),
      edges: compiled.edges,
    });

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.resultTable).toBe('unordered_output');
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

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    await store.importRawTable({ filePath: statusPath, name: 'status' });
    const pipeline = await store.createPipeline({ name: 'Asof events', sourcePath: eventsPath });
    const parsed = parsePrepDsl(`
      input source pipeline as events
      input source rawTable "status" as status

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
    await store.savePipelineWorkflow(pipeline.id, {
      nodes: compiled.nodes,
      edges: compiled.edges,
    });

    const completed = await store.runPipeline(pipeline.id);
    expect(completed.status).toBe('completed');
    expect(completed.resultTable).toBe('events_with_status');
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

    const initialStore = createDataPipelineStore(dbPath);
    stores.push(initialStore);
    await initialStore.getDashboard();
    stores.pop()?.close();

    const instance = await DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    try {
      await connection.run(`
        INSERT INTO data_pipelines (
          id, name, status, node_count, source_path, source_raw_table_id, result_table,
          row_count, column_count, error, scheduled_for, created_at, updated_at, last_run_at
        )
        VALUES (
          'legacy-default-pipeline', 'Old default workflow', 'draft', 7, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, 1, 1, NULL
        )
      `);
      await connection.run(`
        INSERT INTO data_workflow_nodes (
          id, pipeline_id, node_key, label, ordinal, operator_type, x, y,
          config_json, created_at, updated_at
        )
        VALUES
          ('legacy-node-1', 'legacy-default-pipeline', 'source', '数据源', 1, 'input_source', 48, 128, '{}', 1, 1),
          ('legacy-node-2', 'legacy-default-pipeline', 'filter', '筛选', 2, 'filter', 190, 128, '{}', 1, 1),
          ('legacy-node-3', 'legacy-default-pipeline', 'deduplicate', '去重', 3, 'deduplicate', 332, 128, '{}', 1, 1),
          ('legacy-node-4', 'legacy-default-pipeline', 'missing', '缺失值处理', 4, 'missing_value', 474, 128, '{}', 1, 1),
          ('legacy-node-5', 'legacy-default-pipeline', 'calculate', '计算字段', 5, 'calculate_field', 190, 270, '{}', 1, 1),
          ('legacy-node-6', 'legacy-default-pipeline', 'mapping', '字段映射', 6, 'field_mapping', 474, 270, '{}', 1, 1),
          ('legacy-node-7', 'legacy-default-pipeline', 'output', '输出', 7, 'output', 474, 412, '{}', 1, 1)
      `);
      // Simulate a pre-ledger database so the next open re-runs migrations.
      await connection.run('DROP TABLE data_schema_migrations');
    } finally {
      connection.closeSync();
      instance.closeSync();
    }

    const store = createDataPipelineStore(dbPath);
    stores.push(store);
    const workflow = await store.getPipelineWorkflow('legacy-default-pipeline');
    expect(workflow.nodes).toHaveLength(0);
    expect(workflow.edges).toHaveLength(0);
    expect(workflow.pipeline.nodeCount).toBe(0);
  });

  it('persists pipelines across store restarts and records failed runs', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');

    const store = createDataPipelineStore(dbPath, {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const pipeline = await store.createPipeline({ name: 'No source pipeline' });
    expect(pipeline.status).toBe('draft');
    await expect(store.runPipeline(pipeline.id)).rejects.toThrow(/Data source file is required/);

    const failedDashboard = await store.getDashboard();
    expect(failedDashboard.summary.pipelineCount).toBe(1);
    expect(failedDashboard.summary.statusCounts.failed).toBe(1);
    expect(failedDashboard.pipelines[0]?.status).toBe('failed');

    stores.pop()?.close();

    const reopenedStore = createDataPipelineStore(dbPath);
    stores.push(reopenedStore);
    const reopenedDashboard = await reopenedStore.getDashboard();
    expect(reopenedDashboard.summary.pipelineCount).toBe(1);
    expect(reopenedDashboard.summary.statusCounts.failed).toBe(1);
    expect(reopenedDashboard.pipelines[0]?.name).toBe('No source pipeline');
  });

  it('removes legacy seeded demo rows while keeping real pipelines', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');

    const initialStore = createDataPipelineStore(dbPath);
    stores.push(initialStore);
    await initialStore.getDashboard();
    stores.pop()?.close();

    const instance = await DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    try {
      await connection.run(`
        INSERT INTO data_pipelines (
          id, name, status, node_count, source_path, source_raw_table_id, result_table,
          row_count, column_count, error, scheduled_for, created_at, updated_at, last_run_at
        )
        VALUES
          ('legacy-demo', '用户行为数据清洗', 'running', 6, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1, NULL),
          ('real-pipeline', '用户行为数据清洗', 'draft', 4, '/tmp/real.csv', NULL, NULL, NULL, NULL, NULL, NULL, 2, 2, NULL)
      `);
      await connection.run(`
        INSERT INTO data_workflow_nodes (id, pipeline_id, node_key, label, ordinal, created_at)
        VALUES ('legacy-node', 'legacy-demo', 'load_source', 'load_source', 1, 1)
      `);
      await connection.run(`
        INSERT INTO data_raw_tables (
          id, name, source_path, table_name, row_count, column_count, created_at, updated_at
        )
        VALUES ('legacy-rawTable', '用户行为明细', 'local://samples/user_events.csv', 'demo_rawTable_1', 10, 2, 1, 1)
      `);
      // Simulate a pre-ledger database so the next open re-runs migrations.
      await connection.run('DROP TABLE data_schema_migrations');
    } finally {
      connection.closeSync();
      instance.closeSync();
    }

    const store = createDataPipelineStore(dbPath);
    stores.push(store);
    const dashboard = await store.getDashboard();
    expect(dashboard.summary.pipelineCount).toBe(1);
    expect(dashboard.pipelines).toHaveLength(1);
    expect(dashboard.pipelines[0]?.id).toBe('real-pipeline');
    expect(dashboard.rawTables).toHaveLength(0);
  });

  it('keeps the DuckDB backend wired into IPC and packaging config', () => {
    const root = process.cwd();
    const dataIpc = ['data-pipelines-ipc.ts', 'raw-tables-ipc.ts', 'result-tables-ipc.ts']
      .map((file) => fs.readFileSync(path.join(root, 'src/main/data/ipc', file), 'utf8'))
      .join('\n');
    const preload = fs.readFileSync(path.join(root, 'src/preload/api/data.ts'), 'utf8');
    const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    const builder = fs.readFileSync(path.join(root, 'electron-builder.config.cjs'), 'utf8');

    expect(dataIpc).toContain("handleIpc('data.getDashboard'");
    expect(dataIpc).toContain("handleIpc('data.runPipeline'");
    expect(dataIpc).toContain("handleIpc('data.updatePipeline'");
    expect(dataIpc).toContain("handleIpc('data.getPipelineWorkflow'");
    expect(dataIpc).toMatch(/handleIpc\(\s*['"]data\.savePipelineWorkflow['"]/);
    expect(dataIpc).toContain("handleIpc('data.importRawTable'");
    expect(dataIpc).toContain("handleIpc('data.updateRawTable'");
    expect(dataIpc).toContain("handleIpc('data.createResultTable'");
    expect(dataIpc).toContain("handleIpc('data.updateResultTable'");
    expect(dataIpc).toContain("handleIpc('data.previewRawTable'");
    expect(dataIpc).toContain("'data.getWorkflowNodeColumnTypes'");
    expect(dataIpc).toContain("handleIpc('data.deletePipeline'");
    expect(dataIpc).toContain("handleIpc('data.deleteRawTable'");
    expect(fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8')).toContain(
      'data: createDataApi()'
    );
    expect(preload).toContain("ipcRenderer.invoke('data.updatePipeline'");
    expect(preload).toContain("ipcRenderer.invoke('data.importRawTable'");
    expect(preload).toContain("ipcRenderer.invoke('data.updateRawTable'");
    expect(preload).toContain("ipcRenderer.invoke('data.createResultTable'");
    expect(preload).toContain("ipcRenderer.invoke('data.updateResultTable'");
    expect(preload).toContain("ipcRenderer.invoke('data.previewRawTable'");
    expect(preload).toContain("ipcRenderer.invoke('data.deleteRawTable'");
    expect(preload).toContain("ipcRenderer.invoke('data.getPipelineWorkflow'");
    expect(preload).toContain("ipcRenderer.invoke('data.savePipelineWorkflow'");
    expect(preload).toContain("ipcRenderer.invoke('data.deletePipeline'");
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

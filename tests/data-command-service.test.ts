import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataCommandService } from '../src/main/data/data-command-service';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';

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

describe('DataCommandService', () => {
  it('creates input/output/task resources, saves workflow DSL, and runs the task', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob\n', 'utf8');

    const input = await service.createInputTable({
      name: 'customers',
      sourceKind: 'csv',
      filePath: csvPath,
      previewRows: 2,
    });
    expect(input.inputTable.name).toBe('customers');
    expect(input.preview?.totalRows).toBe(2);

    const output = await service.createOutputTable({
      name: 'customers output',
      sourceInputTableId: input.inputTable.id,
    });
    expect(output.outputTable.name).toBe('customers output');
    expect(output.outputTable.rowCount).toBe(2);

    const task = await service.createTask({
      name: 'Copy customers',
      sourceInputTableId: input.inputTable.id,
      outputTableId: output.outputTable.id,
    });
    expect(task.task.sourceDatasetId).toBe(input.inputTable.id);
    expect(task.task.outputTable).toBe(output.outputTable.tableName);

    const listedInputTablesBeforeRun = await service.listInputTables({});
    const listedOutputTablesBeforeRun = await service.listOutputTables({});
    expect(listedInputTablesBeforeRun.inputTables[0]?.relatedTaskNames).toContain(
      'Copy customers'
    );
    expect(listedOutputTablesBeforeRun.outputTables[0]?.relatedTaskNames).toContain(
      'Copy customers'
    );

    const dsl = `
      input source dataset "${input.inputTable.id}" as customers

      from customers
        | output table "customers_copy" mode replace
    `;
    const dryRun = await service.applyWorkflowDsl({
      taskId: task.task.id,
      dsl,
      outputTableId: output.outputTable.id,
      dryRun: true,
    });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.workflow.nodes.map((node) => node.type)).toEqual(['input_source', 'output']);
    expect(dryRun.workflow.nodes.find((node) => node.type === 'output')?.config.outputDatasetId).toBe(
      output.outputTable.id
    );

    const saved = await service.applyWorkflowDsl({
      taskId: task.task.id,
      outputTableId: output.outputTable.id,
      dsl,
    });
    const outputNode = saved.workflow.nodes.find((node) => node.type === 'output');
    expect(outputNode?.config.outputDatasetId).toBe(output.outputTable.id);

    const temporaryRun = await service.runTask({
      taskId: task.task.id,
      mode: 'temporary',
      previewRows: 2,
    });
    expect(temporaryRun.task.status).toBe('completed');
    expect(temporaryRun.task.outputTable).toMatch(/^temp_task_/);
    expect(temporaryRun.preview?.totalRows).toBe(2);

    const persistedRun = await service.runTask({
      taskId: task.task.id,
      mode: 'persisted',
      previewRows: 2,
    });
    expect(persistedRun.task.status).toBe('completed');
    expect(persistedRun.task.sourceDatasetId).toBe(input.inputTable.id);
    expect(persistedRun.preview?.totalRows).toBe(2);

    const exported = await service.exportWorkflowDsl({ taskId: task.task.id });
    expect(exported.text).toContain(`input source dataset "${input.inputTable.id}" as customers`);

    const outputPreview = await service.previewTable({
      tableKind: 'output',
      id: output.outputTable.id,
      limit: 2,
    });
    expect(outputPreview.preview.totalRows).toBe(2);
    expect(outputPreview.preview.columns).toEqual(['id', 'name']);
  });

  it('rejects JSON workflow payloads with a clear DSL format diagnostic', async () => {
    const { service } = createService();
    const task = await service.createTask({ name: 'Bad DSL task' });

    const result = await service.applyWorkflowDsl({
      taskId: task.task.id,
      dryRun: true,
      dsl: '{"nodes":[],"edges":[]}',
    });

    expect(result.diagnostics?.[0]).toMatchObject({
      severity: 'error',
      code: 'invalidDslFormat',
    });
    expect(result.diagnostics?.[0]?.message).toContain('not JSON');
  });

  it('reports duplicate names with stable command errors', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');
    await service.createInputTable({ name: 'customers', filePath: csvPath });

    await expect(service.createInputTable({ name: 'customers', filePath: csvPath })).rejects.toThrow(
      '[RESOURCE_ALREADY_EXISTS]'
    );
  });
});

function createService(): { service: DataCommandService; tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-data-command-'));
  tempRoots.push(tempRoot);
  const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
    now: () => 1_780_000_000_000,
  });
  stores.push(store);
  return { service: new DataCommandService(store), tempRoot };
}

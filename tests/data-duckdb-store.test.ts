import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
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

describe('DuckDB data task store', () => {
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
    expect(dashboard.datasets.length).toBeGreaterThanOrEqual(2);

    expect(await store.deleteTask(completed.id)).toBe(true);
    const afterDelete = await store.getDashboard({ query: 'Clean events' });
    expect(afterDelete.summary.taskCount).toBe(0);
    expect(afterDelete.summary.statusCounts.completed).toBe(0);
    expect(afterDelete.tasks).toHaveLength(0);
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
          config: { strategy: 'by_column' },
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
    expect(reopened.nodes.map((node) => node.id)).toEqual(['node_source', 'node_missing']);
    expect(reopened.edges[0]?.sourceNodeId).toBe('node_source');
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
    const main = fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8');
    const preload = fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8');
    const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    const builder = fs.readFileSync(path.join(root, 'electron-builder.config.cjs'), 'utf8');

    expect(main).toContain("ipcMain.handle('data.getDashboard'");
    expect(main).toContain("ipcMain.handle('data.runTask'");
    expect(main).toContain("ipcMain.handle('data.getTaskWorkflow'");
    expect(main).toContain("ipcMain.handle('data.saveTaskWorkflow'");
    expect(main).toContain("ipcMain.handle('data.deleteTask'");
    expect(preload).toContain('data: {');
    expect(preload).toContain("ipcRenderer.invoke('data.importDataset'");
    expect(preload).toContain("ipcRenderer.invoke('data.getTaskWorkflow'");
    expect(preload).toContain("ipcRenderer.invoke('data.saveTaskWorkflow'");
    expect(preload).toContain("ipcRenderer.invoke('data.deleteTask'");
    expect(vite).toContain("'@duckdb/node-api'");
    expect(builder).toContain("'node_modules/@duckdb/**/*'");
    expect(builder).toContain("'node_modules/@duckdb/**/*.node'");
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
  it('imports datasets and runs a local data cleaning task', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const csvPath = path.join(tempRoot, 'events.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n1,Alice\n2,Bob\n,\n', 'utf8');

    const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
      seedDemoData: false,
      now: () => 1_780_000_000_000,
    });
    stores.push(store);

    const imported = await store.importDataset({ filePath: csvPath });
    expect(imported.name).toBe('events');
    expect(imported.columnCount).toBe(2);
    expect(imported.rowCount).toBeGreaterThan(0);

    const task = await store.createTask({ name: 'Clean events', sourcePath: csvPath });
    expect(task.status).toBe('pending');

    const completed = await store.runTask(task.id);
    expect(completed.status).toBe('completed');
    expect(completed.columnCount).toBe(2);
    expect(completed.rowCount).toBe(2);
    expect(completed.outputTable).toMatch(/^clean_task_/);

    const dashboard = await store.getDashboard({ query: 'events' });
    expect(dashboard.summary.taskCount).toBe(1);
    expect(dashboard.summary.workflowNodeCount).toBe(6);
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

  it('persists tasks across store restarts and records failed runs', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-duckdb-'));
    tempRoots.push(tempRoot);
    const dbPath = path.join(tempRoot, 'workspace.duckdb');

    const store = createDataTaskStore(dbPath, {
      seedDemoData: false,
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

    const reopenedStore = createDataTaskStore(dbPath, { seedDemoData: false });
    stores.push(reopenedStore);
    const reopenedDashboard = await reopenedStore.getDashboard();
    expect(reopenedDashboard.summary.taskCount).toBe(1);
    expect(reopenedDashboard.summary.statusCounts.failed).toBe(1);
    expect(reopenedDashboard.tasks[0]?.name).toBe('No source task');
  });

  it('keeps the DuckDB backend wired into IPC and packaging config', () => {
    const root = process.cwd();
    const main = fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8');
    const preload = fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8');
    const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    const builder = fs.readFileSync(path.join(root, 'electron-builder.config.cjs'), 'utf8');

    expect(main).toContain("ipcMain.handle('data.getDashboard'");
    expect(main).toContain("ipcMain.handle('data.runTask'");
    expect(main).toContain("ipcMain.handle('data.deleteTask'");
    expect(preload).toContain('data: {');
    expect(preload).toContain("ipcRenderer.invoke('data.importDataset'");
    expect(preload).toContain("ipcRenderer.invoke('data.deleteTask'");
    expect(vite).toContain("'@duckdb/node-api'");
    expect(builder).toContain("'node_modules/@duckdb/**/*'");
    expect(builder).toContain("'node_modules/@duckdb/**/*.node'");
  });
});

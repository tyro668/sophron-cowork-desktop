// @vitest-environment happy-dom
/**
 * New-task creation flow: unique naming, "create task from this table"
 * seeding a bound input_source node, and opening the editor in rename mode.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import type { DataCleaningTask, DataDashboard, DataDataset } from '../../src/renderer/types';
import {
  useDataActions,
  type DataActionsDeps,
} from '../../src/renderer/features/data/hooks/use-data-actions';
import type { DataViewUi } from '../../src/renderer/features/data/hooks/use-data-view-ui';
import type { DataDashboardState } from '../../src/renderer/features/data/hooks/use-data-dashboard';
import type { InputTablesState } from '../../src/renderer/features/data/hooks/use-input-tables';
import type { InputTableDraftsState } from '../../src/renderer/features/data/hooks/use-input-table-drafts';
import type { DataViewEditors } from '../../src/renderer/features/data/hooks/use-data-view-editors';
import { uniqueTaskName } from '../../src/renderer/features/data/model/task-names';

const EMPTY: DataDashboard = {
  summary: {
    taskCount: 0,
    workflowNodeCount: 0,
    runningCount: 0,
    todayScheduleCount: 0,
    statusCounts: { running: 0, completed: 0, stopped: 0, draft: 0, pending: 0, failed: 0 },
  },
  tasks: [],
  datasets: [],
  outputTables: [],
  groups: [],
  totalTasks: 0,
  totalDatasets: 0,
  totalOutputTables: 0,
  taskGroupCounts: {},
  datasetGroupCounts: {},
  outputGroupCounts: {},
};

function makeTask(id: string, name = id): DataCleaningTask {
  return {
    id,
    name,
    description: '',
    status: 'draft',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 0,
    groupId: null,
  } as unknown as DataCleaningTask;
}

function makeDataset(id: string, name: string): DataDataset {
  return {
    id,
    name,
    sourceKind: 'excel',
    sourcePath: `/data/${id}.xlsx`,
    rowCount: 10,
    columnCount: 3,
  } as unknown as DataDataset;
}

function setDataBridge(data: Partial<Record<string, unknown>>) {
  (window as { electronAPI?: unknown }).electronAPI = { data };
}

function renderActions(overrides?: Partial<DataActionsDeps>) {
  const ui = {
    setActionId: vi.fn(),
    setError: vi.fn(),
    setActiveTab: vi.fn(),
    setSearchQuery: vi.fn(),
    searchQuery: '',
    inputTableSourceFilter: 'all',
  } as unknown as DataViewUi;
  const dashboard = {
    dashboard: EMPTY,
    setTaskPage: vi.fn(),
    loadDashboard: vi.fn(async () => undefined),
  } as unknown as DataDashboardState;
  const inputTables = {
    loadInputTables: vi.fn(async () => undefined),
  } as unknown as InputTablesState;
  const drafts = {} as unknown as InputTableDraftsState;
  const editors = {
    setFocusedTask: vi.fn(),
    setEditingTaskId: vi.fn(),
    setTaskNameEditRequested: vi.fn(),
  } as unknown as DataViewEditors;
  const deps: DataActionsDeps = {
    ui,
    dashboard,
    inputTables,
    drafts,
    editors,
    t: i18n.t.bind(i18n) as DataActionsDeps['t'],
    confirmDelete: vi.fn(async () => true),
    ...overrides,
  };
  const hook = renderHook(() => useDataActions(deps));
  return { hook, deps: { ui, dashboard, inputTables, drafts, editors } };
}

describe('uniqueTaskName', () => {
  it('numbers from 1 for the default series', () => {
    expect(uniqueTaskName('Task', [], { alwaysNumber: true })).toBe('Task 1');
    expect(uniqueTaskName('Task', ['Task 1', 'Task 2'], { alwaysNumber: true })).toBe('Task 3');
  });

  it('fills the first gap instead of counting existing tasks', () => {
    // The old `taskCount + 1` scheme produced "Task 5" twice when the series
    // diverged from the count — the first free suffix must be used.
    const names = ['Task 1', 'Task 5', 'Other'];
    expect(uniqueTaskName('Task', names, { alwaysNumber: true })).toBe('Task 2');
  });

  it('uses the bare base name for derived names, numbering on collision', () => {
    expect(uniqueTaskName('Orders task', [])).toBe('Orders task');
    expect(uniqueTaskName('Orders task', ['Orders task'])).toBe('Orders task 2');
    expect(uniqueTaskName('Orders task', ['Orders task', 'Orders task 2'])).toBe('Orders task 3');
  });
});

describe('useDataActions task creation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a uniquely-named task and opens the editor in rename mode', async () => {
    const created = makeTask('task_new', 'New data cleaning task 2');
    const getDashboard = vi.fn(async () => ({
      ...EMPTY,
      tasks: [
        makeTask('t1', 'New data cleaning task 1'),
        makeTask('t5', 'New data cleaning task 5'),
      ],
      totalTasks: 2,
    }));
    const createTask = vi.fn(async (input: { name: string }) => ({
      ...created,
      name: input.name,
    }));
    setDataBridge({ getDashboard, createTask });

    const { hook, deps } = renderActions();
    await act(async () => {
      await hook.result.current.handleCreateTask();
    });

    expect(createTask).toHaveBeenCalledWith({
      name: 'New data cleaning task 2',
      sourceDatasetId: null,
    });
    expect(deps.editors.setFocusedTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task_new' })
    );
    expect(deps.editors.setEditingTaskId).toHaveBeenCalledWith('task_new');
    expect(deps.editors.setTaskNameEditRequested).toHaveBeenCalledWith(true);
    expect(deps.ui.setActiveTab).toHaveBeenCalledWith('tasks');
    expect(deps.dashboard.loadDashboard).toHaveBeenCalled();
  });

  it('creates a task bound to the input table and seeds the starter graph', async () => {
    const dataset = makeDataset('ds_orders', 'Orders');
    const created = makeTask('task_seed', 'Orders cleaning task');
    const getDashboard = vi.fn(async () => ({ ...EMPTY }));
    const createTask = vi.fn(async () => created);
    const saveTaskWorkflow = vi.fn(async () => ({
      task: { ...created, nodeCount: 3 },
      nodes: [],
      edges: [],
    }));
    setDataBridge({ getDashboard, createTask, saveTaskWorkflow });

    const { hook, deps } = renderActions();
    await act(async () => {
      await hook.result.current.handleCreateTaskFromTable(dataset);
    });

    expect(createTask).toHaveBeenCalledWith({
      name: 'Orders cleaning task',
      sourceDatasetId: 'ds_orders',
    });
    expect(saveTaskWorkflow).toHaveBeenCalledWith(
      'task_seed',
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            type: 'input_source',
            config: expect.objectContaining({
              source: 'dataset',
              datasetId: 'ds_orders',
            }),
          }),
          expect.objectContaining({ type: 'sql_query' }),
          expect.objectContaining({
            type: 'output',
            // The seeded output stays unnamed so no output table is
            // materialized before the user confirms the workflow.
            config: expect.not.objectContaining({ outputTableName: expect.anything() }),
          }),
        ]),
        edges: [expect.objectContaining({}), expect.objectContaining({})],
      })
    );
    // The focused task reflects the seeded workflow save (nodeCount = 3).
    expect(deps.editors.setFocusedTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task_seed', nodeCount: 3 })
    );
    expect(deps.editors.setEditingTaskId).toHaveBeenCalledWith('task_seed');
    expect(deps.editors.setTaskNameEditRequested).toHaveBeenCalledWith(true);
  });

  it('still opens the editor when seeding the input node fails', async () => {
    const dataset = makeDataset('ds_fail', 'Broken');
    const created = makeTask('task_partial', 'Broken cleaning task');
    const getDashboard = vi.fn(async () => ({ ...EMPTY }));
    const createTask = vi.fn(async () => created);
    const saveTaskWorkflow = vi.fn(async () => {
      throw new Error('seed failed');
    });
    setDataBridge({ getDashboard, createTask, saveTaskWorkflow });

    const { hook, deps } = renderActions();
    await act(async () => {
      await hook.result.current.handleCreateTaskFromTable(dataset);
    });

    expect(deps.editors.setEditingTaskId).toHaveBeenCalledWith('task_partial');
    expect(deps.ui.setError).toHaveBeenCalledWith('seed failed');
  });
});

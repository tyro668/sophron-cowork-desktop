// @vitest-environment happy-dom
/**
 * New-pipeline creation flow: unique naming, "create pipeline from this table"
 * seeding a bound input_source node, and opening the editor in rename mode.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import type { DataPipeline, DataDashboard, DataRawTable } from '../../src/renderer/types';
import {
  useDataActions,
  type DataActionsDeps,
} from '../../src/renderer/features/data/hooks/use-data-actions';
import type { DataViewUi } from '../../src/renderer/features/data/hooks/use-data-view-ui';
import type { DataDashboardState } from '../../src/renderer/features/data/hooks/use-data-dashboard';
import type { RawTablesState } from '../../src/renderer/features/data/hooks/use-raw-tables';
import type { RawTableDraftsState } from '../../src/renderer/features/data/hooks/use-raw-table-drafts';
import type { DataViewEditors } from '../../src/renderer/features/data/hooks/use-data-view-editors';
import { uniquePipelineName } from '../../src/renderer/features/data/model/pipeline-names';

const EMPTY: DataDashboard = {
  summary: {
    pipelineCount: 0,
    workflowNodeCount: 0,
    runningCount: 0,
    todayScheduleCount: 0,
    statusCounts: { running: 0, completed: 0, stopped: 0, draft: 0, pending: 0, failed: 0 },
  },
  pipelines: [],
  rawTables: [],
  resultTables: [],
  groups: [],
  totalPipelines: 0,
  totalRawTables: 0,
  totalResultTables: 0,
  pipelineGroupCounts: {},
  rawTableGroupCounts: {},
  outputGroupCounts: {},
};

function makePipeline(id: string, name = id): DataPipeline {
  return {
    id,
    name,
    description: '',
    status: 'draft',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 0,
    groupId: null,
  } as unknown as DataPipeline;
}

function makeRawTable(id: string, name: string): DataRawTable {
  return {
    id,
    name,
    sourceKind: 'excel',
    sourcePath: `/data/${id}.xlsx`,
    rowCount: 10,
    columnCount: 3,
  } as unknown as DataRawTable;
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
    rawTableSourceFilter: 'all',
  } as unknown as DataViewUi;
  const dashboard = {
    dashboard: EMPTY,
    setPipelinePage: vi.fn(),
    loadDashboard: vi.fn(async () => undefined),
  } as unknown as DataDashboardState;
  const rawTables = {
    loadRawTables: vi.fn(async () => undefined),
  } as unknown as RawTablesState;
  const drafts = {} as unknown as RawTableDraftsState;
  const editors = {
    setFocusedPipeline: vi.fn(),
    setEditingPipelineId: vi.fn(),
    setPipelineNameEditRequested: vi.fn(),
  } as unknown as DataViewEditors;
  const deps: DataActionsDeps = {
    ui,
    dashboard,
    rawTables,
    drafts,
    editors,
    t: i18n.t.bind(i18n) as DataActionsDeps['t'],
    confirmDelete: vi.fn(async () => true),
    ...overrides,
  };
  const hook = renderHook(() => useDataActions(deps));
  return { hook, deps: { ui, dashboard, rawTables, drafts, editors } };
}

describe('uniquePipelineName', () => {
  it('numbers from 1 for the default series', () => {
    expect(uniquePipelineName('Pipeline', [], { alwaysNumber: true })).toBe('Pipeline 1');
    expect(
      uniquePipelineName('Pipeline', ['Pipeline 1', 'Pipeline 2'], { alwaysNumber: true })
    ).toBe('Pipeline 3');
  });

  it('fills the first gap instead of counting existing pipelines', () => {
    // The old `pipelineCount + 1` scheme produced "Pipeline 5" twice when the series
    // diverged from the count — the first free suffix must be used.
    const names = ['Pipeline 1', 'Pipeline 5', 'Other'];
    expect(uniquePipelineName('Pipeline', names, { alwaysNumber: true })).toBe('Pipeline 2');
  });

  it('uses the bare base name for derived names, numbering on collision', () => {
    expect(uniquePipelineName('Orders pipeline', [])).toBe('Orders pipeline');
    expect(uniquePipelineName('Orders pipeline', ['Orders pipeline'])).toBe('Orders pipeline 2');
    expect(uniquePipelineName('Orders pipeline', ['Orders pipeline', 'Orders pipeline 2'])).toBe(
      'Orders pipeline 3'
    );
  });
});

describe('useDataActions pipeline creation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a uniquely-named pipeline and opens the editor in rename mode', async () => {
    const created = makePipeline('task_new', 'New data pipeline 2');
    const getDashboard = vi.fn(async () => ({
      ...EMPTY,
      pipelines: [
        makePipeline('t1', 'New data pipeline 1'),
        makePipeline('t5', 'New data pipeline 5'),
      ],
      totalPipelines: 2,
    }));
    const createPipeline = vi.fn(async (input: { name: string }) => ({
      ...created,
      name: input.name,
    }));
    setDataBridge({ getDashboard, createPipeline });

    const { hook, deps } = renderActions();
    await act(async () => {
      await hook.result.current.handleCreatePipeline();
    });

    expect(createPipeline).toHaveBeenCalledWith({
      name: 'New data pipeline 2',
      sourceRawTableId: null,
    });
    expect(deps.editors.setFocusedPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task_new' })
    );
    expect(deps.editors.setEditingPipelineId).toHaveBeenCalledWith('task_new');
    expect(deps.editors.setPipelineNameEditRequested).toHaveBeenCalledWith(true);
    expect(deps.ui.setActiveTab).toHaveBeenCalledWith('pipelines');
    expect(deps.dashboard.loadDashboard).toHaveBeenCalled();
  });

  it('creates a pipeline bound to the input table and seeds the starter graph', async () => {
    const rawTable = makeRawTable('ds_orders', 'Orders');
    const created = makePipeline('task_seed', 'Orders pipeline');
    const getDashboard = vi.fn(async () => ({ ...EMPTY }));
    const createPipeline = vi.fn(async () => created);
    const savePipelineWorkflow = vi.fn(async () => ({
      pipeline: { ...created, nodeCount: 3 },
      nodes: [],
      edges: [],
    }));
    setDataBridge({ getDashboard, createPipeline, savePipelineWorkflow });

    const { hook, deps } = renderActions();
    await act(async () => {
      await hook.result.current.handleCreatePipelineFromTable(rawTable);
    });

    expect(createPipeline).toHaveBeenCalledWith({
      name: 'Orders pipeline',
      sourceRawTableId: 'ds_orders',
    });
    expect(savePipelineWorkflow).toHaveBeenCalledWith(
      'task_seed',
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            type: 'input_source',
            config: expect.objectContaining({
              source: 'rawTable',
              rawTableId: 'ds_orders',
            }),
          }),
          expect.objectContaining({ type: 'sql_query' }),
          expect.objectContaining({
            type: 'output',
            // The seeded output stays unnamed so no output table is
            // materialized before the user confirms the workflow.
            config: expect.not.objectContaining({ resultTableName: expect.anything() }),
          }),
        ]),
        edges: [expect.objectContaining({}), expect.objectContaining({})],
      })
    );
    // The focused pipeline reflects the seeded workflow save (nodeCount = 3).
    expect(deps.editors.setFocusedPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task_seed', nodeCount: 3 })
    );
    expect(deps.editors.setEditingPipelineId).toHaveBeenCalledWith('task_seed');
    expect(deps.editors.setPipelineNameEditRequested).toHaveBeenCalledWith(true);
  });

  it('still opens the editor when seeding the input node fails', async () => {
    const rawTable = makeRawTable('ds_fail', 'Broken');
    const created = makePipeline('task_partial', 'Broken pipeline');
    const getDashboard = vi.fn(async () => ({ ...EMPTY }));
    const createPipeline = vi.fn(async () => created);
    const savePipelineWorkflow = vi.fn(async () => {
      throw new Error('seed failed');
    });
    setDataBridge({ getDashboard, createPipeline, savePipelineWorkflow });

    const { hook, deps } = renderActions();
    await act(async () => {
      await hook.result.current.handleCreatePipelineFromTable(rawTable);
    });

    expect(deps.editors.setEditingPipelineId).toHaveBeenCalledWith('task_partial');
    expect(deps.ui.setError).toHaveBeenCalledWith('seed failed');
  });
});

// @vitest-environment happy-dom
/**
 * Behavior tests for the data feature's hook slices: UI state, drafts, the
 * dashboard server-state hook (request sequencing + loading flags), and
 * deep-link navigation — exercised through renderHook, not source strings.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import type { DataCleaningTask, DataDashboard } from '../../src/renderer/types';
import { useAppStore } from '../../src/renderer/store';
import { useDataViewUi } from '../../src/renderer/features/data/hooks/use-data-view-ui';
import { useInputTableDrafts } from '../../src/renderer/features/data/hooks/use-input-table-drafts';
import { useDataDashboard } from '../../src/renderer/features/data/hooks/use-data-dashboard';
import { useDataNavigation } from '../../src/renderer/features/data/hooks/use-data-navigation';
import type { DataViewUi } from '../../src/renderer/features/data/hooks/use-data-view-ui';
import type { DataDashboardState } from '../../src/renderer/features/data/hooks/use-data-dashboard';
import type { InputTablesState } from '../../src/renderer/features/data/hooks/use-input-tables';
import type { DataViewEditors } from '../../src/renderer/features/data/hooks/use-data-view-editors';
import type { StoredPreviewState } from '../../src/renderer/features/data/hooks/use-stored-preview';

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
  } as unknown as DataCleaningTask;
}

function setDataBridge(data: Partial<Record<string, unknown>>) {
  (window as { electronAPI?: unknown }).electronAPI = { data };
}

describe('useDataViewUi', () => {
  it('tracks tab, search, and error UI state', () => {
    const { result } = renderHook(() => useDataViewUi());

    expect(result.current.activeTab).toBe('tasks');
    act(() => result.current.setActiveTab('input_tables'));
    act(() => result.current.setSearchQuery('cust'));
    act(() => result.current.setError('boom'));

    expect(result.current.activeTab).toBe('input_tables');
    expect(result.current.searchQuery).toBe('cust');
    expect(result.current.error).toBe('boom');
  });
});

describe('useInputTableDrafts', () => {
  it('creates, renames, and removes local drafts', () => {
    const { result } = renderHook(() => useInputTableDrafts());

    let draftId = '';
    act(() => {
      draftId = result.current.createDraft('customers').id;
    });
    expect(result.current.drafts).toHaveLength(1);
    expect(result.current.drafts[0].name).toBe('customers');

    act(() => result.current.renameDraft(draftId, 'renamed'));
    expect(result.current.drafts[0].name).toBe('renamed');

    act(() => result.current.removeDraft(draftId));
    expect(result.current.drafts).toHaveLength(0);
  });
});

describe('useDataDashboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function renderDashboard() {
    return renderHook(() =>
      useDataDashboard({
        activeTab: 'tasks',
        searchQuery: '',
        setError: vi.fn(),
        setLoadingTab: vi.fn(),
        setPendingNavigationTab: vi.fn(),
      })
    );
  }

  it('loads tasks through the dataClient bridge and stores them', async () => {
    const task = makeTask('task_1', 'Clean customers');
    const getDashboard = vi.fn(async () => ({
      ...EMPTY,
      tasks: [task],
      totalTasks: 1,
      summary: { ...EMPTY.summary, taskCount: 1 },
    }));
    setDataBridge({ getDashboard });

    const { result } = renderDashboard();
    await act(async () => {
      await result.current.loadDashboard();
    });

    expect(getDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ includeTasks: true, taskLimit: expect.any(Number) })
    );
    expect(result.current.dashboard.tasks).toEqual([task]);
    expect(result.current.dashboard.totalTasks).toBe(1);
  });

  it('drops a stale response when a newer request is in flight', async () => {
    const stale = makeTask('task_stale');
    const fresh = makeTask('task_fresh');
    const resolvers: Array<(value: DataDashboard) => void> = [];
    const getDashboard = vi.fn(
      () => new Promise<DataDashboard>((resolve) => resolvers.push(resolve))
    );
    setDataBridge({ getDashboard });

    const { result } = renderDashboard();
    await act(async () => {
      void result.current.loadDashboard();
      void result.current.loadDashboard();
    });
    // Newest request resolves first, then the stale one — stale must be dropped.
    await act(async () => {
      resolvers[1]({ ...EMPTY, tasks: [fresh], totalTasks: 1 });
      resolvers[0]({ ...EMPTY, tasks: [stale], totalTasks: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.dashboard.tasks).toEqual([fresh]);
  });
});

describe('useDataNavigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      pendingDataNavigation: null,
      pendingDataTabNavigation: null,
    });
  });

  function renderNavigation() {
    const ui = {
      setError: vi.fn(),
      setActiveTab: vi.fn(),
      setPendingNavigationTab: vi.fn(),
      setLoadingTab: vi.fn(),
      setSearchQuery: vi.fn(),
    } as unknown as DataViewUi;
    const dashboard = {
      prependTask: vi.fn(),
      setTaskPage: vi.fn(),
      prependOutputTable: vi.fn(),
      setOutputPage: vi.fn(),
    } as unknown as DataDashboardState;
    const inputTables = {
      setInputTablesLoading: vi.fn(),
      upsertDataset: vi.fn(),
      setTotalInputTableDatasets: vi.fn(),
      setDatasetPage: vi.fn(),
    } as unknown as InputTablesState;
    const editors = {
      resetWorkspace: vi.fn(),
      setFocusedTask: vi.fn(),
      setFocusedInputTable: vi.fn(),
      setFocusedOutputTable: vi.fn(),
      setEditingTaskId: vi.fn(),
      setEditingInputTableDatasetId: vi.fn(),
      setEditingOutputTableId: vi.fn(),
    } as unknown as DataViewEditors;
    const preview = { close: vi.fn() } as unknown as StoredPreviewState;

    renderHook(() =>
      useDataNavigation({
        ui,
        dashboard,
        inputTables,
        editors,
        preview,
        isDataApiAvailable: true,
        t: i18n.t.bind(i18n) as never,
      })
    );
    return { ui, dashboard, inputTables, editors, preview };
  }

  it('resolves a task deep link and opens its editor', async () => {
    const task = makeTask('task_nav', 'Navigate me');
    const getTask = vi.fn(async () => task);
    setDataBridge({ getTask });

    const { ui, dashboard, editors } = renderNavigation();

    act(() => {
      useAppStore.setState({
        pendingDataNavigation: { kind: 'task', id: 'task_nav', nonce: 1 },
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getTask).toHaveBeenCalledWith('task_nav');
    expect(editors.setEditingTaskId).toHaveBeenCalledWith('task_nav');
    expect(editors.setFocusedTask).toHaveBeenCalledWith(task);
    expect(ui.setActiveTab).toHaveBeenCalledWith('tasks');
    expect(dashboard.prependTask).toHaveBeenCalledWith(task);
    expect(useAppStore.getState().pendingDataNavigation).toBeNull();
  });

  it('resolves an input-table deep link and opens its dataset editor', async () => {
    const inputTable = { id: 'ds_nav', name: 'Customers' };
    const getInputTable = vi.fn(async () => inputTable);
    setDataBridge({ getInputTable });

    const { ui, inputTables, editors } = renderNavigation();

    act(() => {
      useAppStore.setState({
        pendingDataNavigation: { kind: 'input_table', id: 'ds_nav', nonce: 2 },
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getInputTable).toHaveBeenCalledWith('ds_nav');
    expect(editors.setEditingInputTableDatasetId).toHaveBeenCalledWith('ds_nav');
    expect(editors.setFocusedInputTable).toHaveBeenCalledWith(inputTable);
    expect(ui.setActiveTab).toHaveBeenCalledWith('input_tables');
    expect(inputTables.upsertDataset).toHaveBeenCalledWith(inputTable, false);
    expect(useAppStore.getState().pendingDataNavigation).toBeNull();
  });

  it('resolves an output-table deep link and opens its editor', async () => {
    const outputTable = { id: 'out_nav', name: 'Report' };
    const getOutputTable = vi.fn(async () => outputTable);
    setDataBridge({ getOutputTable });

    const { ui, dashboard, editors } = renderNavigation();

    act(() => {
      useAppStore.setState({
        pendingDataNavigation: { kind: 'output_table', id: 'out_nav', nonce: 3 },
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getOutputTable).toHaveBeenCalledWith('out_nav');
    expect(editors.setEditingOutputTableId).toHaveBeenCalledWith('out_nav');
    expect(editors.setFocusedOutputTable).toHaveBeenCalledWith(outputTable);
    expect(ui.setActiveTab).toHaveBeenCalledWith('output_tables');
    expect(dashboard.prependOutputTable).toHaveBeenCalledWith(outputTable);
    expect(useAppStore.getState().pendingDataNavigation).toBeNull();
  });

  it('does not restart an in-flight navigation when slice objects are recreated', async () => {
    // DataViewPage rebuilds the ui/dashboard/inputTables/editors/preview
    // objects on every render. If the effect depended on those identities, the
    // setLoadingTab inside the run would re-render, re-run the effect, cancel
    // the pending getTask, and loop forever without ever clearing the pending
    // navigation. Deps must be the stable members instead.
    const task = makeTask('task_stable', 'Stable deps');
    let resolveGetTask!: (value: typeof task) => void;
    const getTask = vi.fn(() => new Promise<typeof task>((resolve) => (resolveGetTask = resolve)));
    setDataBridge({ getTask });

    // Slice members keep stable identities (useState setters / useCallback
    // actions); only the wrapper objects are recreated per render.
    const members = {
      ui: {
        setError: vi.fn(),
        setActiveTab: vi.fn(),
        setPendingNavigationTab: vi.fn(),
        setLoadingTab: vi.fn(),
        setSearchQuery: vi.fn(),
      },
      dashboard: {
        prependTask: vi.fn(),
        setTaskPage: vi.fn(),
        prependOutputTable: vi.fn(),
        setOutputPage: vi.fn(),
      },
      inputTables: {
        setInputTablesLoading: vi.fn(),
        upsertDataset: vi.fn(),
        setTotalInputTableDatasets: vi.fn(),
        setDatasetPage: vi.fn(),
      },
      editors: {
        resetWorkspace: vi.fn(),
        setFocusedTask: vi.fn(),
        setFocusedInputTable: vi.fn(),
        setFocusedOutputTable: vi.fn(),
        setEditingTaskId: vi.fn(),
        setEditingInputTableDatasetId: vi.fn(),
        setEditingOutputTableId: vi.fn(),
      },
      preview: { close: vi.fn() },
    };
    const boundT = i18n.t.bind(i18n) as never;
    const makeDeps = () => ({
      ui: { ...members.ui } as unknown as DataViewUi,
      dashboard: { ...members.dashboard } as unknown as DataDashboardState,
      inputTables: { ...members.inputTables } as unknown as InputTablesState,
      editors: { ...members.editors } as unknown as DataViewEditors,
      preview: { ...members.preview } as unknown as StoredPreviewState,
      isDataApiAvailable: true,
      t: boundT,
    });

    const { rerender } = renderHook(
      (props: ReturnType<typeof makeDeps>) => useDataNavigation(props),
      { initialProps: makeDeps() }
    );

    act(() => {
      useAppStore.setState({
        pendingDataNavigation: { kind: 'task', id: 'task_stable', nonce: 5 },
      });
    });
    // The request is in flight; a parent re-render lands fresh slice objects.
    rerender(makeDeps());
    rerender(makeDeps());

    await act(async () => {
      resolveGetTask(task);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getTask).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().pendingDataNavigation).toBeNull();
  });

  it('surfaces a localized error when the deep-link target is gone', async () => {
    setDataBridge({ getTask: vi.fn(async () => null) });
    const { ui } = renderNavigation();

    act(() => {
      useAppStore.setState({
        pendingDataNavigation: { kind: 'task', id: 'task_gone', nonce: 4 },
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(ui.setError).toHaveBeenCalledWith(i18n.t('data.navigationNotFound'));
    expect(useAppStore.getState().pendingDataNavigation).toBeNull();
  });
});

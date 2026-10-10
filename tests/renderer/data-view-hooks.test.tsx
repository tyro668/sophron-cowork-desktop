// @vitest-environment happy-dom
/**
 * Behavior tests for the data feature's hook slices: UI state, drafts, the
 * dashboard server-state hook (request sequencing + loading flags), and
 * deep-link navigation — exercised through renderHook, not source strings.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import type { DataPipeline, DataDashboard } from '../../src/renderer/types';
import { useAppStore } from '../../src/renderer/store';
import { useDataViewUi } from '../../src/renderer/features/data/hooks/use-data-view-ui';
import { useRawTableDrafts } from '../../src/renderer/features/data/hooks/use-raw-table-drafts';
import { useDataDashboard } from '../../src/renderer/features/data/hooks/use-data-dashboard';
import { useDataNavigation } from '../../src/renderer/features/data/hooks/use-data-navigation';
import type { DataViewUi } from '../../src/renderer/features/data/hooks/use-data-view-ui';
import type { DataDashboardState } from '../../src/renderer/features/data/hooks/use-data-dashboard';
import type { RawTablesState } from '../../src/renderer/features/data/hooks/use-raw-tables';
import type { DataViewEditors } from '../../src/renderer/features/data/hooks/use-data-view-editors';
import type { StoredPreviewState } from '../../src/renderer/features/data/hooks/use-stored-preview';

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
  } as unknown as DataPipeline;
}

function setDataBridge(data: Partial<Record<string, unknown>>) {
  (window as { electronAPI?: unknown }).electronAPI = { data };
}

describe('useDataViewUi', () => {
  it('tracks tab, search, and error UI state', () => {
    const { result } = renderHook(() => useDataViewUi());

    expect(result.current.activeTab).toBe('pipelines');
    act(() => result.current.setActiveTab('raw_tables'));
    act(() => result.current.setSearchQuery('cust'));
    act(() => result.current.setError('boom'));

    expect(result.current.activeTab).toBe('raw_tables');
    expect(result.current.searchQuery).toBe('cust');
    expect(result.current.error).toBe('boom');
  });
});

describe('useRawTableDrafts', () => {
  it('creates, renames, and removes local drafts', () => {
    const { result } = renderHook(() => useRawTableDrafts());

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
        activeTab: 'pipelines',
        searchQuery: '',
        setError: vi.fn(),
        setLoadingTab: vi.fn(),
        setPendingNavigationTab: vi.fn(),
      })
    );
  }

  it('loads pipelines through the dataClient bridge and stores them', async () => {
    const pipeline = makePipeline('task_1', 'Clean customers');
    const getDashboard = vi.fn(async () => ({
      ...EMPTY,
      pipelines: [pipeline],
      totalPipelines: 1,
      summary: { ...EMPTY.summary, pipelineCount: 1 },
    }));
    setDataBridge({ getDashboard });

    const { result } = renderDashboard();
    await act(async () => {
      await result.current.loadDashboard();
    });

    expect(getDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ includePipelines: true, pipelinePerGroupLimit: expect.any(Number) })
    );
    expect(result.current.dashboard.pipelines).toEqual([pipeline]);
    expect(result.current.dashboard.totalPipelines).toBe(1);
  });

  it('drops a stale response when a newer request is in flight', async () => {
    const stale = makePipeline('task_stale');
    const fresh = makePipeline('task_fresh');
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
      resolvers[1]({ ...EMPTY, pipelines: [fresh], totalPipelines: 1 });
      resolvers[0]({ ...EMPTY, pipelines: [stale], totalPipelines: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.dashboard.pipelines).toEqual([fresh]);
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
      prependPipeline: vi.fn(),
      setPipelinePage: vi.fn(),
      prependResultTable: vi.fn(),
      setOutputPage: vi.fn(),
    } as unknown as DataDashboardState;
    const rawTables = {
      setRawTablesLoading: vi.fn(),
      upsertRawTable: vi.fn(),
      setTotalRawTables: vi.fn(),
      setRawTablePage: vi.fn(),
    } as unknown as RawTablesState;
    const editors = {
      resetWorkspace: vi.fn(),
      setFocusedPipeline: vi.fn(),
      setFocusedRawTable: vi.fn(),
      setFocusedResultTable: vi.fn(),
      setEditingPipelineId: vi.fn(),
      setEditingRawTableId: vi.fn(),
      setEditingResultTableId: vi.fn(),
    } as unknown as DataViewEditors;
    const preview = { close: vi.fn() } as unknown as StoredPreviewState;

    renderHook(() =>
      useDataNavigation({
        ui,
        dashboard,
        rawTables,
        editors,
        preview,
        isDataApiAvailable: true,
        t: i18n.t.bind(i18n) as never,
      })
    );
    return { ui, dashboard, rawTables, editors, preview };
  }

  it('resolves a pipeline deep link and opens its editor', async () => {
    const pipeline = makePipeline('task_nav', 'Navigate me');
    const getPipeline = vi.fn(async () => pipeline);
    setDataBridge({ getPipeline });

    const { ui, dashboard, editors } = renderNavigation();

    act(() => {
      useAppStore.setState({
        pendingDataNavigation: { kind: 'pipeline', id: 'task_nav', nonce: 1 },
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getPipeline).toHaveBeenCalledWith('task_nav');
    expect(editors.setEditingPipelineId).toHaveBeenCalledWith('task_nav');
    expect(editors.setFocusedPipeline).toHaveBeenCalledWith(pipeline);
    expect(ui.setActiveTab).toHaveBeenCalledWith('pipelines');
    expect(dashboard.prependPipeline).toHaveBeenCalledWith(pipeline);
    expect(useAppStore.getState().pendingDataNavigation).toBeNull();
  });

  it('resolves an raw-table deep link and opens its rawTable editor', async () => {
    const rawTable = { id: 'ds_nav', name: 'Customers' };
    const getRawTable = vi.fn(async () => rawTable);
    setDataBridge({ getRawTable });

    const { ui, rawTables, editors } = renderNavigation();

    act(() => {
      useAppStore.setState({
        pendingDataNavigation: { kind: 'raw_table', id: 'ds_nav', nonce: 2 },
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getRawTable).toHaveBeenCalledWith('ds_nav');
    expect(editors.setEditingRawTableId).toHaveBeenCalledWith('ds_nav');
    expect(editors.setFocusedRawTable).toHaveBeenCalledWith(rawTable);
    expect(ui.setActiveTab).toHaveBeenCalledWith('raw_tables');
    expect(rawTables.upsertRawTable).toHaveBeenCalledWith(rawTable, false);
    expect(useAppStore.getState().pendingDataNavigation).toBeNull();
  });

  it('resolves an result-table deep link and opens its editor', async () => {
    const resultTable = { id: 'out_nav', name: 'Report' };
    const getResultTable = vi.fn(async () => resultTable);
    setDataBridge({ getResultTable });

    const { ui, dashboard, editors } = renderNavigation();

    act(() => {
      useAppStore.setState({
        pendingDataNavigation: { kind: 'result_table', id: 'out_nav', nonce: 3 },
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getResultTable).toHaveBeenCalledWith('out_nav');
    expect(editors.setEditingResultTableId).toHaveBeenCalledWith('out_nav');
    expect(editors.setFocusedResultTable).toHaveBeenCalledWith(resultTable);
    expect(ui.setActiveTab).toHaveBeenCalledWith('result_tables');
    expect(dashboard.prependResultTable).toHaveBeenCalledWith(resultTable);
    expect(useAppStore.getState().pendingDataNavigation).toBeNull();
  });

  it('does not restart an in-flight navigation when slice objects are recreated', async () => {
    // DataViewPage rebuilds the ui/dashboard/rawTables/editors/preview
    // objects on every render. If the effect depended on those identities, the
    // setLoadingTab inside the run would re-render, re-run the effect, cancel
    // the pending getPipeline, and loop forever without ever clearing the pending
    // navigation. Deps must be the stable members instead.
    const pipeline = makePipeline('task_stable', 'Stable deps');
    let resolveGetPipeline!: (value: typeof pipeline) => void;
    const getPipeline = vi.fn(
      () => new Promise<typeof pipeline>((resolve) => (resolveGetPipeline = resolve))
    );
    setDataBridge({ getPipeline });

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
        prependPipeline: vi.fn(),
        setPipelinePage: vi.fn(),
        prependResultTable: vi.fn(),
        setOutputPage: vi.fn(),
      },
      rawTables: {
        setRawTablesLoading: vi.fn(),
        upsertRawTable: vi.fn(),
        setTotalRawTables: vi.fn(),
        setRawTablePage: vi.fn(),
      },
      editors: {
        resetWorkspace: vi.fn(),
        setFocusedPipeline: vi.fn(),
        setFocusedRawTable: vi.fn(),
        setFocusedResultTable: vi.fn(),
        setEditingPipelineId: vi.fn(),
        setEditingRawTableId: vi.fn(),
        setEditingResultTableId: vi.fn(),
      },
      preview: { close: vi.fn() },
    };
    const boundT = i18n.t.bind(i18n) as never;
    const makeDeps = () => ({
      ui: { ...members.ui } as unknown as DataViewUi,
      dashboard: { ...members.dashboard } as unknown as DataDashboardState,
      rawTables: { ...members.rawTables } as unknown as RawTablesState,
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
        pendingDataNavigation: { kind: 'pipeline', id: 'task_stable', nonce: 5 },
      });
    });
    // The request is in flight; a parent re-render lands fresh slice objects.
    rerender(makeDeps());
    rerender(makeDeps());

    await act(async () => {
      resolveGetPipeline(pipeline);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getPipeline).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().pendingDataNavigation).toBeNull();
  });

  it('surfaces a localized error when the deep-link target is gone', async () => {
    setDataBridge({ getPipeline: vi.fn(async () => null) });
    const { ui } = renderNavigation();

    act(() => {
      useAppStore.setState({
        pendingDataNavigation: { kind: 'pipeline', id: 'task_gone', nonce: 4 },
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(ui.setError).toHaveBeenCalledWith(i18n.t('data.navigationNotFound'));
    expect(useAppStore.getState().pendingDataNavigation).toBeNull();
  });
});

// @vitest-environment happy-dom
/**
 * Cloud-mirrored input tables: the list and editor surface cloud provenance
 * (space / project / table, last sync, source version) instead of the raw
 * temp file path, and the editor exposes sync + view-in-cloud actions.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import type { DataDataset } from '../../src/renderer/types';
import {
  InputTableEditor,
  InputTablesPanel,
} from '../../src/renderer/components/data-view/input-tables';
import { ConfirmDialogProvider } from '../../src/renderer/components/ConfirmDialog';
import {
  formatCloudMirrorLocation,
  getCloudMirror,
} from '../../src/renderer/components/data-view/shared';
import {
  useDataActions,
  type DataActionsDeps,
} from '../../src/renderer/features/data/hooks/use-data-actions';
import type { DataViewUi } from '../../src/renderer/features/data/hooks/use-data-view-ui';
import type { DataDashboardState } from '../../src/renderer/features/data/hooks/use-data-dashboard';
import type { InputTablesState } from '../../src/renderer/features/data/hooks/use-input-tables';
import type { InputTableDraftsState } from '../../src/renderer/features/data/hooks/use-input-table-drafts';
import type { DataViewEditors } from '../../src/renderer/features/data/hooks/use-data-view-editors';

const MIRROR = {
  tableId: 'remote',
  spaceId: 's',
  projectId: 'p',
  spaceName: 'Alpha space',
  projectName: 'Beta project',
  tableKind: 'analysis' as const,
  tableName: 'Remote sales',
  sourceVersion: '2026-09-22',
  syncedAt: 1750000000000,
  contentHash: 'abc123',
};

function makeCloudDataset(overrides?: Partial<DataDataset>): DataDataset {
  return {
    id: 'ds1',
    name: 'Imported sales',
    groupId: null,
    sourcePath: '/data/cloud-imports/cloud-remote.csv',
    sourceKind: 'csv',
    fileCount: 1,
    tableName: 'dataset_ds1',
    rowCount: 2,
    columnCount: 2,
    relatedTaskNames: [],
    createdAt: 1,
    updatedAt: 2,
    inputConfig: {
      sourceKind: 'csv',
      header: 'auto',
      dataRegion: 'auto',
      encoding: 'auto',
      delimiter: 'auto',
      cloudMirror: { ...MIRROR },
    },
    ...overrides,
  } as DataDataset;
}

function renderPanel() {
  (window as { electronAPI?: unknown }).electronAPI = { data: {} };
  return render(
    <InputTablesPanel
      datasets={[makeCloudDataset()]}
      drafts={[]}
      groups={[]}
      totalDatasets={1}
      currentPage={1}
      searchQuery=""
      isLoading={false}
      onSearchChange={vi.fn()}
      onPageChange={vi.fn()}
      onCreate={vi.fn()}
      onRefresh={vi.fn()}
      onPreviewDataset={vi.fn()}
      onDelete={vi.fn()}
      onDeleteAll={vi.fn()}
      onDeleteDraft={vi.fn()}
      onEditDraft={vi.fn()}
      onEditDataset={vi.fn()}
      onCreateTaskFromTable={vi.fn()}
      onAssignToGroup={vi.fn()}
      onRenameGroup={vi.fn()}
      onDeleteGroup={vi.fn()}
      isCreateDisabled={false}
      actionId={null}
    />
  );
}

function renderEditor(handlers?: {
  onSyncCloudSource?: (dataset: DataDataset) => void | Promise<void>;
  onOpenCloudSource?: (mirror: unknown) => void;
}) {
  (window as { electronAPI?: unknown }).electronAPI = { data: {} };
  return render(
    <ConfirmDialogProvider>
      <InputTableEditor
        dataset={makeCloudDataset()}
        isBusy={false}
        onBack={vi.fn()}
        onRenameDataset={vi.fn()}
        onChooseDatasetSource={vi.fn()}
        onUpdateDatasetConfig={vi.fn()}
        onSyncCloudSource={handlers?.onSyncCloudSource}
        onOpenCloudSource={handlers?.onOpenCloudSource}
      />
    </ConfirmDialogProvider>
  );
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
    loadDashboard: vi.fn(async () => undefined),
  } as unknown as DataDashboardState;
  const inputTables = {
    loadInputTables: vi.fn(async () => undefined),
  } as unknown as InputTablesState;
  const deps: DataActionsDeps = {
    ui,
    dashboard,
    inputTables,
    drafts: {} as InputTableDraftsState,
    editors: {} as DataViewEditors,
    t: i18n.t.bind(i18n) as DataActionsDeps['t'],
    confirmDelete: vi.fn(async () => true),
    ...overrides,
  };
  const hook = renderHook(() => useDataActions(deps));
  return { hook, deps };
}

describe('cloud-mirrored input table', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a cloud badge and source breadcrumb instead of the snapshot path', () => {
    renderPanel();
    expect(screen.getByText('Cloud table')).toBeTruthy();
    expect(screen.getByText('Alpha space / Beta project / Remote sales')).toBeTruthy();
    expect(screen.queryByText(/cloud-remote\.csv/)).toBeNull();
  });

  it('keeps plain CSV rows unchanged', () => {
    const plain = makeCloudDataset({
      id: 'ds2',
      name: 'Plain csv',
      sourcePath: '/data/local.csv',
      inputConfig: {
        sourceKind: 'csv',
        header: 'auto',
        dataRegion: 'auto',
        encoding: 'auto',
        delimiter: 'auto',
      },
    });
    (window as { electronAPI?: unknown }).electronAPI = { data: {} };
    render(
      <InputTablesPanel
        datasets={[plain]}
        drafts={[]}
        groups={[]}
        totalDatasets={1}
        currentPage={1}
        searchQuery=""
        isLoading={false}
        onSearchChange={vi.fn()}
        onPageChange={vi.fn()}
        onCreate={vi.fn()}
        onRefresh={vi.fn()}
        onPreviewDataset={vi.fn()}
        onDelete={vi.fn()}
        onDeleteAll={vi.fn()}
        onDeleteDraft={vi.fn()}
        onEditDraft={vi.fn()}
        onEditDataset={vi.fn()}
        onCreateTaskFromTable={vi.fn()}
        onAssignToGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        isCreateDisabled={false}
        actionId={null}
      />
    );
    expect(screen.getByText('CSV')).toBeTruthy();
    expect(screen.queryByText('Cloud table')).toBeNull();
    expect(screen.queryByText('Alpha space / Beta project / Remote sales')).toBeNull();
  });

  it('shows provenance fields and triggers sync/open actions from the editor', () => {
    const onSyncCloudSource = vi.fn(async () => undefined);
    const onOpenCloudSource = vi.fn();
    renderEditor({ onSyncCloudSource, onOpenCloudSource });

    expect(screen.getByText('Cloud source')).toBeTruthy();
    expect(screen.getByText('Local snapshot: 2 rows')).toBeTruthy();
    expect(screen.getByText(/Last synced/)).toBeTruthy();
    expect(screen.getByText(/Source updated 2026-09-22/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sync latest data' }));
    expect(onSyncCloudSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'ds1' }));

    fireEvent.click(screen.getByRole('button', { name: 'View in Cloud Space' }));
    expect(onOpenCloudSource).toHaveBeenCalledWith(expect.objectContaining({ tableId: 'remote' }));
  });

  it('extracts mirror info only from csv configs and formats breadcrumbs', () => {
    expect(getCloudMirror(makeCloudDataset())).toMatchObject({ tableId: 'remote' });
    const excel = makeCloudDataset({
      sourceKind: 'excel',
      inputConfig: {
        sourceKind: 'excel',
        sheetName: null,
        sheetNames: [],
        headerMode: 'auto',
        headerRow: 1,
      },
    });
    expect(getCloudMirror(excel)).toBeUndefined();
    expect(
      formatCloudMirrorLocation({
        tableId: 'remote',
        spaceId: 's',
        projectId: 'p',
        contentHash: 'h',
      })
    ).toBe('s / p / remote');
  });

  it('refresh action calls the bridge and reloads the lists', async () => {
    const refreshCloudInputTable = vi.fn(async () => ({ inputTable: makeCloudDataset() }));
    (window as { electronAPI?: unknown }).electronAPI = {
      data: { refreshCloudInputTable },
    };
    const { hook, deps } = renderActions();
    await act(async () => {
      await hook.result.current.handleRefreshCloudInputTable(makeCloudDataset());
    });
    expect(refreshCloudInputTable).toHaveBeenCalledWith({ inputTableId: 'ds1' });
    expect(deps.inputTables.loadInputTables).toHaveBeenCalled();
    expect(deps.dashboard.loadDashboard).toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom
/** Cloud bindings stay in configuration; data refresh and timestamps stay in the data tab. */
import { useState } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import type { DataRawTable } from '../../src/renderer/types';
import { RawTableEditor, RawTablesPanel } from '../../src/renderer/components/data-view/raw-tables';
import { ConfirmDialogProvider } from '../../src/renderer/components/ConfirmDialog';
import {
  formatCloudMirrorLocation,
  formatDateTime,
  getCloudMirror,
} from '../../src/renderer/components/data-view/shared';
import {
  useDataActions,
  type DataActionsDeps,
} from '../../src/renderer/features/data/hooks/use-data-actions';
import type { DataViewUi } from '../../src/renderer/features/data/hooks/use-data-view-ui';
import type { DataDashboardState } from '../../src/renderer/features/data/hooks/use-data-dashboard';
import type { RawTablesState } from '../../src/renderer/features/data/hooks/use-raw-tables';
import type { RawTableDraftsState } from '../../src/renderer/features/data/hooks/use-raw-table-drafts';
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

function makeCloudRawTable(overrides?: Partial<DataRawTable>): DataRawTable {
  return {
    id: 'ds1',
    name: 'Imported sales',
    groupId: null,
    sourcePath: '/data/cloud-imports/cloud-remote.csv',
    sourceKind: 'cloud',
    fileCount: 1,
    tableName: 'rawTable_ds1',
    rowCount: 2,
    columnCount: 2,
    relatedPipelineNames: [],
    createdAt: 1,
    updatedAt: 2,
    inputConfig: {
      sourceKind: 'cloud',
      cloudMirror: { ...MIRROR },
    },
    ...overrides,
  } as DataRawTable;
}

function renderPanel() {
  (window as { electronAPI?: unknown }).electronAPI = { data: {} };
  return render(
    <RawTablesPanel
      rawTables={[makeCloudRawTable()]}
      drafts={[]}
      groups={[]}
      groupCounts={{}}
      groupPages={{}}
      totalRawTables={1}
      searchQuery=""
      isLoading={false}
      onSearchChange={vi.fn()}
      onCreate={vi.fn()}
      onRefresh={vi.fn()}
      onPreviewRawTable={vi.fn()}
      onDelete={vi.fn()}
      onDeleteAll={vi.fn()}
      onDeleteDraft={vi.fn()}
      onEditDraft={vi.fn()}
      onEditRawTable={vi.fn()}
      onCreatePipelineFromTable={vi.fn()}
      onAssignToGroup={vi.fn()}
      onRenameGroup={vi.fn()}
      onDeleteGroup={vi.fn()}
      onGroupPageChange={vi.fn()}
      isCreateDisabled={false}
      actionId={null}
    />
  );
}

function renderEditor(handlers?: {
  onSyncCloudSource?: (rawTable: DataRawTable) => Promise<DataRawTable | undefined>;
}) {
  const previewRawTableSource = vi.fn(async () => ({ columns: [], rows: [], totalRows: 2 }));
  (window as { electronAPI?: unknown }).electronAPI = { data: { previewRawTableSource } };
  function Editor() {
    const [rawTable, setRawTable] = useState(makeCloudRawTable());
    return (
      <ConfirmDialogProvider>
        <RawTableEditor
          rawTable={rawTable}
          isBusy={false}
          onBack={vi.fn()}
          onRenameRawTable={vi.fn()}
          onChooseRawTableSource={vi.fn()}
          onUpdateRawTableConfig={vi.fn()}
          onSyncCloudSource={async (source) => {
            const refreshed = await handlers?.onSyncCloudSource?.(source);
            if (refreshed) setRawTable(refreshed);
            return refreshed;
          }}
        />
      </ConfirmDialogProvider>
    );
  }
  return { ...render(<Editor />), previewRawTableSource };
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
    loadDashboard: vi.fn(async () => undefined),
  } as unknown as DataDashboardState;
  const rawTables = {
    loadRawTables: vi.fn(async () => undefined),
  } as unknown as RawTablesState;
  const deps: DataActionsDeps = {
    ui,
    dashboard,
    rawTables,
    drafts: {} as RawTableDraftsState,
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
    const { container } = renderPanel();
    expect(container.innerHTML).not.toContain('cloud-remote.csv');
    expect(screen.getByText('Cloud table')).toBeTruthy();
    expect(screen.getByText('Alpha space / Beta project / Remote sales')).toBeTruthy();
    expect(screen.queryByText(/cloud-remote\.csv/)).toBeNull();
  });

  it('keeps plain Csv rows unchanged', () => {
    const plain = makeCloudRawTable({
      id: 'ds2',
      sourceKind: 'csv',
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
      <RawTablesPanel
        rawTables={[plain]}
        drafts={[]}
        groups={[]}
        groupCounts={{}}
        groupPages={{}}
        totalRawTables={1}
        searchQuery=""
        isLoading={false}
        onSearchChange={vi.fn()}
        onCreate={vi.fn()}
        onRefresh={vi.fn()}
        onPreviewRawTable={vi.fn()}
        onDelete={vi.fn()}
        onDeleteAll={vi.fn()}
        onDeleteDraft={vi.fn()}
        onEditDraft={vi.fn()}
        onEditRawTable={vi.fn()}
        onCreatePipelineFromTable={vi.fn()}
        onAssignToGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onGroupPageChange={vi.fn()}
        isCreateDisabled={false}
        actionId={null}
      />
    );
    expect(screen.getByText('Csv')).toBeTruthy();
    expect(screen.queryByText('Cloud table')).toBeNull();
    expect(screen.queryByText('Alpha space / Beta project / Remote sales')).toBeNull();
  });

  it('keeps configuration compact and refreshes cloud data from the data tab', async () => {
    const refreshed = makeCloudRawTable({
      sourcePath: '/data/cloud-imports/new.csv',
      updatedAt: 1750000005000,
      inputConfig: {
        sourceKind: 'cloud',
        cloudMirror: { ...MIRROR, syncedAt: 1750000005000, contentHash: 'new-hash' },
      },
    });
    const onSyncCloudSource = vi.fn(async () => refreshed);
    const { container, previewRawTableSource } = renderEditor({ onSyncCloudSource });
    expect(container.innerHTML).not.toContain('cloud-remote.csv');
    expect(screen.queryByRole('button', { name: 'Change file' })).toBeNull();
    expect(screen.getAllByRole('combobox')[0].textContent).toContain('Cloud table');
    expect(screen.getByRole('button', { name: 'Change cloud table' })).toBeTruthy();
    expect(screen.getAllByText('Alpha space / Beta project / Remote sales')).toHaveLength(1);
    expect(screen.queryByText('Cloud source')).toBeNull();
    expect(screen.queryByText(/Last synced/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync latest data' })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Data' }));
    });
    expect(onSyncCloudSource).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    });
    expect(onSyncCloudSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'ds1' }));
    expect(previewRawTableSource).toHaveBeenLastCalledWith(
      expect.objectContaining({ filePath: refreshed.sourcePath, config: refreshed.inputConfig })
    );
    expect(screen.getByRole('tab', { name: 'Data' }).getAttribute('aria-selected')).toBe('true');
    expect(
      screen.getByText(
        i18n.t('data.resultTables.editor.dataMeta', {
          rows: 2,
          time: formatDateTime(refreshed.updatedAt),
        })
      )
    ).toBeTruthy();
  });

  it('extracts cloud linkage and formats breadcrumbs', () => {
    expect(getCloudMirror(makeCloudRawTable())).toMatchObject({ tableId: 'remote' });
    const excel = makeCloudRawTable({
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

  it('creates a cloud input from a draft through the same import flow', async () => {
    const importCloudRawTable = vi.fn(async () => ({ rawTable: makeCloudRawTable() }));
    const pickFile = vi.fn();
    (window as { electronAPI?: unknown }).electronAPI = {
      data: { importCloudRawTable },
      selectRawTableSource: pickFile,
    };
    const removeDraft = vi.fn();
    const upsertRawTable = vi.fn();
    const { hook } = renderActions({
      drafts: { removeDraft } as unknown as RawTableDraftsState,
      rawTables: {
        upsertRawTable,
        setRawTablePage: vi.fn(),
        loadRawTables: vi.fn(async () => undefined),
      } as unknown as RawTablesState,
      editors: {
        setEditingRawTableDraftId: vi.fn(),
        setEditingRawTableId: vi.fn(),
      } as unknown as DataViewEditors,
    });
    await act(async () => {
      await hook.result.current.handleImportRawTableSource(
        { id: 'draft', name: 'New input' } as never,
        'cloud',
        { sourceKind: 'cloud', cloudMirror: MIRROR }
      );
    });
    expect(importCloudRawTable).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: 'remote', name: 'New input' })
    );
    expect(pickFile).not.toHaveBeenCalled();
    expect(removeDraft).toHaveBeenCalledWith('draft');
    expect(upsertRawTable).toHaveBeenCalled();
  });

  it('rebinds through cloud import without opening a file picker', async () => {
    const importCloudRawTable = vi.fn(async () => ({ rawTable: makeCloudRawTable() }));
    const pickFile = vi.fn();
    (window as { electronAPI?: unknown }).electronAPI = {
      data: { importCloudRawTable, updateRawTable: vi.fn() },
      selectRawTableSource: pickFile,
    };
    const updateRawTableRow = vi.fn();
    const { hook } = renderActions({
      rawTables: {
        updateRawTableRow,
        loadRawTables: vi.fn(async () => undefined),
      } as unknown as RawTablesState,
    });
    await act(async () => {
      await hook.result.current.handleUpdateRawTableSource(makeCloudRawTable(), 'cloud', {
        sourceKind: 'cloud',
        cloudMirror: { ...MIRROR, tableId: 'next' },
      });
    });
    expect(importCloudRawTable).toHaveBeenCalledWith(
      expect.objectContaining({ rawTableId: 'ds1', tableId: 'next' })
    );
    expect(pickFile).not.toHaveBeenCalled();
    expect(updateRawTableRow).toHaveBeenCalled();
  });

  it('refresh action calls the bridge and reloads the lists', async () => {
    const refreshCloudRawTable = vi.fn(async () => ({ rawTable: makeCloudRawTable() }));
    (window as { electronAPI?: unknown }).electronAPI = {
      data: { refreshCloudRawTable },
    };
    const { hook, deps } = renderActions();
    await act(async () => {
      await hook.result.current.handleRefreshCloudRawTable(makeCloudRawTable());
    });
    expect(refreshCloudRawTable).toHaveBeenCalledWith({ rawTableId: 'ds1' });
    expect(deps.rawTables.loadRawTables).toHaveBeenCalled();
    expect(deps.dashboard.loadDashboard).toHaveBeenCalled();
  });
});

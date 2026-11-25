// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CloudConnectionActionResult,
  CloudConnectionGroup,
  CloudConnectionState,
} from '../../src/shared/contracts';
import { ConfirmDialogProvider } from '../../src/renderer/components/ConfirmDialog';
import { CloudConnectionPanel } from '../../src/renderer/components/data-view/cloud-connection';
import { SettingsCloudConnection } from '../../src/renderer/components/settings/SettingsCloudConnection';
import { EMPTY_DASHBOARD } from '../../src/renderer/features/data/model/types';
import { DataViewPage } from '../../src/renderer/features/data/pages/DataViewPage';
import { useAppStore } from '../../src/renderer/store';
import i18n from './i18n-test';

const t = (key: string) => i18n.t(key);

const group: CloudConnectionGroup = {
  id: 'g1',
  sourceName: '本地文件',
  tables: [
    {
      reportName: '销售合并',
      kind: 'raw',
      tableId: 'raw-1',
      displayName: '销售原始表',
      status: 'ok',
      rowCount: 10,
      columnCount: 3,
    },
  ],
  entries: [
    { id: '销售合并', kind: 'raw', tableId: 'raw-1', displayName: '销售原始表', status: 'ok' },
  ],
  entriesStatus: 'ready',
};

function makeState(patch: Partial<CloudConnectionState> = {}): CloudConnectionState {
  return {
    configured: true,
    config: {
      agentIdMasked: '0123****cdef',
      protocol: 'http',
      host: 'mock',
      port: 1,
      importedAt: 1,
      hasToken: true,
    },
    status: 'idle',
    connectedAt: null,
    remoteEnv: null,
    lastError: null,
    autoConnect: false,
    groups: [group],
    activities: [],
    ...patch,
  };
}

let state: CloudConnectionState;
const ok = (): Promise<CloudConnectionActionResult> => Promise.resolve({ success: true, state });
const api = {
  getState: vi.fn(() => Promise.resolve(state)),
  onState: vi.fn(() => () => undefined),
  importConfig: vi.fn(ok),
  clearConfig: vi.fn(ok),
  connect: vi.fn(ok),
  disconnect: vi.fn(ok),
  setAutoConnect: vi.fn(ok),
  addGroup: vi.fn(ok),
  updateGroup: vi.fn(ok),
  deleteGroup: vi.fn(ok),
  addTableRefs: vi.fn((_groupId?: string, _refs?: unknown) => ok()),
  updateTableRef: vi.fn(ok),
  deleteTable: vi.fn(ok),
  refreshTables: vi.fn(ok),
  previewTable: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  state = makeState();
  (window as unknown as { electronAPI: unknown }).electronAPI = { cloudConnection: api };
  useAppStore.setState({
    settingsTab: null,
    showSettings: false,
    pendingDataTabNavigation: null,
    mainView: 'chat',
  });
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const openMoreMenu = async () => {
  const trigger = await screen.findByTestId('cloud-connection-more');
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
};

describe('数据 → 云连接', () => {
  it('shows one empty-state action that opens Settings → 云连接 when not configured', async () => {
    state = makeState({ configured: false, config: null, groups: [] });
    render(<CloudConnectionPanel />);
    const button = await screen.findByTestId('cloud-connection-open-settings');
    expect(screen.getByText(t('cloudConnection.emptyConfig'))).toBeTruthy();
    expect(screen.queryByText(t('cloudConnection.actions.importConfig'))).toBeNull();
    fireEvent.click(button);
    expect(useAppStore.getState().settingsTab).toBe('cloud-connection');
    expect(useAppStore.getState().showSettings).toBe(true);
  });

  it('shows data-source management and jumps to Settings for connection config', async () => {
    render(<CloudConnectionPanel />);
    await screen.findByTestId('cloud-connection-datasources');
    expect(screen.getByText('本地文件')).toBeTruthy();
    expect(screen.getByText(t('cloudConnection.ds.selectTitle'))).toBeTruthy();
    expect(screen.queryByText('销售合并')).toBeNull();
    expect(screen.getByTestId('cloud-connection-add-group').textContent).toContain(
      t('cloudConnection.ds.addGroup')
    );
    expect(screen.queryByTestId('cloud-connection-add-table')).toBeNull();
    await openMoreMenu();
    expect(screen.queryByRole('menuitem', { name: t('cloudConnection.ds.addGroup') })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: t('cloudConnection.ds.addTable') })).toBeNull();
    fireEvent.click(
      await screen.findByRole('menuitem', { name: t('cloudConnection.actions.openSettings') })
    );
    expect(useAppStore.getState().settingsTab).toBe('cloud-connection');
    expect(useAppStore.getState().showSettings).toBe(true);
  });

  it('shows a referenced table and can rename the frozen cloud report name', async () => {
    render(<CloudConnectionPanel />);
    fireEvent.click(await screen.findByText('本地文件'));
    fireEvent.click(await screen.findByText('销售合并'));
    const form = await screen.findByTestId('cloud-connection-table-form');
    expect(form.textContent).toContain(t('cloudConnection.ds.refKindRaw'));
    expect(form.textContent).toContain(t('cloudConnection.ds.reportNameHint'));
    const name = screen.getByTestId('cloud-connection-report-name') as HTMLInputElement;
    expect(name.value).toBe('销售合并');
    fireEvent.change(name, { target: { value: '销售2024' } });
    fireEvent.click(screen.getByTestId('cloud-connection-save-table'));
    await waitFor(() => expect(api.updateTableRef).toHaveBeenCalled());
    expect(api.updateTableRef.mock.calls[0]).toEqual([
      'g1',
      '销售合并',
      { reportName: '销售2024' },
    ]);
  });

  it('creates a group through 添加分组', async () => {
    render(<CloudConnectionPanel />);
    fireEvent.click(await screen.findByTestId('cloud-connection-add-group'));
    fireEvent.change(screen.getByTestId('cloud-connection-group-name'), {
      target: { value: '新分组' },
    });
    fireEvent.click(screen.getByTestId('cloud-connection-group-save'));
    await waitFor(() => expect(api.addGroup).toHaveBeenCalledWith({ sourceName: '新分组' }));
  });

  it('keeps an existing group name read-only and enables 添加表 after the group is selected', async () => {
    render(<CloudConnectionPanel />);
    fireEvent.click(await screen.findByText('本地文件'));
    expect(screen.getByTestId('cloud-connection-add-table').textContent).toContain(
      t('cloudConnection.ds.addTable')
    );
    expect((screen.getByTestId('cloud-connection-add-table') as HTMLButtonElement).disabled).toBe(
      false
    );
    const name = (await screen.findByTestId('cloud-connection-group-name')) as HTMLInputElement;
    expect(name.disabled).toBe(true);
    expect(name.value).toBe('本地文件');
    expect(screen.getByTitle(t('cloudConnection.ds.groupNameLocked'))).toBeTruthy();
  });

  it('opens a raw/result table picker from 添加表', async () => {
    const dataApi = {
      getDashboard: vi.fn(() =>
        Promise.resolve({
          rawTables: [{ id: 'raw-2', name: '订单' }],
          resultTables: [{ id: 'out-1', name: '汇总' }],
        })
      ),
    };
    (
      window as unknown as { electronAPI: { cloudConnection: typeof api; data: typeof dataApi } }
    ).electronAPI = { cloudConnection: api, data: dataApi };
    render(<CloudConnectionPanel />);
    fireEvent.click(await screen.findByText('本地文件'));
    fireEvent.click(screen.getByTestId('cloud-connection-add-table'));
    await screen.findByTestId('cloud-connection-table-picker');
    await screen.findByTestId('cloud-connection-picker-list');
    expect(screen.getByText('订单')).toBeTruthy();
    expect(screen.getByText('汇总')).toBeTruthy();
    expect(screen.getByTestId('cloud-connection-create-raw-table').textContent).toContain(
      t('cloudConnection.ds.createRawTable')
    );
    fireEvent.click(screen.getByText('订单'));
    fireEvent.click(screen.getByTestId('cloud-connection-save-table'));
    await waitFor(() =>
      expect(api.addTableRefs).toHaveBeenCalledWith('g1', [{ kind: 'raw', tableId: 'raw-2' }])
    );
  });

  it('shows 新建原始表 in the add-table picker even when the list is empty', async () => {
    const dataApi = {
      getDashboard: vi.fn(() =>
        Promise.resolve({
          rawTables: [],
          resultTables: [],
        })
      ),
    };
    (
      window as unknown as { electronAPI: { cloudConnection: typeof api; data: typeof dataApi } }
    ).electronAPI = { cloudConnection: api, data: dataApi };
    render(<CloudConnectionPanel />);
    fireEvent.click(await screen.findByText('本地文件'));
    fireEvent.click(screen.getByTestId('cloud-connection-add-table'));
    await screen.findByTestId('cloud-connection-table-picker');
    await screen.findByTestId('cloud-connection-picker-empty');
    expect(screen.getByTestId('cloud-connection-create-raw-table')).toBeTruthy();
    expect(screen.getByTestId('cloud-connection-create-raw-table-empty').textContent).toContain(
      t('cloudConnection.ds.createRawTable')
    );
    expect(screen.getByText(t('cloudConnection.ds.pickerEmpty'))).toBeTruthy();
  });
});

describe('设置 → 云连接', () => {
  it('imports config from settings when nothing is configured', async () => {
    state = makeState({ configured: false, config: null, groups: [] });
    render(<SettingsCloudConnection />);
    fireEvent.click(await screen.findByTestId('cloud-connection-import'));
    await waitFor(() => expect(api.importConfig).toHaveBeenCalled());
  });

  it('shows only connection config, not data-source management', async () => {
    render(<SettingsCloudConnection />);
    await screen.findByTestId('settings-cloud-connection');
    expect(screen.getByText('0123****cdef')).toBeTruthy();
    expect(screen.queryByTestId('cloud-connection-datasources')).toBeNull();
    expect(screen.queryByTestId('cloud-connection-add-group')).toBeNull();
    expect(screen.queryByText('销售合并')).toBeNull();
  });
});

describe('SettingsPanel registration', () => {
  it('registers the 云连接 tab in the data group', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx'),
      'utf8'
    );
    expect(source).toMatch(/VALID_TABS = new Set<TabId>\(\[[^\]]*'cloud-connection'/s);
    expect(source).toMatch(/id: 'cloud-connection' as TabId,\s*group: 'data'/);
    expect(source).toContain('<SettingsCloudConnection />');
  });
});

const DATA_TAB_KEYS = [
  'data.tabs.pipelines',
  'data.tabs.rawTables',
  'data.tabs.resultTables',
  'data.tabs.cloudAnalysis',
  'data.tabs.cloudConnection',
] as const;

function dataTabLabels(): string[] {
  return [...document.querySelectorAll('[data-fixed-tab]')].map(
    (el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  );
}

function expectedDataTabLabels(): string[] {
  return DATA_TAB_KEYS.map((key) => t(key));
}

describe('数据页「云连接」tab（在云空间之后）', () => {
  function setupDataBridge() {
    const passthrough = (name: string) =>
      vi.fn(async () => {
        if (name === 'getDashboard') return EMPTY_DASHBOARD;
        if (name === 'getAppConfig') return {};
        return [];
      });
    const data = new Proxy(
      {},
      {
        get: (_target, prop: string) => passthrough(prop),
        has: () => true,
      }
    );
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      data,
      cloudConnection: api,
    };
  }

  it('places 云连接 after 云空间 and shows datasource management in that tab', async () => {
    setupDataBridge();
    render(
      <ConfirmDialogProvider>
        <DataViewPage />
      </ConfirmDialogProvider>
    );
    await screen.findByText(t('data.tabs.pipelines'));
    expect(dataTabLabels()).toEqual(expectedDataTabLabels());
    expect(screen.queryByTestId('cloud-connection-panel')).toBeNull();

    useAppStore.getState().navigateToDataTab('cloud_connection');
    await screen.findByTestId('cloud-connection-datasources');
    expect(screen.getByTestId('cloud-connection-panel')).toBeTruthy();
    expect(screen.getByText('本地文件')).toBeTruthy();
    expect(screen.getByText(t('cloudConnection.ds.selectTitle'))).toBeTruthy();
    const active = document.querySelector('[data-fixed-tab][data-state="active"]');
    expect(active?.textContent).toContain(t('data.tabs.cloudConnection'));
    expect(dataTabLabels()).toEqual(expectedDataTabLabels());
  });

  it('keeps the data-view tab bar visible in the empty state', async () => {
    state = makeState({ configured: false, config: null, groups: [] });
    setupDataBridge();
    useAppStore.getState().navigateToDataTab('cloud_connection');
    render(
      <ConfirmDialogProvider>
        <DataViewPage />
      </ConfirmDialogProvider>
    );
    await screen.findByTestId('cloud-connection-open-settings');
    expect(dataTabLabels()).toEqual(expectedDataTabLabels());
    expect(screen.getByText(t('cloudConnection.emptyConfig'))).toBeTruthy();
    const active = document.querySelector('[data-fixed-tab][data-state="active"]');
    expect(active?.textContent).toContain(t('data.tabs.cloudConnection'));
  });
});

describe('云连接：新建原始表并自动引用', () => {
  const createdTable = {
    id: 'raw-new',
    name: '销售日报（合并）',
    groupId: null,
    sourcePath: '/tmp/销售日报',
    sourceKind: 'folder' as const,
    inputConfig: { sourceKind: 'folder' as const },
    fileCount: 1,
    relatedPipelineNames: [],
    tableName: 'tbl_raw-new',
    rowCount: 30,
    columnCount: 3,
    createdAt: 1,
    updatedAt: 1,
  };
  const folderScan = {
    sourcePath: '/tmp/销售日报',
    kind: 'folder' as const,
    name: '销售日报',
    sizeBytes: 100,
    sheets: [],
    files: [
      {
        path: '/tmp/销售日报/1月.csv',
        relativePath: '1月.csv',
        kind: 'csv' as const,
        status: 'ready' as const,
        sheetNames: [],
        usedSheet: null,
        rowCount: 30,
        columns: ['门店', '日期', '销售额'],
      },
    ],
    merge: {
      fileCount: 1,
      rowCount: 30,
      filledColumns: [{ name: '门店', missingInFiles: [] as string[] }],
    },
  };

  function setupWizardBridge() {
    const createRawSource = vi.fn(async () => ({
      source: {
        id: 'src-new',
        name: '销售日报',
        sourcePath: '/tmp/销售日报',
        sourceKind: 'folder' as const,
        buildMode: 'folder_merge' as const,
        config: { autoInclude: true },
        memberIds: [createdTable.id],
        createdAt: 1,
        updatedAt: 1,
      },
      tables: [createdTable],
      skipped: [],
    }));
    const data = new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (prop === 'getDashboard') {
            return vi.fn(async () => ({
              ...EMPTY_DASHBOARD,
              rawTables: [{ id: 'raw-1', name: '销售原始表' }],
              resultTables: [],
            }));
          }
          if (prop === 'getAppConfig') return vi.fn(async () => ({}));
          if (prop === 'scanRawSource') return vi.fn(async () => folderScan);
          if (prop === 'createRawSource') return createRawSource;
          if (prop === 'listRawSources') return vi.fn(async () => []);
          return vi.fn(async () => []);
        },
        has: () => true,
      }
    );
    api.addTableRefs.mockImplementation(async (_groupId?: string, _refs?: unknown) => {
      const table = {
        reportName: createdTable.name,
        kind: 'raw' as const,
        tableId: (Array.isArray(_refs) ? _refs[0]?.tableId : undefined) ?? createdTable.id,
        displayName: createdTable.name,
        status: 'ok' as const,
        rowCount: 30,
        columnCount: 3,
      };
      const current = state.groups[0]!;
      state = makeState({
        groups: [
          {
            ...current,
            tables: [...current.tables, table],
            entries: [
              ...current.entries,
              {
                id: table.reportName,
                kind: 'raw',
                tableId: table.tableId,
                displayName: table.displayName,
                status: 'ok',
              },
            ],
          },
        ],
      });
      return { success: true, state };
    });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      data,
      selectRawTableSource: async () => ({ path: folderScan.sourcePath, kind: 'folder' }),
      cloudConnection: api,
    };
    return { createRawSource };
  }

  async function openCreateRawWizard() {
    render(
      <ConfirmDialogProvider>
        <DataViewPage />
      </ConfirmDialogProvider>
    );
    useAppStore.getState().navigateToDataTab('cloud_connection');
    await screen.findByTestId('cloud-connection-datasources');
    fireEvent.click(await screen.findByText('本地文件'));
    fireEvent.click(screen.getByTestId('cloud-connection-add-table'));
    await screen.findByTestId('cloud-connection-table-picker');
    fireEvent.click(screen.getByTestId('cloud-connection-create-raw-table'));
    await screen.findByTestId('raw-source-wizard');
  }

  it('opens the raw-source wizard from 云连接 and returns to the picker on cancel', async () => {
    setupWizardBridge();
    await openCreateRawWizard();
    expect(screen.queryByTestId('cloud-connection-panel')).toBeNull();
    fireEvent.click(screen.getByText(t('data.rawSources.back')));
    await screen.findByTestId('cloud-connection-panel');
    await screen.findByTestId('cloud-connection-table-picker');
    expect(api.addTableRefs).not.toHaveBeenCalled();
    const active = document.querySelector('[data-fixed-tab][data-state="active"]');
    expect(active?.textContent).toContain(t('data.tabs.cloudConnection'));
  });

  it('binds the created raw table to the selected group and returns to 云连接', async () => {
    const { createRawSource } = setupWizardBridge();
    await openCreateRawWizard();
    fireEvent.click(screen.getByTestId('raw-source-pick-folder'));
    await screen.findByTestId('raw-source-mode-folder_merge');
    fireEvent.click(screen.getByTestId('raw-source-next'));
    fireEvent.click(await screen.findByTestId('raw-source-create'));
    await waitFor(() => expect(createRawSource).toHaveBeenCalled());
    await waitFor(() =>
      expect(api.addTableRefs).toHaveBeenCalledWith('g1', [{ kind: 'raw', tableId: 'raw-new' }])
    );
    await screen.findByTestId('cloud-connection-panel');
    expect(screen.queryByTestId('raw-source-wizard')).toBeNull();
    await screen.findByTestId('cloud-connection-report-name');
    const name = screen.getByTestId('cloud-connection-report-name') as HTMLInputElement;
    expect(name.value).toBe('销售日报（合并）');
    expect(screen.getAllByText('销售日报（合并）').length).toBeGreaterThan(0);
    const active = document.querySelector('[data-fixed-tab][data-state="active"]');
    expect(active?.textContent).toContain(t('data.tabs.cloudConnection'));
  });
});

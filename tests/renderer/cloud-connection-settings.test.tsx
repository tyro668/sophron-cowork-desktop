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
  addTableRefs: vi.fn(ok),
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
    fireEvent.click(screen.getByText('订单'));
    fireEvent.click(screen.getByTestId('cloud-connection-save-table'));
    await waitFor(() =>
      expect(api.addTableRefs).toHaveBeenCalledWith('g1', [{ kind: 'raw', tableId: 'raw-2' }])
    );
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

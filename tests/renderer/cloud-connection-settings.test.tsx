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
  directoryPath: '/data',
  strategy: 1,
  tables: [
    {
      tableName: '销售合并',
      strategy: 5,
      fieldStrategy: 0,
      readStrategy: 0,
      appendStrategy: 0,
      relativeFilePath: '/sales',
      headerRowNumber: 1,
      sheetStrategy: 0,
      sheetNumber: 1,
      sheetName: 'Sheet1',
      hasPassword: true,
    },
  ],
  files: [],
  entries: [
    { id: '销售合并', manual: true },
    { id: 'a.csv', manual: false, fileName: 'a.csv' },
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
  saveTable: vi.fn(ok),
  deleteTable: vi.fn(ok),
  removeLegacyFile: vi.fn(ok),
  refreshTables: vi.fn(ok),
  previewTable: vi.fn(),
  previewDraft: vi.fn(),
  pickDirectory: vi.fn(() => Promise.resolve('/picked')),
  pickTablePath: vi.fn(() => Promise.resolve('/sales/2024')),
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
    expect(screen.getAllByText('销售合并').length).toBeGreaterThan(0);
    expect(screen.getByText('a.csv')).toBeTruthy();
    fireEvent.click(screen.getByText(t('cloudConnection.actions.openSettings')));
    expect(useAppStore.getState().settingsTab).toBe('cloud-connection');
    expect(useAppStore.getState().showSettings).toBe(true);
  });

  it('edits a manual table and keeps the saved password unless changed', async () => {
    render(<CloudConnectionPanel />);
    fireEvent.click(await screen.findByText('销售合并'));
    const form = await screen.findByTestId('cloud-connection-table-form');
    expect(form.textContent).toContain(t('cloudConnection.ds.mergeStrategy'));
    expect(form.textContent).toContain(t('cloudConnection.ds.sheetStrategy'));
    expect((screen.getByTestId('cloud-connection-table-name') as HTMLInputElement).disabled).toBe(
      true
    );
    fireEvent.click(screen.getByTestId('cloud-connection-table-edit'));
    fireEvent.change(screen.getByTestId('cloud-connection-table-name'), {
      target: { value: '销售2024' },
    });
    fireEvent.click(screen.getByTestId('cloud-connection-table-save'));
    await waitFor(() => expect(api.saveTable).toHaveBeenCalled());
    const [groupId, original, input] = api.saveTable.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(groupId).toBe('g1');
    expect(original).toBe('销售合并');
    expect(input).toMatchObject({
      tableName: '销售2024',
      strategy: 5,
      relativeFilePath: '/sales',
      password: undefined,
    });
    expect(input).not.toHaveProperty('hasPassword');
  });

  it('creates a group through 添加数据源', async () => {
    render(<CloudConnectionPanel />);
    fireEvent.click(await screen.findByTestId('cloud-connection-add-group'));
    fireEvent.change(screen.getByTestId('cloud-connection-group-name'), {
      target: { value: '新分组' },
    });
    fireEvent.click(screen.getByLabelText(t('cloudConnection.ds.browse')));
    await waitFor(() => expect(api.pickDirectory).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('cloud-connection-group-save'));
    await waitFor(() =>
      expect(api.addGroup).toHaveBeenCalledWith({
        sourceName: '新分组',
        directoryPath: '/picked',
        strategy: 1,
      })
    );
  });

  it('keeps an existing group name read-only, including while editing', async () => {
    render(<CloudConnectionPanel />);
    const name = (await screen.findByTestId('cloud-connection-group-name')) as HTMLInputElement;
    expect(name.disabled).toBe(true);
    expect(name.value).toBe('本地文件');
    fireEvent.click(screen.getByTestId('cloud-connection-group-edit'));
    expect((screen.getByTestId('cloud-connection-group-name') as HTMLInputElement).disabled).toBe(
      true
    );
    expect(screen.getByTitle(t('cloudConnection.ds.groupNameLocked'))).toBeTruthy();
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
    expect(screen.getAllByText('销售合并').length).toBeGreaterThan(0);
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

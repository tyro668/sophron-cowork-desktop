// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import { useAppStore } from '../../src/renderer/store';
import { CloudAnalysisPanel } from '../../src/renderer/components/data-view/cloud-analysis';

vi.mock('../../src/renderer/components/data-view/raw-tables', () => ({
  RawTablePreviewDialog: () => null,
}));

const listCloudSpaces = vi.fn();
const listCloudProjects = vi.fn();
const listCloudTables = vi.fn();
const listCloudDriveFiles = vi.fn();

beforeEach(() => {
  useAppStore.setState({
    appConfig: {
      ...useAppStore.getState().appConfig,
      personalAnalysis: { apiOrigin: '', apiKey: '' },
    } as NonNullable<ReturnType<typeof useAppStore.getState>['appConfig']>,
    desktopAuthStatus: { authenticated: false, updatedAt: 1 },
  });
  (window as { electronAPI?: unknown }).electronAPI = {
    data: { listCloudSpaces, listCloudProjects, listCloudTables, listCloudDriveFiles },
    auth: { login: vi.fn() },
  };
  listCloudSpaces.mockResolvedValue({ spaces: [{ spaceId: 's1', spaceName: 'Private space' }] });
  listCloudProjects.mockResolvedValue({ projects: [] });
  listCloudTables.mockResolvedValue({
    tables: [],
    page: 1,
    pageSize: 10,
    total: 0,
    hasMore: false,
  });
  listCloudDriveFiles.mockResolvedValue({
    files: [],
    page: 1,
    pageSize: 10,
    total: 0,
    hasMore: false,
  });
});
afterEach(cleanup);

function signIn() {
  act(() =>
    useAppStore.getState().setDesktopAuthStatus({
      authenticated: true,
      apiOrigin: 'https://cloud.example',
      updatedAt: 2,
    })
  );
}
function signOut() {
  act(() => useAppStore.getState().setDesktopAuthStatus({ authenticated: false, updatedAt: 3 }));
}

describe('cloud analysis account gate', () => {
  it('shows login when neither an account nor API key is configured', () => {
    render(createElement(CloudAnalysisPanel));
    expect(listCloudSpaces).not.toHaveBeenCalled();
  });

  it('uses the independent API key configuration while logged out', async () => {
    useAppStore.setState({
      appConfig: {
        ...useAppStore.getState().appConfig,
        personalAnalysis: { apiOrigin: 'https://key.example', apiKey: 'fixed-key' },
      } as NonNullable<ReturnType<typeof useAppStore.getState>['appConfig']>,
    });
    render(createElement(CloudAnalysisPanel));
    await screen.findByText('Private space');
    expect(listCloudSpaces).toHaveBeenCalledWith({
      apiOrigin: 'https://key.example',
      apiKey: 'fixed-key',
      connectionMode: 'apiKey',
    });
    expect(useAppStore.getState().desktopAuthStatus.authenticated).toBe(false);
  });

  it('loads with the account after login and clears cloud content after logout', async () => {
    render(createElement(CloudAnalysisPanel));
    signIn();
    await screen.findByText('Private space');
    expect(listCloudSpaces).toHaveBeenCalledWith({
      apiOrigin: 'https://cloud.example',
      connectionMode: 'account',
    });
    signOut();
    expect(screen.queryByText('Private space')).toBeNull();
    expect(screen.getByText(i18n.t('cloudData.connectTitle'))).toBeTruthy();
    expect(listCloudSpaces).toHaveBeenCalledTimes(1);
    signIn();
    await waitFor(() => expect(listCloudSpaces).toHaveBeenCalledTimes(2));
  });

  it('reloads under the account and changes the mode badge when the key disconnects', async () => {
    signIn();
    const config = {
      ...useAppStore.getState().appConfig,
      personalAnalysis: { apiOrigin: 'https://key.example', apiKey: 'fixed-key', updatedAt: 1 },
    } as NonNullable<ReturnType<typeof useAppStore.getState>['appConfig']>;
    useAppStore.setState({ appConfig: config });
    listCloudSpaces
      .mockResolvedValueOnce({ spaces: [{ spaceId: 'api', spaceName: 'API private space' }] })
      .mockResolvedValueOnce({
        spaces: [{ spaceId: 'account', spaceName: 'Account private space' }],
      });
    render(createElement(CloudAnalysisPanel));
    await screen.findByText('API private space');
    expect(screen.getByText(i18n.t('cloudData.apiModeBadge'))).toBeTruthy();
    act(() =>
      useAppStore.setState({
        appConfig: {
          ...config,
          personalAnalysis: {
            ...config.personalAnalysis,
            connectionStatus: 'disconnected',
            updatedAt: 2,
          },
        },
      })
    );
    await screen.findByText('Account private space');
    expect(screen.queryByText('API private space')).toBeNull();
    expect(screen.getByText(i18n.t('cloudData.accountModeBadge'))).toBeTruthy();
    expect(listCloudSpaces).toHaveBeenLastCalledWith({
      apiOrigin: 'https://cloud.example',
      connectionMode: 'account',
    });
  });

  it('shows the login page when the key disconnects and no account is logged in', async () => {
    const config = {
      ...useAppStore.getState().appConfig,
      personalAnalysis: { apiOrigin: 'https://key.example', apiKey: 'fixed-key', updatedAt: 1 },
    } as NonNullable<ReturnType<typeof useAppStore.getState>['appConfig']>;
    useAppStore.setState({ appConfig: config });
    render(createElement(CloudAnalysisPanel));
    await screen.findByText('Private space');
    act(() =>
      useAppStore.setState({
        appConfig: {
          ...config,
          personalAnalysis: { ...config.personalAnalysis, connectionStatus: 'disconnected' },
        },
      })
    );
    expect(screen.queryByText('Private space')).toBeNull();
    expect(screen.getByText(i18n.t('cloudData.connectTitle'))).toBeTruthy();
    expect(listCloudSpaces).toHaveBeenCalledTimes(1);
  });

  it('replaces cloud content when the account server disconnects and recovers on retry', async () => {
    signIn();
    render(createElement(CloudAnalysisPanel));
    await screen.findByText('Private space');
    const online = useAppStore.getState().desktopAuthStatus;
    act(() =>
      useAppStore.getState().setDesktopAuthStatus({ ...online, connectionStatus: 'disconnected' })
    );
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('cloudData.serverUnavailable'));
    expect(screen.queryByText('Private space')).toBeNull();
    (
      window as unknown as { electronAPI: { auth: { getStatus: unknown } } }
    ).electronAPI.auth.getStatus = vi
      .fn()
      .mockResolvedValue({ ...online, connectionStatus: 'connected' });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('cloudData.retryConnection') }));
    await screen.findByText('Private space');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(listCloudSpaces).toHaveBeenCalledTimes(2);
  });

  it('shows the server error page when catalog loading fails over the network', async () => {
    signIn();
    listCloudSpaces.mockRejectedValueOnce(new Error('fetch failed'));
    render(createElement(CloudAnalysisPanel));
    await screen.findByRole('alert');
    expect(useAppStore.getState().desktopAuthStatus).toMatchObject({
      authenticated: true,
      connectionStatus: 'disconnected',
    });
  });

  it('ignores a pending catalog response after logout', async () => {
    let resolve!: (value: unknown) => void;
    listCloudSpaces.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    signIn();
    render(createElement(CloudAnalysisPanel));
    signOut();
    await act(async () => resolve({ spaces: [{ spaceId: 's1', spaceName: 'Stale space' }] }));
    expect(screen.queryByText('Stale space')).toBeNull();
    expect(listCloudProjects).not.toHaveBeenCalled();
    expect(listCloudSpaces).toHaveBeenCalledTimes(1);
  });

  it('uses unified h-12 flush pane header and DataListTable when a project is selected', async () => {
    listCloudProjects.mockResolvedValue({
      projects: [{ projectId: 'p1', projectName: '经营分析项目' }],
    });
    listCloudTables.mockResolvedValue({
      tables: [
        {
          tableId: 't1',
          tableName: '月度销售表',
          kind: 'analysis',
          rowCount: 120,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      page: 1,
      pageSize: 10,
      total: 1,
      hasMore: false,
    });
    signIn();
    render(createElement(CloudAnalysisPanel));

    await screen.findByText('Private space');
    const leftHeader = screen.getByTestId('cloud-space-tree-header');
    const rightHeader = screen.getByTestId('cloud-content-header');
    expect(leftHeader.className).toContain('h-12');
    expect(rightHeader.className).toContain('h-12');
    expect(screen.queryByTestId('cloud-analysis-preview')).toBeNull();

    fireEvent.click(screen.getByText('Private space'));
    fireEvent.click(await screen.findByText('经营分析项目'));

    expect(rightHeader.textContent).toContain('经营分析项目');
    expect(screen.getByTestId('cloud-analysis-preview')).toBeTruthy();
    expect(screen.getByTestId('cloud-analysis-batch-select')).toBeTruthy();

    const listShell = await screen.findByTestId('cloud-table-list-table');
    expect(listShell.querySelector('table')?.className).toContain('data-list-table-fill');
    expect(screen.getByTestId('data-list-filler')).toBeTruthy();
    expect(screen.getByText('月度销售表')).toBeTruthy();
  });
});

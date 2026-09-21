// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './i18n-test';
import { useAppStore } from '../../src/renderer/store';
import { CloudAnalysisPanel } from '../../src/renderer/components/data-view/cloud-analysis';

vi.mock('../../src/renderer/components/data-view/input-tables', () => ({
  InputTablePreviewDialog: () => null,
}));

const listCloudSpaces = vi.fn();
const listCloudProjects = vi.fn();

beforeEach(() => {
  useAppStore.setState({
    appConfig: {
      ...useAppStore.getState().appConfig,
      personalAnalysis: { apiOrigin: 'https://cloud.example', apiKey: 'saved-key' },
    } as NonNullable<ReturnType<typeof useAppStore.getState>['appConfig']>,
    desktopAuthStatus: { authenticated: false, updatedAt: 1 },
  });
  (window as { electronAPI?: unknown }).electronAPI = {
    data: { listCloudSpaces, listCloudProjects },
    auth: { login: vi.fn() },
  };
  listCloudSpaces.mockResolvedValue({ spaces: [{ spaceId: 's1', spaceName: 'Private space' }] });
  listCloudProjects.mockResolvedValue({ projects: [] });
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
  it('does not request cloud data with a saved key while logged out', () => {
    render(createElement(CloudAnalysisPanel));
    expect(screen.getByText('Sign in to access cloud analysis spaces')).toBeTruthy();
    expect(listCloudSpaces).not.toHaveBeenCalled();
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
    expect(screen.getByText('Sign in to access cloud analysis spaces')).toBeTruthy();
    expect(listCloudSpaces).toHaveBeenCalledTimes(1);
    signIn();
    await waitFor(() => expect(listCloudSpaces).toHaveBeenCalledTimes(2));
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
});

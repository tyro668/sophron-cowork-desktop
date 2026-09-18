// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ElectronApi } from '../../shared/contracts/electron-api';
import type { PairingRequest, PairedUser } from '../../shared/contracts/remote';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);

it('opens the approval page from the pending notice and moves an approved request to authorized users', async () => {
  const request: PairingRequest = {
    channelType: 'feishu',
    userId: 'test-user',
    userName: 'Test user',
    code: '12345678',
    createdAt: Date.now(),
    expiresAt: Date.now() + 600000,
  };
  let pending = [request];
  const paired: PairedUser[] = [];
  const approvePairing = vi.fn(async (channelType, userId) => {
    pending = [];
    paired.push({
      channelType,
      userId,
      userName: request.userName,
      pairedAt: Date.now(),
      lastActiveAt: Date.now(),
    });
    return { success: true };
  });
  (window as unknown as { electronAPI: ElectronApi }).electronAPI = {
    remote: {
      getConfig: async () => null,
      getStatus: async () => ({
        running: true,
        channels: [],
        activeSessions: 0,
        pendingPairings: pending.length,
      }),
      getPendingPairings: async () => pending,
      getPairedUsers: async () => [...paired],
      getTunnelStatus: async () => ({ connected: false, url: null, provider: 'none' }),
      getWebhookUrl: async () => null,
      approvePairing,
    },
  } as unknown as ElectronApi;
  const { RemoteControlPanel } = await import('../../renderer/components/RemoteControlPanel');
  const view = render(React.createElement(RemoteControlPanel, { isActive: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'remote.reviewPairings' }));
  expect(screen.getByText(request.code)).toBeTruthy();
  expect(screen.getByText(request.userId)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'remote.approve' }));
  await waitFor(() => expect(approvePairing).toHaveBeenCalledWith('feishu', 'test-user'));
  await screen.findByText('remote.pairingApproved');
  expect(screen.queryByText(request.code)).toBeNull();
  expect(screen.getByText('Test user')).toBeTruthy();
  expect(screen.getByText('remote.authorizedUsersReady')).toBeTruthy();
  expect(screen.queryByText('remote.pairingGuideTitle')).toBeNull();
  expect(screen.queryByText('remote.noPendingPairings')).toBeNull();
  expect(screen.queryByText('remote.waitingForPairing')).toBeNull();

  // The completed state must also survive reopening settings, after the toast disappears.
  view.unmount();
  render(React.createElement(RemoteControlPanel, { isActive: true }));
  fireEvent.click(await screen.findByRole('tab', { name: 'remote.navUsers' }));
  expect(screen.getByText('remote.authorizedUsersReady')).toBeTruthy();
  expect(screen.getByText('Test user')).toBeTruthy();
  expect(screen.queryByText('remote.pairingGuideTitle')).toBeNull();
  expect(screen.queryByText('remote.noPendingPairings')).toBeNull();
});

// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QrSetupDialog } from '../../renderer/components/remote/QrSetupDialog';
import type { ElectronApi } from '../../shared/contracts/electron-api';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const beginQrSetup = vi.fn(async (id: string) => ({
    id,
    status: 'waiting',
    qrCodeDataUrl: 'data:image/png;base64,qr',
  }));
  const cancelQrSetup = vi.fn(async () => {});
  const getQrSetup = vi.fn();
  (window as unknown as { electronAPI: ElectronApi }).electronAPI = {
    remote: { beginQrSetup, cancelQrSetup, getQrSetup },
  } as unknown as ElectronApi;
  const completed = vi.fn();
  const view = render(
    React.createElement(QrSetupDialog, {
      channel: 'feishu',
      onClose: vi.fn(),
      onManual: vi.fn(),
      onCompleted: completed,
    })
  );
  return { ...view, beginQrSetup, cancelQrSetup, getQrSetup, completed };
}

describe('QR setup dialog', () => {
  it('refreshes with a new attempt and cancels both obsolete and unmounted attempts', async () => {
    const h = setup();
    await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());
    const first = h.beginQrSetup.mock.calls[0][0];
    fireEvent.click(screen.getByText('remote.qr.refresh'));
    await waitFor(() => expect(h.beginQrSetup).toHaveBeenCalledTimes(2));
    const second = h.beginQrSetup.mock.calls[1][0];
    expect(first).not.toBe(second);
    expect(h.cancelQrSetup).toHaveBeenCalledWith(first);
    h.unmount();
    expect(h.cancelQrSetup).toHaveBeenCalledWith(second);
  });

  it('shows completion after polling and refreshes configuration only once', async () => {
    const h = setup();
    await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());
    h.getQrSetup.mockResolvedValue({ id: h.beginQrSetup.mock.calls[0][0], status: 'completed' });
    await waitFor(() => expect(screen.getByText('remote.qr.status.completed')).toBeTruthy(), {
      timeout: 2000,
    });
    expect(h.completed).toHaveBeenCalledOnce();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('does not render a late QR after unmount', async () => {
    let resolve!: (state: unknown) => void;
    const beginQrSetup = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const cancelQrSetup = vi.fn(async () => {});
    (window as unknown as { electronAPI: ElectronApi }).electronAPI = {
      remote: { beginQrSetup, cancelQrSetup },
    } as unknown as ElectronApi;
    const completed = vi.fn();
    const view = render(
      React.createElement(QrSetupDialog, {
        channel: 'wechat',
        onClose: vi.fn(),
        onManual: vi.fn(),
        onCompleted: completed,
      })
    );
    view.unmount();
    await act(async () => resolve({ id: 'late', status: 'completed' }));
    expect(completed).not.toHaveBeenCalled();
    expect(cancelQrSetup).toHaveBeenCalledOnce();
  });
});

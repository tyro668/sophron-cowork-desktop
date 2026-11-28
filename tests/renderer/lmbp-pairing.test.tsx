// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { LmbpPairingStatus } from '../../src/shared/contracts';
import { API_PROVIDER_PRESETS } from '../../src/shared/api-model-presets';
import './i18n-test';

it('pairs Avora from the API form, collapses pairing controls after pairing, and re-opens on re-pair', async () => {
  const model = 'dev_fixture/work/demo';
  const status: LmbpPairingStatus = {
    link: 'lmbp://pair?v=2&gateway=http%3A%2F%2F127.0.0.1%3A1234&tenant=sophron',
    devices: [],
    models: [],
  };
  const approve = vi.fn(async () => {
    status.devices = [{ id: 'dev_fixture', name: 'Test Avora', online: true }];
    status.models = [{ id: model, name: 'Demo', capabilities: [] }];
  });
  const revoke = vi.fn(async () => {
    status.devices = [];
    status.models = [];
  });
  const testConnection = vi.fn(async () => ({ ok: true }));
  const onSave = vi.fn(async () => {});
  vi.stubGlobal('electronAPI', {
    config: {
      getPresets: async () => API_PROVIDER_PRESETS,
      get: async () => null,
      getLmbpStatus: async () => structuredClone(status),
      approveLmbpPairing: approve,
      revokeLmbpDevice: revoke,
      test: testConnection,
    },
  });
  const { ConfigModal } = await import('../../src/renderer/components/ConfigModal');
  const { ConfirmDialogProvider } = await import('../../src/renderer/components/ConfirmDialog');
  const form = render(
    <ConfirmDialogProvider>
      <ConfigModal isOpen onClose={() => {}} onSave={onSave} />
    </ConfirmDialogProvider>
  );
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Avora (LMBP)' }));
    const code = await screen.findByRole('textbox', { name: /pairing code/i });
    fireEvent.change(code, { target: { value: 'abcd-efgh' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm pairing/i }));
    await screen.findByText('Test Avora');
    expect(approve).toHaveBeenCalledWith('ABCD-EFGH');
    await screen.findByText('Demo');

    // Pairing link and pairing code inputs collapse once a device is paired.
    expect(screen.queryByRole('textbox', { name: /pairing code/i })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /pairing link/i })).toBeNull();

    // Clicking Re-pair reveals the pairing inputs again, and Cancel collapses them.
    fireEvent.click(screen.getByRole('button', { name: /re-pair/i }));
    expect(await screen.findByRole('textbox', { name: /pairing code/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /pairing link/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('textbox', { name: /pairing code/i })).toBeNull();

    expect(document.querySelector('input[type=password], input[type=url]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() =>
      expect(testConnection).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'lmbp', model, apiKey: '' })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'lmbp',
          model,
          apiKey: '',
          profiles: expect.objectContaining({
            lmbp: expect.objectContaining({ model, apiKey: '', baseUrl: undefined }),
          }),
        })
      )
    );

    // Revoking the last paired device automatically restores the pairing inputs.
    fireEvent.click(screen.getByRole('button', { name: /unpair/i }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('dev_fixture'));
    expect(await screen.findByRole('textbox', { name: /pairing code/i })).toBeTruthy();
  } finally {
    form.unmount();
    vi.unstubAllGlobals();
  }
});

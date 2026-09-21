import { beforeEach, describe, expect, it, vi } from 'vitest';
const { configStore, sendToRenderer } = vi.hoisted(() => ({
  configStore: { get: vi.fn(), set: vi.fn(), isConfigured: vi.fn(() => true), getAll: vi.fn() },
  sendToRenderer: vi.fn(),
}));
vi.mock('../src/main/config/config-store', () => ({ configStore }));
vi.mock('../src/main/app/events', () => ({ sendToRenderer }));
import { markPersonalAnalysisKeyDisconnected } from '../src/main/features/data/cloud-connection-state';
const config = { apiOrigin: 'https://key.example', apiKey: 'fixed-key', updatedAt: 1 };
beforeEach(() => configStore.get.mockReturnValue(config));
describe('rejected API key state', () => {
  it('persists disconnected without deleting the key and notifies the renderer', () => {
    markPersonalAnalysisKeyDisconnected(config);
    expect(configStore.set).toHaveBeenCalledWith(
      'personalAnalysis',
      expect.objectContaining({
        ...config,
        updatedAt: expect.any(Number),
        connectionStatus: 'disconnected',
      })
    );
    expect(sendToRenderer).toHaveBeenCalledWith(expect.objectContaining({ type: 'config.status' }));
  });
  it('does not invalidate a newer saved connection after an old request fails', () => {
    configStore.get.mockReturnValue({ ...config, updatedAt: 2 });
    markPersonalAnalysisKeyDisconnected(config);
    expect(configStore.set).not.toHaveBeenCalled();
    expect(sendToRenderer).not.toHaveBeenCalled();
  });
  it('does not repeatedly emit state changes for concurrent failures', () => {
    configStore.get.mockReturnValue({ ...config, connectionStatus: 'disconnected' });
    markPersonalAnalysisKeyDisconnected(config);
    expect(configStore.set).not.toHaveBeenCalled();
  });
});

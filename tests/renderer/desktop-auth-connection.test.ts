// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../src/renderer/store';
import { useDesktopAuthConnection } from '../../src/renderer/hooks/useDesktopAuthConnection';
const online = { authenticated: true, connectionStatus: 'connected' as const, updatedAt: 1 };
const getStatus = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState({ desktopAuthStatus: online });
  (window as { electronAPI?: unknown }).electronAPI = { auth: { getStatus } };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('desktop server reachability polling', () => {
  it('detects an outage while idle and reconnects on focus', async () => {
    getStatus
      .mockResolvedValueOnce(online)
      .mockResolvedValueOnce({ ...online, connectionStatus: 'disconnected' })
      .mockResolvedValueOnce(online);
    renderHook(() => useDesktopAuthConnection(true));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(useAppStore.getState().desktopAuthStatus.connectionStatus).toBe('disconnected');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(useAppStore.getState().desktopAuthStatus.connectionStatus).toBe('connected');
  });
  it('does not restore login after logout while a probe is in flight', async () => {
    let resolve!: (value: unknown) => void;
    getStatus.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    renderHook(() => useDesktopAuthConnection(true));
    act(() => useAppStore.getState().setDesktopAuthStatus({ authenticated: false, updatedAt: 2 }));
    await act(async () => resolve(online));
    expect(useAppStore.getState().desktopAuthStatus.authenticated).toBe(false);
  });
  it('does not overlap probes and stops polling when unmounted', async () => {
    getStatus.mockReturnValue(new Promise(() => {}));
    const view = renderHook(() => useDesktopAuthConnection(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(getStatus).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

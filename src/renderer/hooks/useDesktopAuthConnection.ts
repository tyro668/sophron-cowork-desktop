import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store';

/** Refresh reachability while preserving the signed-in identity during outages. */
export function useDesktopAuthConnection(enabled: boolean) {
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled || !window.electronAPI?.auth || inFlight.current) return;
    const before = useAppStore.getState().desktopAuthStatus;
    inFlight.current = true;
    try {
      const status = await window.electronAPI.auth.getStatus();
      if (useAppStore.getState().desktopAuthStatus === before) {
        useAppStore.getState().setDesktopAuthStatus(status);
      }
    } catch {
      if (before.authenticated && useAppStore.getState().desktopAuthStatus === before) {
        useAppStore
          .getState()
          .setDesktopAuthStatus({ ...before, connectionStatus: 'disconnected' });
      }
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    if (!enabled) return;
    const poll = () => {
      if (useAppStore.getState().desktopAuthStatus.authenticated) void refresh();
    };
    const timer = window.setInterval(poll, 15_000);
    window.addEventListener('focus', poll);
    window.addEventListener('online', poll);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', poll);
      window.removeEventListener('online', poll);
    };
  }, [enabled, refresh]);
  return refresh;
}

import type { StoreApi, UseBoundStore } from 'zustand';
import type { AppState } from './types';

/** Expose navigation helpers for CLI-driven UI navigation via executeJavaScript. */
export function installWindowNavBridge(store: UseBoundStore<StoreApi<AppState>>): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;

  w.__getNavStatus = () => {
    const s = store.getState();
    return {
      showSettings: !!s.showSettings,
      mainView: s.mainView,
      activeSessionId: s.activeSessionId || null,
      sessionCount: (s.sessions || []).length,
    };
  };

  w.__navigate = (page: string, tab?: string, sessionId?: string) => {
    const state = store.getState();
    if (page === 'welcome') {
      state.setShowSettings(false);
      state.setMainView('chat');
      state.setActiveSession(null);
    } else if (page === 'data') {
      state.setShowSettings(false);
      state.setMainView('data');
      state.setActiveSession(null);
    } else if (page === 'cloud-data') {
      state.navigateToCloudData();
    } else if (page === 'skills') {
      state.setShowSettings(false);
      state.setMainView('skills');
      state.setActiveSession(null);
    } else if (page === 'automation') {
      state.setShowSettings(false);
      state.setMainView('automation');
      state.setActiveSession(null);
    } else if (page === 'settings') {
      state.setSettingsTab(tab || 'api');
      state.setShowSettings(true);
    } else if (page === 'session') {
      if (!sessionId || typeof sessionId !== 'string') return false;
      const exists = state.sessions.some((s) => s.id === sessionId);
      if (!exists) return false;
      state.setShowSettings(false);
      state.setMainView('chat');
      state.setActiveSession(sessionId);
    }
    return true;
  };
}

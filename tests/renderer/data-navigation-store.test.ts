// @vitest-environment happy-dom
/**
 * Behavior tests for the app store's data-navigation slice: main-view routing,
 * nonce-guarded pending navigation, and nonce-aware clearing. These replace
 * the former source-string assertions in main-view-navigation.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../src/renderer/store';

function resetNavState() {
  useAppStore.setState({
    mainView: 'chat',
    showSettings: false,
    pendingDataNavigation: null,
    pendingDataTabNavigation: null,
  });
}

describe('data navigation store', () => {
  beforeEach(resetNavState);

  it('switches the main view via setMainView', () => {
    const store = useAppStore.getState();
    expect(useAppStore.getState().mainView).toBe('chat');

    store.setMainView('data');
    expect(useAppStore.getState().mainView).toBe('data');

    store.setMainView('skills');
    expect(useAppStore.getState().mainView).toBe('skills');
  });

  it('routes a data element link to the data view with an incrementing nonce', () => {
    const store = useAppStore.getState();
    store.setMainView('chat');
    useAppStore.setState({ showSettings: true });

    store.navigateToDataElement({ kind: 'task', id: 'task_1' });
    const first = useAppStore.getState().pendingDataNavigation;
    expect(useAppStore.getState().mainView).toBe('data');
    expect(useAppStore.getState().showSettings).toBe(false);
    expect(first).toMatchObject({ kind: 'task', id: 'task_1' });

    store.navigateToDataElement({ kind: 'output_table', id: 'out_1' });
    const second = useAppStore.getState().pendingDataNavigation;
    expect(second).toMatchObject({ kind: 'output_table', id: 'out_1' });
    expect(second!.nonce).toBeGreaterThan(first!.nonce);
  });

  it('clears data navigation only when the nonce matches', () => {
    const store = useAppStore.getState();
    store.navigateToDataElement({ kind: 'task', id: 'task_1' });
    const { nonce } = useAppStore.getState().pendingDataNavigation!;

    // A stale nonce (from an older, already-consumed navigation) must not
    // clear the newer pending target.
    store.clearDataNavigation(nonce - 1);
    expect(useAppStore.getState().pendingDataNavigation).not.toBeNull();

    store.clearDataNavigation(nonce);
    expect(useAppStore.getState().pendingDataNavigation).toBeNull();
  });

  it('handles nav-server page aliases through window.__navigate', () => {
    const w = window as unknown as {
      __navigate?: (page: string, tab?: string, sessionId?: string) => boolean | void;
    };
    expect(typeof w.__navigate).toBe('function');

    w.__navigate!('data');
    expect(useAppStore.getState().mainView).toBe('data');

    w.__navigate!('skills');
    expect(useAppStore.getState().mainView).toBe('skills');

    w.__navigate!('cloud-data');
    expect(useAppStore.getState().pendingDataTabNavigation?.tab).toBe('cloud_analysis');

    // Unknown session ids are rejected without disturbing navigation state.
    expect(w.__navigate!('session', undefined, 'missing_session')).toBe(false);
    expect(useAppStore.getState().mainView).toBe('data');
  });

  it('routes tab navigation through pendingDataTabNavigation', () => {
    const store = useAppStore.getState();
    useAppStore.setState({ activeSessionId: 'session_1' });

    store.navigateToDataTab('output_tables');
    const state = useAppStore.getState();
    expect(state.mainView).toBe('data');
    expect(state.activeSessionId).toBeNull();
    expect(state.pendingDataTabNavigation).toMatchObject({ tab: 'output_tables' });

    store.clearDataTabNavigation(state.pendingDataTabNavigation!.nonce);
    expect(useAppStore.getState().pendingDataTabNavigation).toBeNull();
  });
});

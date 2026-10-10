import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../src/renderer/store';

const SESSION_ID = 'activity-session';

describe('live pipeline activity state', () => {
  beforeEach(() => {
    useAppStore.setState({ sessionStates: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores the latest tool snapshot and clears it after the tool finishes', () => {
    const store = useAppStore.getState();
    store.setLiveToolOutput(SESSION_ID, 'tool-1', {
      text: 'building 12/20',
      truncated: false,
      updatedAt: 1_000,
    });
    store.setLiveToolOutput(SESSION_ID, 'tool-1', {
      text: 'building 20/20',
      truncated: false,
      updatedAt: 2_000,
    });

    expect(useAppStore.getState().sessionStates[SESSION_ID].liveToolOutputs['tool-1'].text).toBe(
      'building 20/20'
    );
    expect(useAppStore.getState().sessionStates[SESSION_ID].lastActivityAt).toBe(2_000);

    store.clearLiveToolOutput(SESSION_ID, 'tool-1');
    expect(useAppStore.getState().sessionStates[SESSION_ID].liveToolOutputs).toEqual({});
  });

  it('preserves current output when another prompt is queued', () => {
    const store = useAppStore.getState();
    store.addMessage(SESSION_ID, {
      id: 'message-1',
      sessionId: SESSION_ID,
      role: 'user',
      content: [{ type: 'text', text: 'first prompt' }],
      timestamp: 1_000,
    });
    store.activateNextTurn(SESSION_ID, 'turn-1');
    store.setLiveToolOutput(SESSION_ID, 'tool-1', {
      text: 'current run',
      truncated: false,
      updatedAt: 2_000,
    });
    store.startExecutionClock(SESSION_ID, 3_000);

    expect(useAppStore.getState().sessionStates[SESSION_ID].liveToolOutputs['tool-1'].text).toBe(
      'current run'
    );
    expect(useAppStore.getState().sessionStates[SESSION_ID].executionClock.startAt).not.toBe(3_000);

    store.clearActiveTurn(SESSION_ID, 'turn-1');
    expect(useAppStore.getState().sessionStates[SESSION_ID].liveToolOutputs).toEqual({});
  });

  it('starts a fresh timer when a queued turn actually activates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const store = useAppStore.getState();
    store.addMessage(SESSION_ID, {
      id: 'message-1',
      sessionId: SESSION_ID,
      role: 'user',
      content: [{ type: 'text', text: 'first prompt' }],
      timestamp: 1_000,
    });
    store.activateNextTurn(SESSION_ID, 'turn-1');

    vi.setSystemTime(2_000);
    store.addMessage(SESSION_ID, {
      id: 'message-2',
      sessionId: SESSION_ID,
      role: 'user',
      content: [{ type: 'text', text: 'queued prompt' }],
      timestamp: 2_000,
      localStatus: 'queued',
    });
    store.startExecutionClock(SESSION_ID, 2_000);
    expect(useAppStore.getState().sessionStates[SESSION_ID].executionClock.startAt).toBe(1_000);

    vi.setSystemTime(3_500);
    store.clearActiveTurn(SESSION_ID, 'turn-1');
    store.activateNextTurn(SESSION_ID, 'turn-2');
    const next = useAppStore.getState().sessionStates[SESSION_ID];
    expect(next.activeTurn?.userMessageId).toBe('message-2');
    expect(next.executionClock).toEqual({ startAt: 3_500, endAt: null });
  });
});

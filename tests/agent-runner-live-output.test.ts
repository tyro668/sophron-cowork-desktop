import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent';
import {
  AgentRunEventBridge,
  type AgentRunBridgeDeps,
} from '../src/main/agent/agent-runner-event-bridge';

describe('AgentRunEventBridge live tool output', () => {
  let bridge: AgentRunEventBridge | undefined;

  afterEach(() => {
    if (bridge?.activityTimeoutId) clearTimeout(bridge.activityTimeoutId);
    vi.useRealTimers();
  });

  it('forwards bounded cumulative snapshots and throttles rapid updates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    let onEvent: ((event: AgentSessionEvent) => void) | undefined;
    const sendToRenderer = vi.fn();
    const deps = {
      session: { id: 'session-1' },
      piSession: {
        subscribe(callback: (event: AgentSessionEvent) => void) {
          onEvent = callback;
          return () => {};
        },
      },
      controller: new AbortController(),
      provider: 'openai',
      sendToRenderer,
    } as unknown as AgentRunBridgeDeps;
    bridge = new AgentRunEventBridge(deps);
    bridge.subscribe();

    const update = (text: string) =>
      onEvent?.({
        type: 'tool_execution_update',
        toolCallId: 'tool-1',
        toolName: 'bash',
        args: {},
        partialResult: { content: [{ type: 'text', text }] },
      } as AgentSessionEvent);

    update('line 1');
    expect(sendToRenderer).toHaveBeenCalledWith({
      type: 'stream.toolOutput',
      payload: {
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        text: 'line 1',
        truncated: false,
        timestamp: 1_000,
      },
    });

    vi.setSystemTime(1_050);
    update('line 1\nline 2');
    expect(sendToRenderer).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_150);
    update('line 1\nline 2\nline 3');
    expect(sendToRenderer).toHaveBeenCalledTimes(2);
    expect(sendToRenderer.mock.lastCall?.[0].payload.text).toBe('line 1\nline 2\nline 3');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
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
  it('tracks argument generation, flushes the final input, and switches to execution', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    let onEvent: (event: AgentSessionEvent) => void = () => {};
    const sendTraceUpdate = vi.fn();
    const sendTraceStep = vi.fn();
    const deps = {
      session: { id: 'session-1' },
      piSession: {
        subscribe(callback: typeof onEvent) {
          onEvent = callback;
          return () => {};
        },
      },
      controller: new AbortController(),
      provider: 'openai',
      thinkingStepId: 'thinking-1',
      turnId: 'turn-1',
      evaluationMetrics: { toolCallCount: 0 },
      seenToolCallIds: new Set(),
      toolStartedAt: new Map(),
      getToolDisplayName: (name: string) => name,
      sendTraceStep,
      sendTraceUpdate,
    } as unknown as AgentRunBridgeDeps;
    bridge = new AgentRunEventBridge(deps);
    bridge.subscribe();
    const stream = (type: string, content: string) => {
      const tool = {
        type: 'toolCall',
        id: 'tool-1',
        name: 'write',
        arguments: { path: 'test.txt', content, password: 'secret-value' },
      };
      onEvent({
        type: 'message_update',
        assistantMessageEvent: {
          type,
          contentIndex: 0,
          delta: content,
          partial: { content: [tool] },
          toolCall: tool,
        },
      } as unknown as AgentSessionEvent);
    };
    stream('toolcall_start', '');
    expect(sendTraceStep.mock.lastCall?.[1].toolPhase).toBe('preparing');
    stream('toolcall_delta', 'hello');
    const first = sendTraceUpdate.mock.lastCall?.[2];
    expect(first.toolPhase).toBe('preparing');
    expect(first.toolInputPreview.text).toContain('hello');
    expect(first.toolInputPreview.text).not.toContain('secret-value');
    const count = sendTraceUpdate.mock.calls.length;
    vi.setSystemTime(1_050);
    stream('toolcall_delta', 'hello again');
    expect(sendTraceUpdate).toHaveBeenCalledTimes(count);
    vi.setSystemTime(61_000);
    stream('toolcall_delta', 'hello again');
    expect(sendTraceUpdate).toHaveBeenCalledTimes(count + 1);
    // Activity still advances when the visible preview does not change.
    vi.setSystemTime(62_000);
    stream('toolcall_delta', 'hello again');
    expect(sendTraceUpdate).toHaveBeenCalledTimes(count + 2);
    vi.setSystemTime(62_010);
    stream('toolcall_end', 'finished');
    expect(sendTraceUpdate.mock.lastCall?.[2]).toMatchObject({
      toolPhase: 'ready',
      toolInputPreview: { text: expect.stringContaining('finished') },
    });
    onEvent({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'write',
      args: { content: 'finished' },
    } as AgentSessionEvent);
    expect(sendTraceUpdate.mock.lastCall?.[2]).toMatchObject({
      toolPhase: 'executing',
      toolInputPreview: undefined,
    });
    deps.controller.abort();
    const beforeAbort = sendTraceUpdate.mock.calls.length;
    stream('toolcall_delta', 'ignored');
    expect(sendTraceUpdate).toHaveBeenCalledTimes(beforeAbort);
  });
});

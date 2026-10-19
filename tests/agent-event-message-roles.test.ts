import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import {
  AgentRunEventBridge,
  type AgentRunBridgeDeps,
} from '../src/main/agent/agent-runner-event-bridge';

const bridges: AgentRunEventBridge[] = [];
afterEach(() => {
  for (const bridge of bridges.splice(0)) clearTimeout(bridge.activityTimeoutId);
});

function harness() {
  let onEvent!: (event: AgentSessionEvent) => void;
  const sendMessage = vi.fn();
  const bridge = new AgentRunEventBridge({
    session: { id: 'session' },
    provider: 'openai',
    piModel: {},
    piSession: {
      subscribe(callback: typeof onEvent) {
        onEvent = callback;
        return () => {};
      },
    },
    controller: new AbortController(),
    modelClock: {},
    evaluationMetrics: { modelCallCount: 0, toolDurationMs: 0, toolErrorCount: 0 },
    toolStartedAt: new Map(),
    getToolDisplayName: (name: string) => name,
    sendMessage,
    sendToRenderer: vi.fn(),
    sendTraceUpdate: vi.fn(),
    sendTraceStep: vi.fn(),
    sanitizeOutputPaths: (text: string) => text,
  } as unknown as AgentRunBridgeDeps);
  bridges.push(bridge);
  bridge.subscribe();
  return { bridge, sendMessage, emit: (event: unknown) => onEvent(event as AgentSessionEvent) };
}

describe('SDK message role routing', () => {
  it('persists structured task completion only for successful generation tools', () => {
    const { emit, sendMessage } = harness();
    const completion = { requestId: 'request', result: { taskId: 'task' } };
    const event = {
      type: 'tool_execution_end',
      toolCallId: 'tool',
      toolName: 'data_generate_pipeline_from_requirement',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'Saved' }],
        details: { dataPipelineCompletion: completion },
      },
    };
    emit(event);
    expect(sendMessage.mock.calls.at(-1)?.[1].content[0].dataPipelineCompletion).toEqual(
      completion
    );
    emit({ ...event, isError: true });
    expect(sendMessage.mock.calls.at(-1)?.[1].content[0].dataPipelineCompletion).toBeUndefined();
    emit({ ...event, toolName: 'other_tool' });
    expect(sendMessage.mock.calls.at(-1)?.[1].content[0].dataPipelineCompletion).toBeUndefined();
  });

  it.each([
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
    { role: 'toolResult', content: [] },
  ])('ignores $role lifecycle events without consuming assistant buffers', (message) => {
    const { bridge, sendMessage, emit } = harness();
    bridge.streamedText = 'in progress';
    emit({ type: 'message_end', message });
    expect(bridge.streamedText).toBe('in progress');
    expect(bridge.terminalErrorText).toBeUndefined();
    expect(bridge.hasEmittedError).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('surfaces the real authentication failure after a system message', () => {
    const { bridge, sendMessage, emit } = harness();
    emit({ type: 'message_end', message: { role: 'system', content: 'System prompt' } });
    emit({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'OAuth auth derivation failed: missing module',
      },
    });
    // The error bubble waits for agent_end so a retried attempt never shows one.
    expect(sendMessage).not.toHaveBeenCalled();
    emit({ type: 'agent_end', messages: [], willRetry: false });
    expect(bridge.terminalErrorText).toContain('OAuth auth derivation failed');
    expect(sendMessage).toHaveBeenCalledOnce();
    const text = sendMessage.mock.calls[0][1].content[0].text;
    expect(text).toContain('OAuth auth derivation failed');
    expect(text).not.toContain('空的成功');
    expect(text).not.toContain('正在自动重试');
  });

  it('still detects an actually empty assistant response', () => {
    const { bridge, emit } = harness();
    emit({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'stop' } });
    expect(bridge.terminalErrorText).toContain('空的成功');
  });

  it('clears the failed status when SDK retry succeeds', () => {
    const { bridge, emit } = harness();
    emit({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: '503 overloaded',
      },
    });
    emit({ type: 'auto_retry_end', success: true, attempt: 1 });
    expect(bridge.terminalErrorText).toBeUndefined();
    expect(bridge.hasEmittedError).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import {
  AGENT_TURN_RETRY_SETTINGS,
  classifyRetryReason,
  formatRetryStatus,
  isTransientNetworkError,
} from '../src/main/agent/agent-runner-retry';
import { toUserFacingErrorText } from '../src/main/agent/agent-runner-message-end';
import {
  AgentRunEventBridge,
  type AgentRunBridgeDeps,
} from '../src/main/agent/agent-runner-event-bridge';

describe('transient network error classifier', () => {
  it.each([
    'terminated',
    'TypeError: terminated',
    'Connection error.',
    'read ECONNRESET',
    'socket hang up',
    'fetch failed',
    'other side closed',
    'UND_ERR_SOCKET',
    'getaddrinfo EAI_AGAIN api.deepseek.com',
  ])('treats %s as a dropped connection', (text) => {
    expect(isTransientNetworkError(text)).toBe(true);
    expect(classifyRetryReason(text)).toBe('network');
  });

  it.each([
    '',
    undefined,
    '401 Unauthorized',
    '400 Bad Request: invalid model',
    '503 overloaded',
    'insufficient_quota',
    'Request was determined to be invalid',
  ])('does not treat %s as a network drop', (text) => {
    expect(isTransientNetworkError(text)).toBe(false);
  });

  it('formats the visible retry status', () => {
    expect(formatRetryStatus(1, 3, 'terminated')).toBe('连接中断，正在重试 (1/3)');
    expect(formatRetryStatus(2, 3, '503 overloaded')).toBe('模型服务异常，正在重试 (2/3)');
  });

  it('retries three times with exponential backoff', () => {
    expect(AGENT_TURN_RETRY_SETTINGS).toMatchObject({ enabled: true, maxRetries: 3 });
    expect(AGENT_TURN_RETRY_SETTINGS.baseDelayMs).toBeGreaterThanOrEqual(1000);
  });

  it('maps socket resets to the network-interrupted message', () => {
    expect(toUserFacingErrorText('socket hang up')).toContain('网络连接中断');
    expect(toUserFacingErrorText('read ECONNRESET')).toContain('网络连接中断');
  });
});

const bridges: AgentRunEventBridge[] = [];
afterEach(() => {
  for (const bridge of bridges.splice(0)) clearTimeout(bridge.activityTimeoutId);
});

function harness() {
  let onEvent!: (event: AgentSessionEvent) => void;
  const sendMessage = vi.fn();
  const sendToRenderer = vi.fn();
  const sendTraceUpdate = vi.fn();
  const sendTraceStep = vi.fn();
  const bridge = new AgentRunEventBridge({
    session: { id: 'session' },
    thinkingStepId: 'root',
    turnId: 'turn',
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
    evaluationMetrics: {
      modelCallCount: 0,
      toolCallCount: 0,
      toolDurationMs: 0,
      toolErrorCount: 0,
    },
    toolStartedAt: new Map(),
    seenToolCallIds: new Set(),
    getToolDisplayName: (name: string) => name,
    sendMessage,
    sendPartial: vi.fn(),
    sendToRenderer,
    sendTraceUpdate,
    sendTraceStep,
    sanitizeOutputPaths: (text: string) => text,
  } as unknown as AgentRunBridgeDeps);
  bridges.push(bridge);
  bridge.subscribe();
  return {
    bridge,
    sendMessage,
    sendToRenderer,
    sendTraceUpdate,
    emit: (event: unknown) => onEvent(event as AgentSessionEvent),
  };
}

function failedAttemptWithToolCall(emit: (event: unknown) => void, toolCallId: string) {
  emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
  const toolCall = {
    type: 'toolCall',
    id: toolCallId,
    name: 'bash',
    arguments: { command: 'cat' },
  };
  emit({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'toolcall_start',
      contentIndex: 0,
      partial: { content: [toolCall] },
    },
  });
  emit({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [toolCall],
      stopReason: 'error',
      errorMessage: 'terminated',
    },
  });
}

describe('bridge behaviour around automatic retries', () => {
  it('discards a broken attempt instead of showing an error when the SDK retries', () => {
    const { bridge, emit, sendMessage, sendToRenderer, sendTraceUpdate } = harness();
    failedAttemptWithToolCall(emit, 'call-1');
    emit({ type: 'agent_end', messages: [], willRetry: true });
    emit({
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: 'terminated',
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendToRenderer).toHaveBeenCalledWith({
      type: 'stream.reset',
      payload: { sessionId: 'session' },
    });
    expect(sendTraceUpdate).toHaveBeenCalledWith(
      'session',
      'call-1',
      expect.objectContaining({ status: 'error', toolPhase: undefined })
    );
    expect(sendTraceUpdate).toHaveBeenCalledWith(
      'session',
      'root',
      expect.objectContaining({
        title: '连接中断，正在重试 (1/3)',
        retry: expect.objectContaining({ attempt: 1, maxAttempts: 3, reason: 'network' }),
      })
    );

    emit({ type: 'auto_retry_end', success: true, attempt: 1 });
    expect(sendTraceUpdate).toHaveBeenLastCalledWith(
      'session',
      'root',
      expect.objectContaining({ retry: null })
    );
    expect(bridge.terminalErrorText).toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('shows the error once when retries are exhausted', () => {
    const { bridge, emit, sendMessage } = harness();
    failedAttemptWithToolCall(emit, 'call-2');
    emit({ type: 'agent_end', messages: [], willRetry: false });
    emit({ type: 'auto_retry_end', success: false, attempt: 3, finalError: 'terminated' });
    bridge.flushPendingError();

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][1].content[0].text).toContain('网络连接中断');
    expect(bridge.terminalErrorText).toContain('网络连接中断');
  });
});

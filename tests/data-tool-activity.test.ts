import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
} from '@earendil-works/pi-ai';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { bindAgentRunCancellation } from '../src/main/agent/agent-run-cancellation';
import {
  AgentRunEventBridge,
  type AgentRunBridgeDeps,
} from '../src/main/agent/agent-runner-event-bridge';
import { createDataCustomTools } from '../src/main/data/data-tool-definitions';
import type { DataToolService } from '../src/main/data/data-tool-service';
import type { DataToolExecutionContext, DataToolResult } from '../src/main/data/data-tool-types';

vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logWarn: vi.fn() }));
afterEach(() => vi.useRealTimers());
const model: Model<'openai-completions'> = {
  id: 'offline',
  name: 'offline',
  provider: 'openai',
  api: 'openai-completions',
  baseUrl: 'http://offline.invalid',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4000,
};

describe('nested data model activity with the real Agent SDK', () => {
  it.each(['data_analyze_pipeline_requirement', 'data_generate_pipeline_from_requirement'])(
    '%s keeps active work alive and cancels the inner request when it actually stalls',
    async (toolName) => {
      const controller = new AbortController();
      let notifyStarted!: (context: DataToolExecutionContext) => void;
      const started = new Promise<DataToolExecutionContext>((resolve) => {
        notifyStarted = resolve;
      });
      const execute = async (
        _input: unknown,
        context: DataToolExecutionContext
      ): Promise<DataToolResult> => {
        notifyStarted(context);
        return new Promise((_resolve, reject) => {
          context.signal!.addEventListener('abort', () => reject(context.signal!.reason), {
            once: true,
          });
        });
      };
      const tool = createDataCustomTools({
        analyzePipelineRequirement: execute,
        generatePipelineFromAnalysis: execute,
        resolveExecutionContext: (_session: string, toolCallId: string, signal: AbortSignal) => ({
          sessionId: 'chat',
          toolCallId,
          signal,
        }),
        rememberResolvedResources: vi.fn(),
      } as unknown as DataToolService).find((entry) => entry.name === toolName)!;
      const tools: AgentTool[] = [
        {
          ...tool,
          execute: (id, args, signal, update) =>
            tool.execute(id, args, signal, update, undefined as never),
        },
      ];
      let calls = 0;
      let followupWasAborted = false;
      const agent = new Agent({
        initialState: { model, tools },
        streamFn: (_model, _request, options) => {
          if (++calls > 1) {
            followupWasAborted = options?.signal?.aborted === true;
            throw new DOMException('Aborted', 'AbortError');
          }
          const message: AssistantMessage = {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'call',
                name: toolName,
                arguments: toolName.includes('analyze')
                  ? { rawTableId: 'input', processRequirement: 'filter profit > 0' }
                  : { analysisId: 'receipt', confirmed: true, outputMode: 'create' },
              },
            ],
            api: model.api,
            provider: model.provider,
            model: model.id,
            stopReason: 'toolUse',
            timestamp: 0,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          };
          const stream = createAssistantMessageEventStream();
          stream.push({ type: 'done', reason: 'toolUse', message });
          stream.end(message);
          return stream;
        },
      });
      let dispatch!: (event: AgentSessionEvent) => void;
      const onTimeoutAbort = vi.fn();
      const sendToRenderer = vi.fn();
      const bridge = new AgentRunEventBridge({
        controller,
        onTimeoutAbort,
        provider: 'offline',
        sendToRenderer,
        piSession: {
          subscribe: (callback: typeof dispatch) => {
            dispatch = callback;
            return () => {};
          },
        },
      } as unknown as AgentRunBridgeDeps);
      bridge.subscribe();
      const updates: unknown[] = [];
      agent.subscribe((event) => {
        if (event.type === 'tool_execution_update') {
          updates.push(event.partialResult);
          dispatch(event);
        }
      });
      const abort = vi.fn(async () => {
        agent.abort();
      });
      const unbind = bindAgentRunCancellation({ abort }, controller.signal);
      const running = agent.prompt('test');
      try {
        const context = await Promise.race([
          started,
          running.then(() => {
            throw new Error(JSON.stringify(agent.state.messages));
          }),
        ]);
        vi.useFakeTimers();
        bridge.resetActivityTimeout();
        for (let i = 0; i < 3; i++) {
          await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
          context.onActivity!(); // a delta received by the inner model request
          context.onActivity!(); // bursts are throttled
          expect(controller.signal.aborted).toBe(false);
        }
        expect(updates).toEqual(
          Array.from({ length: 3 }, () => ({ content: [], details: { activity: 'model' } }))
        );
        expect(sendToRenderer).not.toHaveBeenCalled(); // no internal reasoning sent to the UI
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
        await running;
        // The SDK may enter its next stream with an already-aborted signal.
        expect(followupWasAborted).toBe(true);
        expect(onTimeoutAbort).toHaveBeenCalledOnce();
        expect(abort).toHaveBeenCalledOnce();
        expect(context.signal!.aborted).toBe(true);
      } finally {
        unbind();
        clearTimeout(bridge.activityTimeoutId);
      }
    }
  );

  it('does not cancel a later warm run when the previous controller is aborted', () => {
    const old = new AbortController();
    const abort = vi.fn(async () => {});
    bindAgentRunCancellation({ abort }, old.signal)();
    old.abort();
    expect(abort).not.toHaveBeenCalled();
    const current = new AbortController();
    current.abort();
    const unbind = bindAgentRunCancellation({ abort }, current.signal);
    expect(abort).toHaveBeenCalledOnce();
    unbind();
  });
});

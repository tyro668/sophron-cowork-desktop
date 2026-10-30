/**
 * A tool-using agent loop that runs without a chat session: no sidebar session, no messages in
 * the task list, no permission prompts. Used by editors (script packages, raw-table normalizers)
 * that need the model to explore, write files and self-test before saving a draft.
 *
 * Same model plumbing as chat (pi-agent-core `Agent` + pi-ai streaming) with an explicit tool
 * list, a turn cap, a wall-clock cap and cancellation.
 */
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import { streamSimple } from '@earendil-works/pi-ai/compat';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AppConfig } from '../config/config-store';
import type { AgentRuntimeConfig } from '../../shared/contracts';
import { resolvePiAiTarget } from './pi-ai-one-shot';
import type { AnyAgentTool } from './workspace-tools';
import { log, logWarn } from '../utils/logger';

export type HeadlessAgentEvent =
  | { type: 'tool_start'; id: string; name: string; args: Record<string, unknown> }
  | {
      type: 'tool_end';
      id: string;
      name: string;
      args: Record<string, unknown>;
      isError: boolean;
      text: string;
    }
  | { type: 'assistant_text'; text: string }
  | { type: 'turn'; turn: number };

export type HeadlessAgentStop = 'done' | 'max_turns' | 'timeout' | 'aborted' | 'error';

export interface HeadlessAgentResult {
  /** Final assistant text of this prompt. */
  text: string;
  stop: HeadlessAgentStop;
  error?: string;
  turns: number;
  toolCalls: number;
  durationMs: number;
}

export interface HeadlessToolAgentOptions {
  config: AppConfig | AgentRuntimeConfig;
  systemPrompt: string;
  tools: AnyAgentTool[];
  /** Model turns (one model response + its tool calls) per prompt. */
  maxTurns: number;
  /** Wall clock for the whole agent (all prompts). */
  timeoutMs: number;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  onEvent?: (event: HeadlessAgentEvent) => void;
  /** Tests: replace the provider stream. */
  streamFn?: StreamFn;
}

function textOf(message: AgentMessage | undefined): string {
  if (!message || (message as { role?: string }).role !== 'assistant') return '';
  return ((message as AssistantMessage).content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('')
    .trim();
}

function toolResultText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

export class HeadlessToolAgent {
  private agent?: Agent;
  private readonly startedAt = Date.now();
  private readonly deadline: number;
  private timedOut = false;
  private aborted = false;
  private turnsThisPrompt = 0;
  private toolCalls = 0;
  private readonly toolArgs = new Map<string, Record<string, unknown>>();
  private readonly unsubscribeAbort?: () => void;

  constructor(private readonly options: HeadlessToolAgentOptions) {
    this.deadline = this.startedAt + options.timeoutMs;
    const signal = options.signal;
    if (signal) {
      const onAbort = () => {
        this.aborted = true;
        this.agent?.abort();
      };
      if (signal.aborted) this.aborted = true;
      else signal.addEventListener('abort', onAbort, { once: true });
      this.unsubscribeAbort = () => signal.removeEventListener('abort', onAbort);
    }
  }

  private async ensureAgent(): Promise<Agent> {
    if (this.agent) return this.agent;
    const { model, apiKey } = await resolvePiAiTarget(this.options.config);
    const maxTurns = this.options.maxTurns;
    const agent = new Agent({
      initialState: {
        systemPrompt: this.options.systemPrompt,
        model,
        thinkingLevel: 'off',
        tools: this.options.tools,
        messages: [],
      },
      streamFn:
        this.options.streamFn ??
        ((streamModel, context, streamOptions) =>
          streamSimple(streamModel, context as never, {
            ...streamOptions,
            apiKey: streamOptions?.apiKey ?? apiKey,
            maxTokens: this.options.maxTokens ?? streamOptions?.maxTokens,
            ...(model.api === 'openai-codex-responses'
              ? {}
              : { temperature: this.options.temperature ?? 0.1 }),
          })),
      getApiKey: () => apiKey,
      toolExecution: 'sequential',
      finishTurn: () => {
        this.turnsThisPrompt += 1;
        this.options.onEvent?.({ type: 'turn', turn: this.turnsThisPrompt });
        if (this.turnsThisPrompt >= maxTurns) return { action: 'end' };
        if (Date.now() >= this.deadline) return { action: 'end' };
        return undefined;
      },
    });
    agent.subscribe((event: AgentEvent) => this.forward(event));
    this.agent = agent;
    return agent;
  }

  private forward(event: AgentEvent): void {
    const emit = this.options.onEvent;
    if (event.type === 'tool_execution_start') {
      this.toolCalls += 1;
      const args = (event.args ?? {}) as Record<string, unknown>;
      this.toolArgs.set(event.toolCallId, args);
      emit?.({ type: 'tool_start', id: event.toolCallId, name: event.toolName, args });
    } else if (event.type === 'tool_execution_end') {
      const args = this.toolArgs.get(event.toolCallId) ?? {};
      this.toolArgs.delete(event.toolCallId);
      emit?.({
        type: 'tool_end',
        id: event.toolCallId,
        name: event.toolName,
        args,
        isError: Boolean(event.isError),
        text: toolResultText(event.result),
      });
    } else if (event.type === 'message_end') {
      const text = textOf(event.message);
      if (text) emit?.({ type: 'assistant_text', text });
    }
  }

  /** Send a prompt (the first one or a follow-up in the same conversation) and run to the end. */
  async prompt(text: string): Promise<HeadlessAgentResult> {
    this.turnsThisPrompt = 0;
    if (this.aborted) return this.result('', 'aborted');
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) return this.result('', 'timeout', '超过时间上限');
    const agent = await this.ensureAgent();
    const timer = setTimeout(() => {
      this.timedOut = true;
      agent.abort();
    }, remaining);
    try {
      await agent.prompt(text);
    } catch (error) {
      if (!this.aborted && !this.timedOut) {
        logWarn('[HeadlessAgent] prompt failed:', error);
        return this.result('', 'error', error instanceof Error ? error.message : String(error));
      }
    } finally {
      clearTimeout(timer);
    }
    const messages = agent.state.messages;
    const last = [...messages]
      .reverse()
      .find((message) => (message as { role?: string }).role === 'assistant') as
      AssistantMessage | undefined;
    const finalText = textOf(last);
    if (this.aborted) return this.result(finalText, 'aborted');
    if (this.timedOut) return this.result(finalText, 'timeout', '超过时间上限');
    if (last?.stopReason === 'error') {
      return this.result(finalText, 'error', last.errorMessage || agent.state.errorMessage);
    }
    if (last?.stopReason === 'aborted') return this.result(finalText, 'aborted');
    const hitTurnCap =
      this.turnsThisPrompt >= this.options.maxTurns &&
      (last?.content ?? []).some((block) => block.type === 'toolCall');
    if (hitTurnCap) return this.result(finalText, 'max_turns', '达到轮次上限');
    if (Date.now() >= this.deadline) return this.result(finalText, 'timeout', '超过时间上限');
    return this.result(finalText, 'done');
  }

  private result(text: string, stop: HeadlessAgentStop, error?: string): HeadlessAgentResult {
    const result = {
      text,
      stop,
      ...(error ? { error } : {}),
      turns: this.turnsThisPrompt,
      toolCalls: this.toolCalls,
      durationMs: Date.now() - this.startedAt,
    };
    log('[HeadlessAgent]', stop, `turns=${result.turns}`, `tools=${result.toolCalls}`);
    return result;
  }

  dispose(): void {
    this.unsubscribeAbort?.();
    this.agent?.abort();
  }
}

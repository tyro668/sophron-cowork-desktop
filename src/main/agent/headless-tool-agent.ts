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
import { redactOutput } from '../exec-guard/redact';
import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';

const LOG_CLIP = 2000;
function clip(text: string): string {
  return text.length > LOG_CLIP ? `${text.slice(0, LOG_CLIP)}…（共 ${text.length} 字）` : text;
}

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

export type HeadlessAgentStop =
  'done' | 'max_turns' | 'max_tokens' | 'timeout' | 'aborted' | 'error';

/** Tokens the model reported for the whole agent (all prompts). */
export interface HeadlessAgentTokens {
  input: number;
  output: number;
  total: number;
}

export interface HeadlessAgentResult {
  /** Final assistant text of this prompt. */
  text: string;
  stop: HeadlessAgentStop;
  error?: string;
  turns: number;
  toolCalls: number;
  durationMs: number;
  tokens: HeadlessAgentTokens;
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
  /** Token budget for the whole agent; the loop ends after the turn that crosses it. */
  maxTotalTokens?: number;
  /**
   * JSONL file that receives every tool call (redacted, truncated) and a closing summary, so a
   * generation / repair can be inspected afterwards.
   */
  toolLogFile?: string;
  temperature?: number;
  onEvent?: (event: HeadlessAgentEvent) => void;
  /**
   * Called after every turn; a returned string is injected as a user message before the next
   * turn (budget reminders such as "6 turns left, write the files now").
   */
  budgetNotice?: (state: { turn: number; maxTurns: number; msLeft: number }) => string | undefined;
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
  private maxTurnsThisPrompt: number;
  private toolCalls = 0;
  private overBudget = false;
  private readonly tokens: HeadlessAgentTokens = { input: 0, output: 0, total: 0 };
  private readonly toolArgs = new Map<string, Record<string, unknown>>();
  private readonly unsubscribeAbort?: () => void;

  constructor(private readonly options: HeadlessToolAgentOptions) {
    this.deadline = this.startedAt + options.timeoutMs;
    this.maxTurnsThisPrompt = options.maxTurns;
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
        const maxTurns = this.maxTurnsThisPrompt;
        if (this.turnsThisPrompt >= maxTurns) return { action: 'end' };
        if (Date.now() >= this.deadline) return { action: 'end' };
        const budget = this.options.maxTotalTokens;
        if (budget && this.tokens.total >= budget) {
          this.overBudget = true;
          return { action: 'end' };
        }
        const notice = this.options.budgetNotice?.({
          turn: this.turnsThisPrompt,
          maxTurns,
          msLeft: this.deadline - Date.now(),
        });
        if (notice) {
          this.agent?.steer({
            role: 'user',
            content: [{ type: 'text', text: notice }],
            timestamp: Date.now(),
          } as AgentMessage);
        }
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
      const text = toolResultText(event.result);
      emit?.({
        type: 'tool_end',
        id: event.toolCallId,
        name: event.toolName,
        args,
        isError: Boolean(event.isError),
        text,
      });
      this.writeLog({
        type: 'tool',
        turn: this.turnsThisPrompt + 1,
        tool: event.toolName,
        args: clip(JSON.stringify(args)),
        isError: Boolean(event.isError),
        result: clip(text),
      });
    } else if (event.type === 'message_end') {
      const usage = (event.message as AssistantMessage | undefined)?.usage;
      if ((event.message as { role?: string })?.role === 'assistant' && usage) {
        this.tokens.input += usage.input + (usage.cacheRead ?? 0);
        this.tokens.output += usage.output;
        this.tokens.total += usage.totalTokens || usage.input + usage.output;
      }
      const text = textOf(event.message);
      if (text) emit?.({ type: 'assistant_text', text });
    }
  }

  /** Send a prompt (the first one or a follow-up in the same conversation) and run to the end. */
  async prompt(text: string, options?: { maxTurns?: number }): Promise<HeadlessAgentResult> {
    this.turnsThisPrompt = 0;
    this.maxTurnsThisPrompt = options?.maxTurns ?? this.options.maxTurns;
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
      this.turnsThisPrompt >= this.maxTurnsThisPrompt &&
      (last?.content ?? []).some((block) => block.type === 'toolCall');
    if (hitTurnCap) return this.result(finalText, 'max_turns', '达到轮次上限');
    if (this.overBudget)
      return this.result(
        finalText,
        'max_tokens',
        `超过 token 上限（${this.options.maxTotalTokens?.toLocaleString('en-US')}）`
      );
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
      tokens: { ...this.tokens },
    };
    log(
      '[HeadlessAgent]',
      stop,
      `turns=${result.turns}`,
      `tools=${result.toolCalls}`,
      `tokens=${result.tokens.total}`
    );
    this.writeLog({
      type: 'end',
      stop,
      ...(error ? { error } : {}),
      turns: result.turns,
      toolCalls: result.toolCalls,
      durationMs: result.durationMs,
      tokens: result.tokens,
    });
    return result;
  }

  private writeLog(entry: Record<string, unknown>): void {
    const file = this.options.toolLogFile;
    if (!file) return;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      appendFileSync(
        file,
        `${redactOutput(JSON.stringify({ at: Date.now(), ...entry }))}\n`,
        'utf8'
      );
    } catch (error) {
      logWarn('[HeadlessAgent] tool log write failed:', error);
    }
  }

  dispose(): void {
    this.unsubscribeAbort?.();
    this.agent?.abort();
  }
}

/** 「12 轮 · 30 次工具调用 · 输入 85k / 输出 9k tokens」 */
export function formatAgentUsage(result: HeadlessAgentResult): string {
  const k = (value: number) => (value >= 1000 ? `${Math.round(value / 1000)}k` : String(value));
  return `本次用了 ${result.turns} 轮 · ${result.toolCalls} 次工具调用 · 输入 ${k(result.tokens.input)} / 输出 ${k(result.tokens.output)} tokens`;
}

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { Type } from 'typebox';

vi.mock('../src/main/agent/pi-ai-one-shot', () => ({
  resolvePiAiTarget: vi.fn(async () => ({
    model: { api: 'openai-completions', provider: 'test', id: 'test', reasoning: true },
    apiKey: 'test',
  })),
}));

const { HeadlessToolAgent, formatAgentUsage } =
  await import('../src/main/agent/headless-tool-agent');
const { registerSecretSource } = await import('../src/main/exec-guard/redact');

const { resolvePiAiTarget } = await import('../src/main/agent/pi-ai-one-shot');

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A model that calls `probe` every turn and reports 600 tokens per response. */
function toolLoopStream() {
  let turn = 0;
  return () => {
    turn += 1;
    const message: AssistantMessage = {
      role: 'assistant',
      api: 'openai-completions',
      provider: 'test',
      model: 'test',
      content: [{ type: 'toolCall', id: `call-${turn}`, name: 'probe', arguments: { n: turn } }],
      stopReason: 'toolUse',
      timestamp: Date.now(),
      usage: {
        input: 500,
        output: 100,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 600,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: 'toolUse', message });
    stream.end();
    return stream;
  };
}

describe('headless agent accounting', () => {
  it.each(['aborted', 'timeout'] as const)('stops during initialization with %s', async (stop) => {
    vi.useFakeTimers();
    const target = await resolvePiAiTarget({} as never);
    let release!: () => void;
    vi.mocked(resolvePiAiTarget).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(target);
        })
    );
    const controller = new AbortController();
    const streamFn = vi.fn(toolLoopStream());
    const execute = vi.fn();
    const agent = new HeadlessToolAgent({
      config: {} as never,
      systemPrompt: '',
      tools: [{ name: 'probe', execute }] as never,
      signal: controller.signal,
      maxTurns: 1,
      timeoutMs: 50,
      streamFn,
    });
    try {
      const pending = agent.prompt('go');
      if (stop === 'aborted') controller.abort();
      else await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toMatchObject({ stop, turns: 0, toolCalls: 0 });
      release();
      await vi.advanceTimersByTimeAsync(100);
      expect(streamFn).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      agent.dispose();
      vi.useRealTimers();
    }
  });

  it('counts tokens, stops at the token budget and logs every tool call redacted', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-log-'));
    dirs.push(dir);
    const unregister = registerSecretSource(() => ['hunter2-secret-value']);
    const logFile = path.join(dir, 'logs', 'run.jsonl');
    const agent = new HeadlessToolAgent({
      config: {} as never,
      systemPrompt: 'test',
      tools: [
        {
          name: 'probe',
          label: 'probe',
          description: 'probe',
          parameters: Type.Object({ n: Type.Number() }),
          execute: async () => ({
            content: [{ type: 'text' as const, text: 'token=hunter2-secret-value ok' }],
            details: {},
          }),
        },
      ] as never,
      maxTurns: 10,
      timeoutMs: 60_000,
      maxTotalTokens: 1000,
      toolLogFile: logFile,
      streamFn: toolLoopStream() as never,
    });
    const result = await agent.prompt('go');
    agent.dispose();
    unregister();
    expect(result.stop).toBe('max_tokens');
    expect(result.turns).toBe(2);
    expect(result.tokens).toEqual({ input: 1000, output: 200, total: 1200 });
    expect(formatAgentUsage(result)).toBe(
      '本次用了 2 轮 · 2 次工具调用 · 输入 1k / 输出 200 tokens'
    );
    const lines = readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines.map((line) => line.type)).toEqual(['tool', 'tool', 'end']);
    expect(lines[0]).toMatchObject({ tool: 'probe', turn: 1, isError: false });
    expect(JSON.stringify(lines)).not.toContain('hunter2-secret-value');
    expect(lines[2]).toMatchObject({ stop: 'max_tokens', tokens: { total: 1200 } });
  });

  it('forwards configured thinkingLevel from config to the model stream', async () => {
    const capturedReasonings: Array<string | undefined> = [];
    const makeStream = () =>
      vi.fn((_model, _context, options?: { reasoning?: string }) => {
        capturedReasonings.push(options?.reasoning);
        const message: AssistantMessage = {
          role: 'assistant',
          api: 'openai-completions',
          provider: 'test',
          model: 'test',
          content: [{ type: 'text', text: 'done' }],
          stopReason: 'stop',
          timestamp: Date.now(),
          usage: {
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 15,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end();
        return stream;
      });

    const highAgent = new HeadlessToolAgent({
      config: { enableThinking: true, thinkingLevel: 'high' } as never,
      systemPrompt: 'test',
      tools: [],
      maxTurns: 2,
      timeoutMs: 10_000,
      streamFn: makeStream() as never,
    });
    await highAgent.prompt('go');
    highAgent.dispose();

    const offAgent = new HeadlessToolAgent({
      config: { enableThinking: false, thinkingLevel: 'high' } as never,
      systemPrompt: 'test',
      tools: [],
      maxTurns: 2,
      timeoutMs: 10_000,
      streamFn: makeStream() as never,
    });
    await offAgent.prompt('go');
    offAgent.dispose();

    // Model without xhigh/max in thinkingLevelMap downgrades xhigh -> high.
    const xhighFallbackAgent = new HeadlessToolAgent({
      config: { enableThinking: true, thinkingLevel: 'xhigh' } as never,
      systemPrompt: 'test',
      tools: [],
      maxTurns: 2,
      timeoutMs: 10_000,
      streamFn: makeStream() as never,
    });
    await xhighFallbackAgent.prompt('go');
    xhighFallbackAgent.dispose();

    // Model supporting xhigh + max passes max through directly.
    vi.mocked(resolvePiAiTarget).mockResolvedValueOnce({
      model: {
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        id: 'gpt-6.2-sol',
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: 'low', xhigh: 'xhigh', max: 'max' },
      } as never,
      apiKey: 'test',
    });
    const maxAgent = new HeadlessToolAgent({
      config: { enableThinking: true, thinkingLevel: 'max' } as never,
      systemPrompt: 'test',
      tools: [],
      maxTurns: 2,
      timeoutMs: 10_000,
      streamFn: makeStream() as never,
    });
    await maxAgent.prompt('go');
    maxAgent.dispose();

    expect(capturedReasonings).toEqual(['high', undefined, 'high', 'max']);
  });
});

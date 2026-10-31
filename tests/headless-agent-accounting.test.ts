import { mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { Type } from 'typebox';

vi.mock('../src/main/agent/pi-ai-one-shot', () => ({
  resolvePiAiTarget: async () => ({
    model: { api: 'openai-completions', provider: 'test', id: 'test' },
    apiKey: 'test',
  }),
}));

const { HeadlessToolAgent, formatAgentUsage } =
  await import('../src/main/agent/headless-tool-agent');
const { registerSecretSource } = await import('../src/main/exec-guard/redact');

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
});

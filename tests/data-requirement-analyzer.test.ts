import { describe, expect, it, vi } from 'vitest';
import { analyzeDataPipelineRequirement } from '../src/main/data/workflow/requirement-analyzer';
import { runPiAiOneShot, type PiAiOneShotResult } from '../src/main/agent/pi-ai-one-shot';
import type { AgentRuntimeConfig } from '../src/shared/contracts';

vi.mock('../src/main/agent/pi-ai-one-shot', () => ({ runPiAiOneShot: vi.fn() }));
const runtimeConfig: AgentRuntimeConfig = {
  provider: 'openai',
  model: 'offline',
  apiKey: 'offline',
  enableThinking: true,
  thinkingLevel: 'medium',
};
const validText = JSON.stringify({
  items: [
    {
      requirement: '利润大于 0',
      status: 'supported',
      capabilities: ['filter.boolean_predicate'],
    },
  ],
});
function response(
  text = validText,
  stopReason: PiAiOneShotResult['stopReason'] = 'stop'
): PiAiOneShotResult {
  return {
    text,
    stopReason,
    hasThinking: true,
    durationMs: 1,
    provider: 'offline',
    model: 'offline',
    usage: {
      input: 100,
      output: 100,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 200,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
const input = {
  requirement: '利润大于 0',
  columns: [{ name: '利润', type: 'number' }],
  runtimeConfig,
};

describe('requirement analysis output budget', () => {
  it('disables analysis thinking and forwards activity while preserving the conversation config', async () => {
    const onActivity = vi.fn();
    vi.mocked(runPiAiOneShot).mockImplementationOnce(async (_prompt, _system, _config, options) => {
      expect(options?.reasoning).toBe('off');
      options?.onActivity?.();
      return response();
    });
    await analyzeDataPipelineRequirement({ ...input, onActivity });
    expect(onActivity).toHaveBeenCalledOnce();
    expect(runtimeConfig.enableThinking).toBe(true);
  });
  it('recovers from reasoning-only truncation and records both model calls', async () => {
    const first = response('', 'length');
    const second = response();
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const usage = vi.fn();
    expect(await analyzeDataPipelineRequirement({ ...input, onModelUsage: usage })).toMatchObject({
      status: 'supported',
    });
    expect(runPiAiOneShot).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runPiAiOneShot).mock.calls.map((call) => call[3]?.maxTokens)).toEqual([
      8192, 16384,
    ]);
    expect(usage.mock.calls).toEqual([[first], [second]]);
  });
  it('stops after one truncation retry with an explicit limit error', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValue(response('', 'length'));
    await expect(analyzeDataPipelineRequirement(input)).rejects.toThrow('output token limit');
    expect(runPiAiOneShot).toHaveBeenCalledTimes(2);
  });
  it('does not spend another call retrying malformed non-truncated output', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValue(response('not JSON'));
    await expect(analyzeDataPipelineRequirement(input)).rejects.toThrow('valid JSON');
    expect(runPiAiOneShot).toHaveBeenCalledTimes(1);
  });
  it('honors cancellation before retrying', async () => {
    const controller = new AbortController();
    vi.mocked(runPiAiOneShot).mockImplementationOnce(async () => {
      controller.abort();
      return response('', 'length');
    });
    await expect(
      analyzeDataPipelineRequirement({ ...input, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(runPiAiOneShot).toHaveBeenCalledTimes(1);
  });
});

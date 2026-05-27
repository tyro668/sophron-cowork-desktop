import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const completionsPath = path.resolve(
  'node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js'
);
const completionsSource = fs.readFileSync(completionsPath, 'utf8');
const isPatched = completionsSource.includes('dropsThinkingInHistory');

if (!isPatched) {
  throw new Error('Expected @mariozechner/pi-ai patch to be applied before running this suite');
}

const mod = await import(pathToFileURL(completionsPath).href);
const { convertMessages } = mod;

describe('DeepSeek thinking block serialization', () => {
  const baseModel = {
    id: 'deepseek-v4-pro',
    name: 'deepseek-v4-pro',
    api: 'openai-completions' as const,
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    reasoning: true,
    input: ['text' as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  };

  const baseCompat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    reasoningEffortMap: {},
    supportsUsageInStreaming: true,
    maxTokensField: 'max_completion_tokens' as const,
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    dropsThinkingInHistory: false,
    requiresThinkingInContent: false,
    thinkingFormat: 'openai' as const,
    openRouterRouting: {},
    vercelGatewayRouting: {},
    supportsStrictMode: true,
  };

  const sameModelMeta = {
    provider: 'deepseek',
    api: 'openai-completions',
    model: 'deepseek-v4-pro',
  };

  it('serializes DeepSeek thinking blocks as top-level reasoning_content', () => {
    const context = {
      systemPrompt: undefined,
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
        {
          role: 'assistant' as const,
          ...sameModelMeta,
          content: [
            {
              type: 'thinking' as const,
              thinking: 'Let me think about this...',
              thinkingSignature: 'reasoning_content',
            },
            { type: 'text' as const, text: 'Hi there!' },
          ],
        },
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Follow up' }] },
      ],
    };

    const result = convertMessages(baseModel, context, baseCompat);
    const assistantMsg = result.find((m: { role: string }) => m.role === 'assistant');

    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toBe('Hi there!');
    expect((assistantMsg as Record<string, unknown>).reasoning_content).toBe(
      'Let me think about this...'
    );
  });

  it('keeps DeepSeek reasoning_content on assistant tool-call messages without text', () => {
    const context = {
      systemPrompt: undefined,
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
        {
          role: 'assistant' as const,
          ...sameModelMeta,
          content: [
            {
              type: 'thinking' as const,
              thinking: 'Deep reasoning here...',
              thinkingSignature: 'reasoning_content',
            },
            {
              type: 'toolCall' as const,
              id: 'call_1',
              name: 'run_python',
              arguments: { script: 'print(1)' },
            },
          ],
        },
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Follow up' }] },
      ],
    };

    const result = convertMessages(baseModel, context, baseCompat);
    const assistantMsg = result.find((m: { role: string }) => m.role === 'assistant');

    expect(assistantMsg).toBeDefined();
    expect((assistantMsg as Record<string, unknown>).reasoning_content).toBe(
      'Deep reasoning here...'
    );
    expect((assistantMsg as Record<string, unknown>).tool_calls).toHaveLength(1);
  });

  it('still supports text fallback for providers that require thinking as text', () => {
    const context = {
      systemPrompt: undefined,
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
        {
          role: 'assistant' as const,
          ...sameModelMeta,
          content: [
            {
              type: 'thinking' as const,
              thinking: 'Text fallback reasoning',
              thinkingSignature: 'reasoning_content',
            },
            { type: 'text' as const, text: 'Visible answer' },
          ],
        },
      ],
    };

    const result = convertMessages(baseModel, context, {
      ...baseCompat,
      requiresThinkingAsText: true,
    });

    const assistantMsg = result.find((m: { role: string }) => m.role === 'assistant');
    expect(Array.isArray(assistantMsg!.content)).toBe(true);
    expect(assistantMsg!.content).toEqual([
      { type: 'text', text: 'Text fallback reasoning' },
      { type: 'text', text: 'Visible answer' },
    ]);
  });

  it('omits thinking-only assistant messages that have no text or tool calls', () => {
    const context = {
      systemPrompt: undefined,
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
        {
          role: 'assistant' as const,
          ...sameModelMeta,
          content: [
            {
              type: 'thinking' as const,
              thinking: 'Replayable reasoning',
              thinkingSignature: 'reasoning_content',
            },
          ],
        },
      ],
    };

    const result = convertMessages(baseModel, context, baseCompat);

    expect(result.some((m: { role: string }) => m.role === 'assistant')).toBe(false);
  });
});

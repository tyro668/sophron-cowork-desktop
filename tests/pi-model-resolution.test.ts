import { describe, expect, it } from 'vitest';
import {
  applyPiModelRuntimeOverrides,
  buildPiModelLookupCandidates,
  buildSyntheticPiModel,
  inferPiApi,
  resolvePiModelString,
  resolvePiRegistryModel,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
} from '../src/main/agent/pi-model-resolution';
import { API_PROVIDER_PRESETS } from '../src/shared/api-model-presets';
import type { Api, Model, OpenAICompletionsCompat } from '@mariozechner/pi-ai';

/**
 * The models exercised here all resolve through the openai-completions api,
 * so narrow the pi-ai compat union to the completions shape.
 */
function completionsCompat(model: Model<Api>): OpenAICompletionsCompat | undefined {
  return model.compat as OpenAICompletionsCompat | undefined;
}

describe('pi model resolution helpers', () => {
  it('skips invalid custom raw provider lookups and deduplicates candidates', () => {
    const candidates = buildPiModelLookupCandidates('openai/gpt-5.4', {
      configProvider: 'openai',
      rawProvider: 'custom',
    });

    expect(candidates).toEqual([
      { provider: 'openai', model: 'gpt-5.4' },
      { provider: 'anthropic', model: 'gpt-5.4' },
      { provider: 'google', model: 'gpt-5.4' },
    ]);
  });

  it('prefers openrouter full model id before native provider lookup', () => {
    const candidates = buildPiModelLookupCandidates('anthropic/claude-sonnet-4-6', {
      configProvider: 'anthropic',
      rawProvider: 'openrouter',
    });

    expect(candidates).toEqual([
      { provider: 'openrouter', model: 'anthropic/claude-sonnet-4-6' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { provider: 'openai', model: 'claude-sonnet-4-6' },
      { provider: 'google', model: 'claude-sonnet-4-6' },
    ]);
  });

  it('builds provider-prefixed model ids from config-like input', () => {
    expect(
      resolvePiModelString({ provider: 'openai', customProtocol: 'openai', model: 'gpt-5.4' })
    ).toBe('openai/gpt-5.4');
    expect(
      resolvePiModelString({
        provider: 'custom',
        customProtocol: 'gemini',
        model: 'gemini-3-flash-preview',
      })
    ).toBe('gemini/gemini-3-flash-preview');
    expect(
      resolvePiModelString({
        provider: 'anthropic',
        customProtocol: 'anthropic',
        model: 'anthropic/claude-sonnet-4-6',
      })
    ).toBe('anthropic/claude-sonnet-4-6');
    expect(
      resolvePiModelString({
        provider: 'deepseek',
        customProtocol: 'openai',
        model: 'deepseek-v4-flash',
      })
    ).toBe('deepseek/deepseek-v4-flash');
    expect(
      resolvePiModelString({
        provider: 'moonshot',
        customProtocol: 'openai',
        model: 'kimi-k2.6',
      })
    ).toBe('moonshot/kimi-k2.6');
    expect(
      resolvePiModelString({
        provider: 'zai',
        customProtocol: 'openai',
        model: 'glm-5',
      })
    ).toBe('zai/glm-5');
  });

  it('routes openrouter through the openai-compatible protocol', () => {
    expect(resolvePiRouteProtocol('openrouter', 'anthropic')).toBe('openai');
    expect(resolvePiRouteProtocol('deepseek', 'anthropic')).toBe('openai');
    expect(resolvePiRouteProtocol('moonshot', 'anthropic')).toBe('openai');
    expect(resolvePiRouteProtocol('zai', 'anthropic')).toBe('openai');
    expect(resolvePiRouteProtocol('ollama', 'openai')).toBe('openai');
    expect(resolvePiRouteProtocol('custom', 'gemini')).toBe('gemini');
    expect(resolvePiRouteProtocol('custom', 'anthropic')).toBe('anthropic');
  });

  it('keeps openai-codex on the codex responses protocol', () => {
    expect(resolvePiRouteProtocol('openai-codex', 'openai')).toBe('openai-codex');
    expect(inferPiApi('openai-codex')).toBe('openai-codex-responses');
    expect(
      resolvePiModelString({
        provider: 'openai-codex',
        customProtocol: 'openai',
        model: 'gpt-5.3-codex',
      })
    ).toBe('openai-codex/gpt-5.3-codex');
  });

  it('resolves codex models from the pi-ai registry without downgrading the api', () => {
    const model = resolvePiRegistryModel('openai-codex/gpt-5.3-codex', {
      configProvider: 'openai-codex',
      rawProvider: 'openai-codex',
      customBaseUrl: 'https://chatgpt.com/backend-api',
      customProtocol: 'openai',
    });

    expect(model).toBeDefined();
    expect(model?.provider).toBe('openai-codex');
    expect(model?.api).toBe('openai-codex-responses');
    expect(model?.baseUrl).toBe('https://chatgpt.com/backend-api');
  });

  it('builds synthetic codex models for ids missing from the registry', () => {
    const fallback = resolveSyntheticPiModelFallback({
      rawModel: 'gpt-6-astra',
      resolvedModelString: 'gpt-6-astra',
      rawProvider: 'openai-codex',
      routeProtocol: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api',
    });
    expect(fallback).toEqual({ provider: 'openai-codex', modelId: 'gpt-6-astra' });

    const model = buildSyntheticPiModel(
      fallback.modelId,
      fallback.provider,
      'openai-codex',
      'https://chatgpt.com/backend-api'
    );
    expect(model.api).toBe('openai-codex-responses');
    expect(model.baseUrl).toBe('https://chatgpt.com/backend-api');
    expect(model.contextWindow).toBe(272_000);
    expect(model.maxTokens).toBe(128_000);

    const overridden = applyPiModelRuntimeOverrides(model, {
      configProvider: 'openai-codex',
      rawProvider: 'openai-codex',
      customBaseUrl: 'https://chatgpt.com/backend-api',
      customProtocol: 'openai',
    });
    expect(overridden.api).toBe('openai-codex-responses');
    expect(overridden.baseUrl).toBe('https://chatgpt.com/backend-api');
  });

  it('builds synthetic models with protocol-specific api defaults', () => {
    expect(inferPiApi('anthropic')).toBe('anthropic-messages');
    expect(inferPiApi('gemini')).toBe('google-generative-ai');
    expect(inferPiApi('unknown')).toBe('openai-completions');

    const model = buildSyntheticPiModel('grok-code-fast-1', 'xai', 'openai', 'https://api.x.ai/v1');
    expect(model.id).toBe('grok-code-fast-1');
    expect(model.provider).toBe('xai');
    expect(model.api).toBe('openai-completions');
    expect(model.baseUrl).toBe('https://api.x.ai/v1');
  });

  it('preserves explicit provider-prefixed ids for openrouter synthetic fallbacks', () => {
    const fallback = resolveSyntheticPiModelFallback({
      rawModel: 'z-ai/glm-5-turbo',
      resolvedModelString: 'z-ai/glm-5-turbo',
      rawProvider: 'openrouter',
      routeProtocol: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    expect(fallback).toEqual({
      provider: 'openrouter',
      modelId: 'z-ai/glm-5-turbo',
    });
  });

  it('keeps dedicated provider synthetic fallbacks on their selected provider', () => {
    expect(
      resolveSyntheticPiModelFallback({
        rawModel: 'deepseek-v4-flash',
        resolvedModelString: 'deepseek/deepseek-v4-flash',
        rawProvider: 'deepseek',
        routeProtocol: 'openai',
        baseUrl: 'https://api.deepseek.com',
      })
    ).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });

    expect(
      resolveSyntheticPiModelFallback({
        rawModel: 'zai/glm-5',
        resolvedModelString: 'zai/glm-5',
        rawProvider: 'zai',
        routeProtocol: 'openai',
        baseUrl: 'https://api.z.ai/api/paas/v4',
      })
    ).toEqual({
      provider: 'zai',
      modelId: 'zai/glm-5',
    });
  });

  it('strips helper-added provider prefixes for first-party openai fallbacks', () => {
    const fallback = resolveSyntheticPiModelFallback({
      rawModel: 'gpt-5.4',
      resolvedModelString: 'openai/gpt-5.4',
      rawProvider: 'openai',
      routeProtocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(fallback).toEqual({
      provider: 'openai',
      modelId: 'gpt-5.4',
    });
  });

  it('maps ollama synthetic fallbacks onto the openai provider', () => {
    const fallback = resolveSyntheticPiModelFallback({
      rawModel: 'qwen3.5:0.8b',
      resolvedModelString: 'qwen3.5:0.8b',
      rawProvider: 'ollama',
      routeProtocol: 'openai',
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(fallback).toEqual({
      provider: 'openai',
      modelId: 'qwen3.5:0.8b',
    });
  });

  it('downgrades openai responses api to completions for custom endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'gpt-5.4',
        name: 'gpt-5.4',
        api: 'openai-responses',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'custom',
        customBaseUrl: 'https://relay.example.com/v1',
      }
    );

    expect(model.baseUrl).toBe('https://relay.example.com/v1');
    expect(model.api).toBe('openai-completions');
  });

  it('keeps openai responses api for first-party openai endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'gpt-5.4',
        name: 'gpt-5.4',
        api: 'openai-responses',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'https://api.openai.com/v1',
      }
    );

    expect(model.api).toBe('openai-responses');
  });

  it('disables developer role for third-party openai-compatible endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'kimi-k2.5',
        name: 'kimi-k2.5',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'https://api.moonshot.cn/v1',
      }
    );

    expect(model.baseUrl).toBe('https://api.moonshot.cn/v1');
    expect(completionsCompat(model)?.supportsDeveloperRole).toBe(false);
  });

  it('keeps developer role enabled for first-party openai endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'gpt-5.4',
        name: 'gpt-5.4',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'https://api.openai.com/v1',
      }
    );

    expect(completionsCompat(model)?.supportsDeveloperRole).toBeUndefined();
  });

  it('auto-detects reasoning models by model id pattern', () => {
    const thinking = buildSyntheticPiModel(
      'kimi-k2-thinking',
      'moonshot',
      'openai',
      'https://api.moonshot.cn/v1'
    );
    expect(thinking.reasoning).toBe(true);

    const kimiK2 = buildSyntheticPiModel(
      'kimi-k2.5',
      'moonshot',
      'openai',
      'https://api.moonshot.cn/v1'
    );
    expect(kimiK2.reasoning).toBe(true);

    const deepseekR1 = buildSyntheticPiModel(
      'deepseek-r1-distill',
      'deepseek',
      'openai',
      'https://api.deepseek.com/v1'
    );
    expect(deepseekR1.reasoning).toBe(true);

    const deepseekV4 = buildSyntheticPiModel(
      'deepseek-v4-pro',
      'deepseek',
      'openai',
      'https://api.deepseek.com/v1'
    );
    expect(deepseekV4.reasoning).toBe(true);

    const qwen35 = buildSyntheticPiModel(
      'qwen3.5:0.8b',
      'openai',
      'openai',
      'http://localhost:11434/v1'
    );
    expect(qwen35.reasoning).toBe(true);

    const deepseekV4Pro = buildSyntheticPiModel(
      'deepseek-v4-pro',
      'deepseek',
      'openai',
      'https://api.deepseek.com/v1'
    );
    expect(deepseekV4Pro.reasoning).toBe(true);

    const qwen3 = buildSyntheticPiModel(
      'qwen3:8b',
      'openai',
      'openai',
      'http://localhost:11434/v1'
    );
    expect(qwen3.reasoning).toBe(true);

    const reasoner = buildSyntheticPiModel('o3-reasoner', 'openai', 'openai');
    expect(reasoner.reasoning).toBe(true);

    // Non-reasoning models should default to false
    const gpt = buildSyntheticPiModel('gpt-4.1', 'openai', 'openai');
    expect(gpt.reasoning).toBe(false);

    const llama = buildSyntheticPiModel('llama-4-scout', 'meta', 'openai');
    expect(llama.reasoning).toBe(false);
  });

  it('uses 1M context window defaults for DeepSeek hosted models', () => {
    const deepseekV4 = buildSyntheticPiModel(
      'deepseek-v4-pro',
      'deepseek',
      'openai',
      'https://api.deepseek.com'
    );
    expect(deepseekV4.contextWindow).toBe(1_000_000);

    const deepseekChat = buildSyntheticPiModel(
      'deepseek-chat',
      'deepseek',
      'openai',
      'https://api.deepseek.com'
    );
    expect(deepseekChat.contextWindow).toBe(1_000_000);

    const explicitOverride = buildSyntheticPiModel(
      'deepseek-v4-pro',
      'deepseek',
      'openai',
      'https://api.deepseek.com',
      undefined,
      undefined,
      128000
    );
    expect(explicitOverride.contextWindow).toBe(128000);
  });

  it('uses 200k context window defaults for Qwen3-Max before generic qwen3 matching', () => {
    const qwen3Max = buildSyntheticPiModel(
      'qwen3-max',
      'aliyun',
      'openai',
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    );
    expect(qwen3Max.contextWindow).toBe(200000);

    const explicitOverride = buildSyntheticPiModel(
      'qwen3-max',
      'aliyun',
      'openai',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      undefined,
      undefined,
      128000
    );
    expect(explicitOverride.contextWindow).toBe(128000);
  });

  it('uses at least 200k defaults for built-in preset models and 1M for DeepSeek', () => {
    const providerEntries = Object.entries(API_PROVIDER_PRESETS);

    for (const [provider, preset] of providerEntries) {
      for (const modelOption of preset.models) {
        const model = buildSyntheticPiModel(
          modelOption.id,
          provider,
          provider === 'anthropic' ? 'anthropic' : 'openai',
          preset.baseUrl
        );
        if (modelOption.id.toLowerCase().includes('deepseek')) {
          expect(model.contextWindow, `${provider}/${modelOption.id}`).toBe(1_000_000);
        } else {
          expect(model.contextWindow, `${provider}/${modelOption.id}`).toBeGreaterThanOrEqual(
            200_000
          );
        }
      }
    }
  });

  it('allows explicit reasoning override in buildSyntheticPiModel', () => {
    // Force reasoning=true on a model that wouldn't auto-detect
    const forced = buildSyntheticPiModel('custom-model', 'custom', 'openai', '', undefined, true);
    expect(forced.reasoning).toBe(true);

    // Force reasoning=false on a model that would auto-detect
    const suppressed = buildSyntheticPiModel(
      'kimi-k2.5',
      'moonshot',
      'openai',
      '',
      undefined,
      false
    );
    expect(suppressed.reasoning).toBe(false);
  });

  it('does not false-positive on models with thinking as a substring', () => {
    // "critical-thinking-v2" should NOT match — \bthinking\b requires word boundary,
    // but here "thinking" IS a whole word between hyphens, so it WILL match.
    // This is intentional — hyphens are not \w so \b fires.
    const critical = buildSyntheticPiModel('critical-thinking-v2', 'custom', 'openai');
    expect(critical.reasoning).toBe(true);

    // But a model like "rethinkingai" should NOT match — no word boundary around "thinking"
    const rethinking = buildSyntheticPiModel('rethinkingai', 'custom', 'openai');
    expect(rethinking.reasoning).toBe(false);
  });

  it('disables developer role for ollama with custom endpoint', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'qwen3:8b',
        name: 'qwen3:8b',
        api: 'openai-completions',
        provider: 'ollama',
        baseUrl: '',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 40960,
        maxTokens: 8192,
      },
      {
        configProvider: 'ollama',
        rawProvider: 'ollama',
        customBaseUrl: 'http://localhost:11434/v1',
      }
    );

    expect(model.baseUrl).toBe('http://localhost:11434/v1');
    expect(completionsCompat(model)?.supportsDeveloperRole).toBe(false);
  });

  it('maps ollama thinking off to reasoning_effort none for reasoning models', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'qwen3.5:0.8b',
        name: 'qwen3.5:0.8b',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'http://localhost:11434/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 258048,
        maxTokens: 32768,
      },
      {
        configProvider: 'openai',
        rawProvider: 'ollama',
        customBaseUrl: 'http://localhost:11434/v1',
      }
    );

    expect(completionsCompat(model)?.supportsReasoningEffort).toBe(true);
    expect(
      (completionsCompat(model)?.reasoningEffortMap as Record<string, string> | undefined)?.off
    ).toBe('none');
  });

  it('disables developer role for openrouter with custom endpoint', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'anthropic/claude-sonnet-4-6',
        name: 'claude-sonnet-4-6',
        api: 'openai-completions',
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
      },
      {
        configProvider: 'openrouter',
        rawProvider: 'openrouter',
        customBaseUrl: 'https://openrouter.ai/api/v1',
      }
    );

    expect(completionsCompat(model)?.supportsDeveloperRole).toBe(false);
  });

  it('disables supportsStore alongside developer role for non-standard endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'kimi-k2.5',
        name: 'kimi-k2.5',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'https://api.moonshot.cn/v1',
      }
    );

    expect(completionsCompat(model)?.supportsDeveloperRole).toBe(false);
    expect(completionsCompat(model)?.supportsStore).toBe(false);
  });

  it('preserves existing compat fields when disabling developer role', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'custom-model',
        name: 'custom-model',
        api: 'openai-completions',
        provider: 'custom',
        baseUrl: '',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        compat: { supportsStreaming: true } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      {
        configProvider: 'custom',
        rawProvider: 'custom',
        customBaseUrl: 'https://my-relay.example.com/v1',
      }
    );

    expect(completionsCompat(model)?.supportsDeveloperRole).toBe(false);
    expect(completionsCompat(model)?.supportsStore).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((model.compat as any)?.supportsStreaming).toBe(true);
  });

  it('uses top-level reasoning replay for DeepSeek-compatible model ids on custom endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'deepseek-v4-pro',
        name: 'deepseek-v4-pro',
        api: 'openai-completions',
        provider: 'custom',
        baseUrl: 'https://my-relay.example.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'custom',
        rawProvider: 'custom',
        customBaseUrl: 'https://my-relay.example.com/v1',
      }
    );

    expect((model.compat as { dropsThinkingInHistory?: boolean })?.dropsThinkingInHistory).toBe(
      false
    );
    expect(
      (model.compat as { requiresThinkingInContent?: boolean })?.requiresThinkingInContent
    ).toBe(false);
  });

  it('uses top-level reasoning replay for provider-prefixed DeepSeek model ids', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'deepseek/deepseek-v4-flash',
        name: 'deepseek/deepseek-v4-flash',
        api: 'openai-completions',
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openrouter',
        rawProvider: 'openrouter',
        customBaseUrl: 'https://openrouter.ai/api/v1',
      }
    );

    expect((model.compat as { dropsThinkingInHistory?: boolean })?.dropsThinkingInHistory).toBe(
      false
    );
    expect(
      (model.compat as { requiresThinkingInContent?: boolean })?.requiresThinkingInContent
    ).toBe(false);
  });

  it('does not drop thinking for unrelated custom endpoint model ids', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'custom-reasoner',
        name: 'custom-reasoner',
        api: 'openai-completions',
        provider: 'custom',
        baseUrl: 'https://my-relay.example.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'custom',
        rawProvider: 'custom',
        customBaseUrl: 'https://my-relay.example.com/v1',
      }
    );

    expect((model.compat as { dropsThinkingInHistory?: boolean })?.dropsThinkingInHistory).toBe(
      undefined
    );
    expect(
      (model.compat as { requiresThinkingInContent?: boolean })?.requiresThinkingInContent
    ).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store-env.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = {
        ...(options?.defaults || {}),
      };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = {
        ...this.store,
        ...key,
      };
    }

    clear(): void {
      this.store = {};
    }
  }

  return {
    default: MockStore,
  };
});

import {
  ConfigStore,
  type ProviderProfileKey,
  type ProviderType,
} from '../src/main/config/config-store';

describe('ConfigStore applyToEnv', () => {
  const originalEnv = {
    COWORK_WORKDIR: process.env.COWORK_WORKDIR,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  };

  beforeEach(() => {
    delete process.env.COWORK_WORKDIR;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_BASE_URL;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv.COWORK_WORKDIR === undefined) {
      delete process.env.COWORK_WORKDIR;
    } else {
      process.env.COWORK_WORKDIR = originalEnv.COWORK_WORKDIR;
    }
    if (originalEnv.ANTHROPIC_API_KEY === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    }
    if (originalEnv.ANTHROPIC_AUTH_TOKEN === undefined) {
      delete process.env.ANTHROPIC_AUTH_TOKEN;
    } else {
      process.env.ANTHROPIC_AUTH_TOKEN = originalEnv.ANTHROPIC_AUTH_TOKEN;
    }
    if (originalEnv.ANTHROPIC_BASE_URL === undefined) {
      delete process.env.ANTHROPIC_BASE_URL;
    } else {
      process.env.ANTHROPIC_BASE_URL = originalEnv.ANTHROPIC_BASE_URL;
    }
    if (originalEnv.OPENAI_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    }
    if (originalEnv.OPENAI_BASE_URL === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL;
    }
    if (originalEnv.OPENAI_MODEL === undefined) {
      delete process.env.OPENAI_MODEL;
    } else {
      process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL;
    }
    if (originalEnv.GEMINI_API_KEY === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    }
    if (originalEnv.GEMINI_BASE_URL === undefined) {
      delete process.env.GEMINI_BASE_URL;
    } else {
      process.env.GEMINI_BASE_URL = originalEnv.GEMINI_BASE_URL;
    }
  });

  it('updates Personal Analysis updatedAt only when connection settings change', () => {
    vi.useFakeTimers();
    const store = new ConfigStore();

    vi.setSystemTime(new Date('2026-06-10T01:00:00.000Z'));
    store.update({
      personalAnalysis: {
        apiOrigin: 'http://127.0.0.1:3000',
        apiKey: 'first-key',
      },
    });
    const firstUpdatedAt = store.get('personalAnalysis').updatedAt;
    expect(firstUpdatedAt).toBe(new Date('2026-06-10T01:00:00.000Z').getTime());

    vi.setSystemTime(new Date('2026-06-10T02:00:00.000Z'));
    store.update({
      personalAnalysis: {
        apiOrigin: 'http://127.0.0.1:3000',
        apiKey: 'first-key',
      },
    });
    expect(store.get('personalAnalysis').updatedAt).toBe(firstUpdatedAt);

    vi.setSystemTime(new Date('2026-06-10T03:00:00.000Z'));
    store.update({
      personalAnalysis: {
        apiOrigin: 'http://127.0.0.1:3000',
        apiKey: 'second-key',
      },
    });
    expect(store.get('personalAnalysis').updatedAt).toBe(
      new Date('2026-06-10T03:00:00.000Z').getTime()
    );
  });

  it('clears stale COWORK_WORKDIR when config value is removed', () => {
    const store = new ConfigStore();

    store.update({
      defaultWorkdir: '/tmp/cowork-valid-workdir',
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-5',
    });
    store.applyToEnv();
    expect(process.env.COWORK_WORKDIR).toBe('/tmp/cowork-valid-workdir');

    store.update({
      defaultWorkdir: '',
    });
    store.applyToEnv();

    expect(process.env.COWORK_WORKDIR).toBeUndefined();
  });

  it('exports loopback placeholder key for custom anthropic profile when api key is empty', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'custom',
      customProtocol: 'anthropic',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8082',
      model: 'openai/gpt-4.1-mini',
    });
    store.applyToEnv();

    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-local-proxy');
  });

  it('exports loopback placeholder key for custom openai profile when api key is empty', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'custom',
      customProtocol: 'openai',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8082/v1',
      model: 'gpt-4.1-mini',
    });
    store.applyToEnv();

    expect(process.env.OPENAI_API_KEY).toBe('sk-openai-local-proxy');
    expect(process.env.OPENAI_BASE_URL).toBe('http://127.0.0.1:8082/v1');
  });

  it('exports ollama placeholder key and normalized base url when api key is empty', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'https://ollama.example.internal/proxy/api',
      model: 'qwen3.5:0.8b',
    });
    store.applyToEnv();

    expect(process.env.OPENAI_API_KEY).toBe('sk-ollama-local-proxy');
    expect(process.env.OPENAI_BASE_URL).toBe('https://ollama.example.internal/proxy/v1');
    expect(process.env.OPENAI_MODEL).toBe('qwen3.5:0.8b');
  });

  it('exports requested dedicated providers through OpenAI-compatible env vars', () => {
    const cases: Array<{
      provider: Extract<ProviderType, 'deepseek' | 'moonshot' | 'aliyun' | 'zai' | 'openrouter'>;
      profileKey: ProviderProfileKey;
      baseUrl: string;
      model: string;
    }> = [
      {
        provider: 'deepseek',
        profileKey: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-pro',
      },
      {
        provider: 'moonshot',
        profileKey: 'moonshot',
        baseUrl: 'https://api.moonshot.ai/v1',
        model: 'kimi-k2.6',
      },
      {
        provider: 'aliyun',
        profileKey: 'aliyun',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3-max',
      },
      {
        provider: 'zai',
        profileKey: 'zai',
        baseUrl: 'https://api.z.ai/api/paas/v4',
        model: 'glm-5',
      },
      {
        provider: 'openrouter',
        profileKey: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-5.4',
      },
    ];

    for (const item of cases) {
      const store = new ConfigStore();
      store.update({
        provider: item.provider,
        customProtocol: 'openai',
        activeProfileKey: item.profileKey,
        apiKey: `sk-${item.provider}`,
        baseUrl: item.baseUrl,
        model: item.model,
      });
      store.applyToEnv();

      expect(process.env.OPENAI_API_KEY).toBe(`sk-${item.provider}`);
      expect(process.env.OPENAI_BASE_URL).toBe(item.baseUrl);
      expect(process.env.OPENAI_MODEL).toBe(item.model);
      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
    }
  });

  it('normalizes trailing /v1 for anthropic-compatible base url when applying env', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'custom',
      customProtocol: 'anthropic',
      apiKey: 'sk-test',
      baseUrl: 'https://api.duckcoding.ai/v1',
      model: 'gpt-5.3-codex',
    });
    store.applyToEnv();

    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.duckcoding.ai');
  });

  it('exports gemini credentials without leaking anthropic auth env', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'gemini',
      customProtocol: 'gemini',
      apiKey: 'AIza-test',
      baseUrl: 'https://generativelanguage.googleapis.com/',
      model: 'gemini/gemini-2.5-flash',
    });
    store.applyToEnv();

    expect(process.env.GEMINI_API_KEY).toBe('AIza-test');
    expect(process.env.GEMINI_BASE_URL).toBe('https://generativelanguage.googleapis.com');
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
});

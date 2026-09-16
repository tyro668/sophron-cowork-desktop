import { describe, expect, it } from 'vitest';
import { summarizeConfigUpdate } from '../src/main/features/config/log-summary';
import type { AppConfigUpdate } from '../src/shared/contracts';

const SECRET = 'sk-live-secret-value-123456';
const SET_SECRET = 'sk-set-secret-abcdef';

/**
 * The `config.save` log line must never contain an API key. The payload carries
 * keys at every nesting level — top-level `apiKey`, `profiles[*]`,
 * `configSets[*].profiles[*]`, `memoryRuntime.llm/embedding`, and
 * `personalAnalysis` — and log files are persisted and bundled by logs.export.
 */
describe('summarizeConfigUpdate', () => {
  it('never leaks apiKeys from any nesting level', () => {
    const update: AppConfigUpdate = {
      provider: 'openai',
      apiKey: SECRET,
      model: 'gpt-5.4',
      profiles: {
        openai: { apiKey: SECRET, baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4' },
        anthropic: { apiKey: SECRET, model: 'claude-sonnet-4-6' },
      },
      configSets: [
        {
          id: 'set-1',
          name: '工作',
          provider: 'openai',
          customProtocol: 'openai',
          activeProfileKey: 'openai',
          profiles: {
            openai: { apiKey: SET_SECRET, model: 'gpt-5.4' },
          },
          enableThinking: false,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      memoryRuntime: {
        llm: {
          inheritFromActive: false,
          provider: 'openai',
          apiKey: SECRET,
          model: 'gpt-5.4',
          timeoutMs: 180000,
        },
        embedding: {
          inheritFromActive: true,
          apiKey: SECRET,
          model: 'text-embedding-3-small',
          timeoutMs: 180000,
        },
        useEmbedding: true,
        maxNavSteps: 2,
        ingestionConcurrency: 4,
      },
      personalAnalysis: {
        apiOrigin: 'https://pa.example.com',
        apiKey: SECRET,
      },
    };

    const summary = summarizeConfigUpdate(update);
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(SET_SECRET);
    expect(serialized).not.toMatch(/"apiKey"\s*:/);
  });

  it('still reports which fields changed and non-sensitive values', () => {
    const summary = summarizeConfigUpdate({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-x',
      theme: 'dark',
      enableThinking: true,
      profiles: { anthropic: { apiKey: 'sk-y', model: 'claude-sonnet-4-6' } },
    });

    expect(summary.provider).toBe('anthropic');
    expect(summary.model).toBe('claude-sonnet-4-6');
    expect(summary.theme).toBe('dark');
    expect(summary.enableThinking).toBe(true);
    expect(summary.hasApiKey).toBe(true);
    expect(summary.profileKeys).toEqual(['anthropic']);
    expect(summary.updatedKeys).toEqual(
      ['apiKey', 'enableThinking', 'model', 'profiles', 'provider', 'theme'].sort()
    );
  });

  it('summarizes config sets without profile payloads', () => {
    const summary = summarizeConfigUpdate({
      configSets: [
        {
          id: 'set-9',
          name: 'n',
          provider: 'zai',
          customProtocol: 'openai',
          activeProfileKey: 'zai',
          profiles: { zai: { apiKey: 'sk-z', model: 'glm-5' } },
          enableThinking: false,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(summary.configSets).toEqual([
      { id: 'set-9', provider: 'zai', activeProfileKey: 'zai', profileKeys: ['zai'] },
    ]);
  });
});

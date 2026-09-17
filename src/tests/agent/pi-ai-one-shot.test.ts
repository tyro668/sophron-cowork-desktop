import { beforeEach, describe, expect, it, vi } from 'vitest';

const completeSimpleMock = vi.hoisted(() => vi.fn());

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: completeSimpleMock,
  getModel: vi.fn(() => undefined),
}));

vi.mock('../../main/agent/shared-auth', () => ({
  getSharedAuthStorage: () => ({
    setRuntimeApiKey: vi.fn(),
  }),
  ModelRegistry: vi.fn(),
}));

import type { AppConfig } from '../../main/config/config-store';
import { runPiAiOneShot } from '../../main/agent/pi-ai-one-shot';

function makeConfig(): AppConfig {
  return {
    provider: 'custom',
    customProtocol: 'openai',
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    model: 'test-model',
    activeProfileKey: 'custom:openai',
    profiles: {},
    activeConfigSetId: 'default',
    configSets: [],
    defaultWorkdir: '',
    globalSkillsPath: '',
    enableDevLogs: false,
    theme: 'light',
    permissionPolicy: 'auto_review',
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: {
        inheritFromActive: true,
        apiKey: '',
        baseUrl: '',
        model: '',
        timeoutMs: 180000,
      },
      embedding: {
        inheritFromActive: true,
        apiKey: '',
        baseUrl: '',
        model: 'text-embedding-3-small',
        timeoutMs: 180000,
      },
      useEmbedding: false,
      maxNavSteps: 2,
      ingestionConcurrency: 4,
      storageRoot: '',
      evalEnabled: false,
      evalWorkspaces: [],
      evalMaxRounds: 12,
      evalArtifactsRoot: '',
      promptIterationRounds: 2,
    },
    personalAnalysis: {
      apiOrigin: '',
      apiKey: '',
      updatedAt: 0,
    },
    enableThinking: false,
    isConfigured: true,
  };
}

describe('runPiAiOneShot', () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'stop',
    });
  });

  it('passes generation options through to completeSimple', async () => {
    await runPiAiOneShot('hello', 'system', makeConfig(), {
      temperature: 0.2,
      maxTokens: 1234,
    });

    expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({
      apiKey: 'test-key',
      temperature: 0.2,
      maxTokens: 1234,
    });
  });

  it('drops temperature for openai-codex models (ChatGPT backend rejects it)', async () => {
    await runPiAiOneShot(
      'hello',
      'system',
      {
        ...makeConfig(),
        provider: 'openai-codex',
        customProtocol: undefined,
        baseUrl: undefined,
        model: 'gpt-5.1-codex',
      },
      { temperature: 0.2, maxTokens: 1234 }
    );

    expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    const passedModel = completeSimpleMock.mock.calls[0][0];
    expect(passedModel.api).toBe('openai-codex-responses');
    const passedOptions = completeSimpleMock.mock.calls[0][2];
    expect(passedOptions).not.toHaveProperty('temperature');
    expect(passedOptions).toMatchObject({ maxTokens: 1234 });
  });
});

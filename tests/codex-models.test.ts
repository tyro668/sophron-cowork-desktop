import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { API_PROVIDER_PRESETS } from '../src/shared/api-model-presets';
import {
  listCodexSubscriptionModelOptions,
  parseCodexModelsCache,
} from '../src/main/config/codex-models';

describe('codex subscription model catalog', () => {
  let tmpDir = '';

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
  });

  it('lists visible API models from the local Codex cache in priority order', () => {
    const models = parseCodexModelsCache(
      JSON.stringify({
        models: [
          {
            slug: 'gpt-5.6-sol',
            display_name: 'GPT-5.6-Sol',
            visibility: 'list',
            supported_in_api: true,
            priority: 5,
          },
          {
            slug: 'gpt-6.1-sol',
            display_name: 'GPT-6.1-Sol',
            visibility: 'list',
            supported_in_api: true,
            priority: 1,
          },
          {
            slug: 'gpt-5.5',
            display_name: 'GPT-5.5',
            visibility: 'hide',
            supported_in_api: true,
            priority: 0,
          },
          {
            slug: 'codex-auto-review',
            display_name: 'Codex Auto Review',
            visibility: 'list',
            supported_in_api: false,
            priority: 2,
          },
          { slug: ' ', display_name: 'blank', visibility: 'list', priority: 1 },
        ],
      })
    );

    expect(models).toEqual([
      { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol' },
    ]);
  });

  it('returns no models for a missing or unreadable cache', () => {
    expect(parseCodexModelsCache('{')).toEqual([]);
    expect(parseCodexModelsCache('{"models":{}}')).toEqual([]);
  });

  it('merges cache models ahead of the static subscription preset', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-models-'));
    const cachePath = path.join(tmpDir, 'models_cache.json');
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        models: [
          {
            slug: 'gpt-6.1-sol',
            display_name: 'GPT-6.1-Sol',
            visibility: 'list',
            supported_in_api: true,
            priority: 1,
          },
          {
            slug: 'gpt-future',
            display_name: 'GPT Future',
            visibility: 'list',
            supported_in_api: true,
            priority: 2,
          },
        ],
      })
    );

    const models = listCodexSubscriptionModelOptions(
      API_PROVIDER_PRESETS['openai-codex'].models,
      cachePath
    );

    expect(models.map((model) => model.id).slice(0, 2)).toEqual(['gpt-6.1-sol', 'gpt-future']);
    expect(models.find((model) => model.id === 'gpt-6.1-sol')?.name).toBe('GPT-6.1 Sol');
    expect(models.find((model) => model.id === 'gpt-future')?.name).toBe('GPT Future');
    expect(models.map((model) => model.id)).toContain('gpt-6-astra');
    expect(models.map((model) => model.id)).not.toContain('gpt-5.5');
  });

  it('keeps the static subscription lineup when the cache file is absent', () => {
    const missingPath = path.join(os.tmpdir(), 'codex-models-missing', 'models_cache.json');
    const models = listCodexSubscriptionModelOptions(
      API_PROVIDER_PRESETS['openai-codex'].models,
      missingPath
    );
    expect(models.map((model) => model.id)).toEqual(
      API_PROVIDER_PRESETS['openai-codex'].models.map((model) => model.id)
    );
  });
});

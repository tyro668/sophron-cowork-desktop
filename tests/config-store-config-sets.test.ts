import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  seed: {} as Record<string, unknown>,
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = {
        ...(options?.defaults || {}),
        ...mocks.seed,
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

import { ConfigStore } from '../src/main/config/config-store';

describe('ConfigStore config sets', () => {
  beforeEach(() => {
    mocks.seed = {};
  });

  it('migrates legacy fields into default config set transparently', () => {
    mocks.seed = {
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-legacy-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5-mini',
      enableThinking: true,
      isConfigured: true,
    };

    const store = new ConfigStore();
    const config = store.getAll();

    expect(config.activeConfigSetId).toBe('default');
    expect(config.configSets.length).toBe(1);
    expect(config.configSets[0].isSystem).toBe(true);
    expect(config.configSets[0].provider).toBe('openai');
    expect(config.provider).toBe('openai');
    expect(config.apiKey).toBe('sk-legacy-openai');
    expect(config.enableThinking).toBe(true);
  });

  it('creates/switches sets without polluting other sets', () => {
    mocks.seed = {
      provider: 'openrouter',
      customProtocol: 'anthropic',
      apiKey: 'sk-openrouter-origin',
      baseUrl: 'https://openrouter.ai/api',
      model: 'anthropic/claude-sonnet-4-6',
      enableThinking: false,
      isConfigured: true,
    };

    const store = new ConfigStore();

    const created = store.createSet({ name: 'Work OpenAI', mode: 'clone' });
    expect(created.configSets.length).toBe(2);
    const newSet = created.configSets.find((set) => set.id !== 'default');
    expect(newSet?.name).toBe('Work OpenAI');
    // Creating a set must not change the default set.
    expect(created.activeConfigSetId).toBe('default');

    store.switchSet({ id: newSet!.id });
    store.update({ provider: 'openai', apiKey: 'sk-openai-new', model: 'gpt-5-mini' });
    const openaiSetView = store.getAll();
    expect(openaiSetView.provider).toBe('openai');
    expect(openaiSetView.apiKey).toBe('sk-openai-new');

    store.switchSet({ id: 'default' });
    const defaultSetView = store.getAll();
    expect(defaultSetView.provider).toBe('openrouter');
    expect(defaultSetView.apiKey).toBe('sk-openrouter-origin');
  });

  it('updates a specific set without changing the default set', () => {
    mocks.seed = {
      provider: 'openrouter',
      customProtocol: 'anthropic',
      apiKey: 'sk-openrouter-origin',
      baseUrl: 'https://openrouter.ai/api',
      model: 'anthropic/claude-sonnet-4-6',
      enableThinking: false,
      isConfigured: true,
    };

    const store = new ConfigStore();
    const created = store.createSet({ name: 'Side Set', mode: 'clone' });
    const sideSet = created.configSets.find((set) => set.id !== 'default');
    expect(sideSet).toBeTruthy();

    const updated = store.updateSet({
      id: sideSet!.id,
      updates: {
        provider: 'openai',
        activeProfileKey: 'openai',
        apiKey: 'sk-side-set',
        model: 'gpt-5-mini',
        profiles: {
          openai: {
            apiKey: 'sk-side-set',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-5-mini',
          },
        },
      },
    });

    // The default set and the top-level projection stay untouched.
    expect(updated.activeConfigSetId).toBe('default');
    expect(updated.provider).toBe('openrouter');
    expect(updated.apiKey).toBe('sk-openrouter-origin');
    const updatedSideSet = updated.configSets.find((set) => set.id === sideSet!.id);
    expect(updatedSideSet?.provider).toBe('openai');
    expect(updatedSideSet?.profiles.openai?.apiKey).toBe('sk-side-set');
    expect(updatedSideSet?.isSystem).toBe(false);

    // activeConfigSetId inside updates is ignored and cannot hijack the default.
    const hijackAttempt = store.updateSet({
      id: sideSet!.id,
      updates: { activeConfigSetId: sideSet!.id, model: 'gpt-5' },
    });
    expect(hijackAttempt.activeConfigSetId).toBe('default');

    // Updating the default set itself reflects in the projection.
    const updatedDefault = store.updateSet({
      id: 'default',
      updates: { apiKey: 'sk-openrouter-updated' },
    });
    expect(updatedDefault.apiKey).toBe('sk-openrouter-updated');

    expect(() => store.updateSet({ id: 'missing', updates: {} })).toThrowError();
  });

  it('transfers default protection on switch so the old default becomes deletable', () => {
    const store = new ConfigStore();

    // Initially the built-in default set is active and protected.
    expect(() => store.deleteSet({ id: 'default' })).toThrowError();

    const created = store.createSet({ name: 'My Set', mode: 'clone' });
    const customSet = created.configSets.find((set) => set.id !== 'default');
    expect(customSet).toBeTruthy();

    // Creating does not switch the default; only an explicit switch transfers
    // the default (and its delete protection) to the new set.
    expect(created.activeConfigSetId).toBe('default');
    expect(created.configSets.find((set) => set.id === 'default')?.isSystem).toBe(true);
    expect(created.configSets.find((set) => set.id === customSet!.id)?.isSystem).toBe(false);

    const switched = store.switchSet({ id: customSet!.id });
    expect(switched.activeConfigSetId).toBe(customSet!.id);
    expect(switched.configSets.find((set) => set.id === customSet!.id)?.isSystem).toBe(true);
    expect(switched.configSets.find((set) => set.id === 'default')?.isSystem).toBe(false);

    // The active default is protected; the previous default can be deleted.
    expect(() => store.deleteSet({ id: customSet!.id })).toThrowError();
    const afterDelete = store.deleteSet({ id: 'default' });
    expect(afterDelete.configSets.length).toBe(1);
    expect(afterDelete.activeConfigSetId).toBe(customSet!.id);
    expect(afterDelete.configSets[0].isSystem).toBe(true);
  });

  it('guards the active default and keeps the active set after deleting a non-default set', () => {
    const store = new ConfigStore();
    const created = store.createSet({ name: 'My Set', mode: 'clone' });
    const customSet = created.configSets.find((set) => set.id !== 'default');
    expect(customSet).toBeTruthy();

    const renamed = store.renameSet({ id: customSet!.id, name: 'My Renamed Set' });
    const renamedSet = renamed.configSets.find((set) => set.id === customSet!.id);
    expect(renamedSet?.name).toBe('My Renamed Set');

    store.switchSet({ id: 'default' });
    const afterDelete = store.deleteSet({ id: customSet!.id });
    expect(afterDelete.activeConfigSetId).toBe('default');
    expect(afterDelete.configSets.length).toBe(1);
  });

  it('creates blank set with no provider selected and pristine profiles', () => {
    mocks.seed = {
      provider: 'custom',
      customProtocol: 'openai',
      apiKey: 'sk-existing',
      baseUrl: 'https://example.com/v1',
      model: 'custom-model',
      enableThinking: true,
      isConfigured: true,
    };

    const store = new ConfigStore();
    const created = store.createSet({ name: 'Blank Set', mode: 'blank' });
    const blankSet = created.configSets.find((set) => set.id !== 'default');
    expect(blankSet).toBeTruthy();
    // A blank set must not inherit anything from the existing set.
    expect(blankSet?.provider).toBe('');
    expect(blankSet?.enableThinking).toBe(false);
    expect(blankSet?.profiles['custom:openai']?.apiKey).toBe('');
    expect(blankSet?.profiles['custom:openai']?.baseUrl).toBe('https://api.openai.com/v1');
    expect(blankSet?.profiles['custom:openai']?.model).toBe('gpt-5.4');
    // A blank set is never usable and its projection stays unconfigured.
    expect(store.hasUsableCredentialsForActiveSet()).toBe(true);
    // The projection still reflects the unchanged default set.
    expect(created.activeConfigSetId).toBe('default');
    expect(created.provider).toBe('custom');
    expect(created.customProtocol).toBe('openai');
    expect(created.apiKey).toBe('sk-existing');

    // Even when the blank set becomes the default, it reads as unconfigured.
    store.switchSet({ id: blankSet!.id });
    expect(store.hasUsableCredentialsForActiveSet()).toBe(false);
    expect(store.isConfigured()).toBe(true);
  });

  it('allows renaming default set but still blocks deleting it', () => {
    const store = new ConfigStore();
    const renamed = store.renameSet({ id: 'default', name: 'Main Profile' });
    expect(renamed.configSets[0].name).toBe('Main Profile');
    expect(() => store.deleteSet({ id: 'default' })).toThrowError();
  });

  it('creates blank set with pristine gemini profile defaults intact', () => {
    mocks.seed = {
      provider: 'gemini',
      customProtocol: 'gemini',
      apiKey: 'AIza-existing',
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: 'gemini/gemini-2.5-pro',
      enableThinking: false,
      isConfigured: true,
    };

    const store = new ConfigStore();
    const created = store.createSet({ name: 'Gemini Blank', mode: 'blank' });
    const blankSet = created.configSets.find((set) => set.id !== 'default');

    expect(blankSet?.provider).toBe('');
    expect(blankSet?.profiles.gemini?.apiKey).toBe('');
    expect(blankSet?.profiles.gemini?.baseUrl).toBe('https://generativelanguage.googleapis.com');
    expect(blankSet?.profiles.gemini?.model).toBe('gemini-2.5-flash');
  });

  it('persists theme preference across config mutations', () => {
    mocks.seed = {
      theme: 'dark',
      isConfigured: true,
    };

    const store = new ConfigStore();
    expect(store.get('theme')).toBe('dark');

    store.update({ theme: 'system' });
    expect(store.get('theme')).toBe('system');

    const created = store.createSet({ name: 'Theme Carry', mode: 'clone' });
    expect(created.theme).toBe('system');
  });

  it('accepts light theme and falls back to default for invalid theme values', () => {
    mocks.seed = {
      theme: 'light',
      isConfigured: true,
    };

    const lightStore = new ConfigStore();
    expect(lightStore.get('theme')).toBe('light');

    mocks.seed = {
      theme: 'sepia',
      isConfigured: true,
    };

    const invalidStore = new ConfigStore();
    expect(invalidStore.get('theme')).toBe('light');
  });

  it('persists the selected logo and rejects an invalid stored variant', () => {
    const store = new ConfigStore();
    expect(store.get('logoVariant')).toBe('mark');
    store.update({ logoVariant: 'fold' });
    expect(store.get('logoVariant')).toBe('fold');
    expect(store.createSet({ name: 'Logo carry', mode: 'clone' }).logoVariant).toBe('fold');

    mocks.seed = { logoVariant: 'unknown' };
    const invalidStore = new ConfigStore();
    expect(invalidStore.get('logoVariant')).toBe('mark');
  });

  it('persists the selected permission policy across reopen and config-set changes', () => {
    const store = new ConfigStore();
    expect(store.get('permissionPolicy')).toBe('auto_review');

    store.update({ permissionPolicy: 'default' });
    const created = store.createSet({ name: 'Policy Carry', mode: 'clone' });
    expect(created.permissionPolicy).toBe('default');

    mocks.seed = { ...store.getAll() };
    const reopened = new ConfigStore();
    expect(reopened.get('permissionPolicy')).toBe('default');
  });

  it('persists thinking level per set and projects it into runtime config', () => {
    const store = new ConfigStore();
    expect(store.get('thinkingLevel')).toBe('medium');

    store.update({ enableThinking: true, thinkingLevel: 'high' });
    expect(store.get('thinkingLevel')).toBe('high');
    expect(store.getAll().configSets[0].thinkingLevel).toBe('high');
    expect(store.getRuntimeConfigForSet('default')?.thinkingLevel).toBe('high');

    // Cloning carries the level over; other sets keep their own value.
    const created = store.createSet({ name: 'High Think', mode: 'clone' });
    const clone = created.configSets.find((set) => set.id !== 'default');
    expect(clone?.thinkingLevel).toBe('high');

    store.updateSet({ id: clone!.id, updates: { thinkingLevel: 'low' } });
    expect(store.getRuntimeConfigForSet(clone!.id)?.thinkingLevel).toBe('low');
    expect(store.get('thinkingLevel')).toBe('high');
  });

  it('normalizes missing or invalid thinking level to the default', () => {
    // Legacy seeds have no thinkingLevel at all.
    mocks.seed = {
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-legacy',
      model: 'gpt-5-mini',
      enableThinking: true,
      isConfigured: true,
    };
    const legacyStore = new ConfigStore();
    expect(legacyStore.get('thinkingLevel')).toBe('medium');
    expect(legacyStore.getAll().configSets[0].thinkingLevel).toBe('medium');

    mocks.seed = { thinkingLevel: 'ultra' };
    const invalidStore = new ConfigStore();
    expect(invalidStore.get('thinkingLevel')).toBe('medium');
  });
});

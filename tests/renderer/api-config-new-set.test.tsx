// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronApi } from '../../src/shared/contracts/electron-api';
import { API_PROVIDER_PRESETS } from '../../src/shared/api-model-presets';
import './i18n-test';

const mocks = vi.hoisted(() => ({ seed: {} as Record<string, unknown> }));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-api-config-new-set.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options.defaults || {}), ...mocks.seed };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
      } else {
        this.store = { ...this.store, ...key };
      }
    }

    clear(): void {
      this.store = {};
    }
  }
  return { default: MockStore };
});

describe('new API config set editor', () => {
  beforeEach(() => {
    mocks.seed = {};
  });

  it('keeps the first saved provider and model after save and remount', async () => {
    const { ConfigStore } = await import('../../src/main/config/config-store');
    const store = new ConfigStore();
    (window as unknown as { electronAPI: ElectronApi }).electronAPI = {
      config: {
        get: async () => store.getAll(),
        getPresets: async () => API_PROVIDER_PRESETS,
        createSet: async (payload: Parameters<ElectronApi['config']['createSet']>[0]) => ({
          success: true,
          config: store.createSet(payload),
        }),
        updateSet: async (payload: Parameters<ElectronApi['config']['updateSet']>[0]) => ({
          success: true,
          config: store.updateSet(payload),
        }),
        save: async (payload: Parameters<ElectronApi['config']['save']>[0]) => {
          store.update(payload);
          return { success: true, config: store.getAll() };
        },
      },
    } as unknown as ElectronApi;
    const { useApiConfigState } = await import('../../src/renderer/hooks/useApiConfigState');
    const editor = renderHook(() => useApiConfigState());
    await waitFor(() => expect(editor.result.current.isLoadingConfig).toBe(false));

    await act(async () => {
      await editor.result.current.createConfigSet({ name: 'New', mode: 'blank' });
    });
    const selectedId = editor.result.current.selectedConfigSetId;
    expect(selectedId).not.toBe('default');
    expect(editor.result.current.providerUnset).toBe(true);
    expect(editor.result.current.hasUnsavedChanges).toBe(false);
    act(() => {
      editor.result.current.changeProvider('deepseek');
    });
    expect(editor.result.current.hasUnsavedChanges).toBe(true);
    act(() => {
      editor.result.current.changeProvider('openai');
    });
    act(() => {
      editor.result.current.setApiKey('sk-test');
      editor.result.current.toggleCustomModel();
    });
    act(() => {
      editor.result.current.setCustomModel('gpt-5.2');
    });
    let saved = false;
    await act(async () => {
      saved = await editor.result.current.handleSave();
    });
    expect({
      saved,
      error: editor.result.current.error,
      providerUnset: editor.result.current.providerUnset,
    }).toEqual({ saved: true, error: '', providerUnset: false });
    expect(store.getAll().configSets.find((set) => set.id === selectedId)?.provider).toBe('openai');
    expect(
      store.getAll().configSets.find((set) => set.id === selectedId)?.profiles.openai?.model
    ).toBe('gpt-5.2');
    expect(editor.result.current.provider).toBe('openai');
    expect(editor.result.current.model).toBe('gpt-5.2');
    expect(editor.result.current.customModel).toBe('gpt-5.2');
    expect(editor.result.current.useCustomModel).toBe(true);

    // Reopening the page must select the persisted active set, not the
    // provisional "default" id used before the async config.get() resolves.
    store.switchSet({ id: selectedId });
    editor.unmount();
    const reopened = renderHook(() => useApiConfigState());
    await waitFor(() => expect(reopened.result.current.isLoadingConfig).toBe(false));
    expect(reopened.result.current.selectedConfigSetId).toBe(selectedId);
    expect(reopened.result.current.provider).toBe('openai');
    expect(reopened.result.current.model).toBe('gpt-5.2');
    expect(reopened.result.current.customModel).toBe('gpt-5.2');
    expect(reopened.result.current.useCustomModel).toBe(true);
    act(() => reopened.result.current.toggleCustomModel());
    expect(reopened.result.current.useCustomModel).toBe(false);
    expect(reopened.result.current.model).toBe(API_PROVIDER_PRESETS.openai.models[0]?.id);
  });
});

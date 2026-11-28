// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { makeBuiltinLlmConfigSetId } from '../../src/shared/builtin-llm';
import type { ApiConfigSet, AppConfig } from '../../src/shared/contracts';
import {
  AgentModelSelector,
  getAgentModelLabel,
} from '../../src/renderer/components/AgentModelSelector';
import { LlmPromptComposer } from '../../src/renderer/components/LlmPromptComposer';
import './i18n-test';

const route = 'dev_fixture/adapter/model-id';
const localSet: ApiConfigSet = {
  id: 'local-set',
  name: 'lmbp',
  provider: 'lmbp',
  customProtocol: 'openai',
  activeProfileKey: 'lmbp',
  profiles: { lmbp: { apiKey: '', model: route } },
  enableThinking: false,
  thinkingLevel: 'medium',
  updatedAt: '2026-01-01T00:00:00Z',
};
const otherSet = { ...localSet, id: 'other-set', name: 'Research' };
const config = {
  provider: 'lmbp',
  model: route,
  activeConfigSetId: localSet.id,
  configSets: [localSet, otherSet],
} as AppConfig;

it('shows only scheme names and submits the selected scheme and its actual model', async () => {
  const onModelSelect = vi.fn();
  const props = { appConfig: config, value: '', onChange: vi.fn(), onModelSelect };
  const view = render(<LlmPromptComposer {...props} />);
  expect(getAgentModelLabel(config, 'No model')).toBe(localSet.name);
  expect(getAgentModelLabel(config, 'No model', otherSet.id)).toBe(otherSet.name);
  expect(getAgentModelLabel(config, 'No model', 'removed-set')).toBe('No model');
  const trigger = screen.getByRole('button', { name: localSet.name });
  expect(trigger.title).toBe(localSet.name);
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(await screen.findByRole('menuitem', { name: localSet.name })).toBeTruthy();
  const other = screen.getByRole('menuitem', { name: otherSet.name });
  expect(document.body.textContent).not.toContain(route);
  fireEvent.click(other);
  expect(onModelSelect).toHaveBeenCalledWith({ configSetId: otherSet.id, model: route });
  view.rerender(<LlmPromptComposer {...props} selectedModelConfigSetId={otherSet.id} />);
  expect(screen.getByRole('button', { name: otherSet.name }).title).toBe(otherSet.name);
});

it('uses the advertised name for a built-in model and selects it by its catalog ID', async () => {
  const builtin = { id: 'catalog-id', name: 'Built-in Assistant', upstreamModel: 'upstream-id' };
  const selectedId = makeBuiltinLlmConfigSetId(builtin.id);
  vi.stubGlobal('electronAPI', { config: { listModels: async () => [builtin] } });
  const onSelect = vi.fn();
  try {
    render(
      <AgentModelSelector
        open
        onOpenChange={vi.fn()}
        appConfig={config}
        selectedConfigSetId={selectedId}
        fallbackLabel="No model"
        triggerClassName=""
        onSelect={onSelect}
      />
    );
    const item = await screen.findByRole('menuitem', { name: builtin.name });
    expect(screen.getByTitle(builtin.name).textContent).toBe(builtin.name);
    expect(document.body.textContent).not.toContain(builtin.upstreamModel);
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith(selectedId);
  } finally {
    vi.unstubAllGlobals();
  }
});

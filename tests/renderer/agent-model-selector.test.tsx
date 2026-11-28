// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { getLmbpModelOptions } from '../../src/shared/model-display';
import { makeBuiltinLlmConfigSetId } from '../../src/shared/builtin-llm';
import type { ApiConfigSet, AppConfig } from '../../src/shared/contracts';
import {
  AgentModelSelector,
  getAgentModelDisplayId,
  getAgentModelId,
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

it('displays the upstream model ID while keeping the selected device and scheme for requests', () => {
  const model = 'org/model-id';
  const routes = ['opaque-request-a', 'opaque-request-b'];
  const sets = [localSet, otherSet].map((set, index) => ({
    ...set,
    profiles: { lmbp: { apiKey: '', model: routes[index] } },
  }));
  const selection = { ...config, configSets: sets };
  for (const [index, set] of sets.entries()) {
    expect(
      getAgentModelDisplayId(selection, set.id, Object.fromEntries(routes.map((id) => [id, model])))
    ).toBe(model);
    expect(getAgentModelId(selection, set.id)).toBe(routes[index]);
  }
  const external = { ...config, provider: 'openrouter' as const, model: 'dev_team/org/model-id' };
  expect(getAgentModelDisplayId(external, undefined, {})).toBe(external.model);
});

it('labels multi-model schemes and same-named schemes on other devices without parsing a route', () => {
  const first = {
    routeId: 'route-a',
    modelId: 'org/vision',
    device: { id: 'A', name: 'Laptop' },
    scheme: { id: 'work', name: 'Work · Lab' },
    capabilities: ['vision'],
  };
  const second = { ...first, routeId: 'route-b', modelId: 'org/text' };
  const third = { ...first, routeId: 'route-c', device: { id: 'B', name: 'Studio' } };
  expect(getLmbpModelOptions([first])[0].name).toBe('Work · Lab');
  const options = getLmbpModelOptions([first, second, third]);
  expect(options.map(({ id, name }) => [id, name])).toEqual([
    ['route-a', 'Work · Lab · org/vision · Laptop'],
    ['route-b', 'Work · Lab · org/text · Laptop'],
    ['route-c', 'Work · Lab · org/vision · Studio'],
  ]);
  const sameDeviceName = { ...third, device: { ...third.device, name: 'Laptop' } };
  expect(getLmbpModelOptions([sameDeviceName, first]).map((option) => option.name)).toEqual([
    'Work · Lab · Laptop (2)',
    'Work · Lab · Laptop (1)',
  ]);
});

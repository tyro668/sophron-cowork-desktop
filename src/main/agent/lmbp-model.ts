import type { AgentRuntimeConfig } from '../../shared/contracts';
import { getLmbpGateway } from '../config/lmbp-gateway';
import { buildSyntheticPiModel } from './pi-model-resolution';

export async function resolveLmbpTarget(config: AgentRuntimeConfig) {
  const route = (await getLmbpGateway()).resolveModel(config.model);
  const model = buildSyntheticPiModel(
    config.model,
    'lmbp',
    'anthropic',
    route.origin,
    'anthropic-messages',
    false,
    config.contextWindow,
    config.maxTokens
  );
  model.headers = route.headers;
  model.input = route.capabilities.includes('vision') ? ['text', 'image'] : ['text'];
  return { model, apiKey: route.apiKey, capabilities: route.capabilities };
}

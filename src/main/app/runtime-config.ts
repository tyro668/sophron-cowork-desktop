import { parseBuiltinLlmConfigSetId } from '../../shared/builtin-llm';
import type { ApiTestInput, AgentRuntimeConfig } from '../../shared/contracts';
import { configStore, type AppConfig } from '../config/config-store';
import { resolveDesktopLlmBaseUrl } from '../config/desktop-auth-config';
import { desktopAuthService } from './context';

export function withSophronRuntimeAuth<T extends AppConfig | AgentRuntimeConfig>(config: T): T {
  if (config.provider !== 'sophron') {
    return config;
  }

  const apiOrigin = configStore.get('personalAnalysis')?.apiOrigin;
  return {
    ...config,
    provider: 'sophron',
    customProtocol: 'openai',
    apiKey: desktopAuthService.requireLlmAccessToken(),
    baseUrl: resolveDesktopLlmBaseUrl(apiOrigin),
  };
}

export function resolveAgentRuntimeConfigForAuth(
  config?: AgentRuntimeConfig | null
): AgentRuntimeConfig | undefined {
  const runtimeConfig =
    config ?? configStore.getRuntimeConfigForSet(configStore.get('activeConfigSetId')) ?? undefined;
  if (!runtimeConfig) {
    return undefined;
  }
  return withSophronRuntimeAuth(runtimeConfig);
}

export function resolveModelRuntimeConfigForAutomation(
  configSetId: string
): AgentRuntimeConfig | null {
  const builtinModel = parseBuiltinLlmConfigSetId(configSetId);
  if (builtinModel) {
    return (
      resolveAgentRuntimeConfigForAuth({
        provider: 'sophron',
        apiKey: '',
        baseUrl: '',
        customProtocol: 'openai',
        model: builtinModel,
        enableThinking: false,
      }) ?? null
    );
  }

  return resolveAgentRuntimeConfigForAuth(configStore.getRuntimeConfigForSet(configSetId)) ?? null;
}

export function resolveAppConfigForAuth(config: AppConfig = configStore.getAll()): AppConfig {
  return withSophronRuntimeAuth(config);
}

export function resolveApiTestInputForAuth(input: ApiTestInput): ApiTestInput {
  if (input.provider !== 'sophron') {
    return input;
  }
  const apiOrigin = configStore.get('personalAnalysis')?.apiOrigin;
  return {
    ...input,
    customProtocol: 'openai',
    apiKey: desktopAuthService.requireLlmAccessToken(),
    baseUrl: resolveDesktopLlmBaseUrl(apiOrigin),
  };
}

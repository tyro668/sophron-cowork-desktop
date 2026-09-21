import { parseBuiltinLlmConfigSetId } from '../../shared/builtin-llm';
import type { ApiTestInput, AgentRuntimeConfig } from '../../shared/contracts';
import { configStore, type AppConfig } from '../config/config-store';
import { resolveDesktopLlmBaseUrl } from '../config/desktop-auth-config';
import { desktopAuthService } from './context';

export async function withSophronRuntimeAuth<T extends AppConfig | AgentRuntimeConfig>(
  config: T
): Promise<T> {
  if (config.provider !== 'sophron') {
    return config;
  }

  const apiOrigin = desktopAuthService.getApiOrigin();
  return {
    ...config,
    provider: 'sophron',
    customProtocol: 'openai',
    apiKey: await desktopAuthService.requireLlmAccessToken(),
    baseUrl: resolveDesktopLlmBaseUrl(apiOrigin),
  };
}

export async function resolveAgentRuntimeConfigForAuth(
  config?: AgentRuntimeConfig | null
): Promise<AgentRuntimeConfig | undefined> {
  const runtimeConfig =
    config ?? configStore.getRuntimeConfigForSet(configStore.get('activeConfigSetId')) ?? undefined;
  if (!runtimeConfig) {
    return undefined;
  }
  return withSophronRuntimeAuth(runtimeConfig);
}

export async function resolveModelRuntimeConfigForAutomation(
  configSetId: string
): Promise<AgentRuntimeConfig | null> {
  const builtinModel = parseBuiltinLlmConfigSetId(configSetId);
  if (builtinModel) {
    return (
      (await resolveAgentRuntimeConfigForAuth({
        provider: 'sophron',
        apiKey: '',
        baseUrl: '',
        customProtocol: 'openai',
        model: builtinModel,
        enableThinking: false,
        thinkingLevel: 'medium',
      })) ?? null
    );
  }

  return (
    (await resolveAgentRuntimeConfigForAuth(configStore.getRuntimeConfigForSet(configSetId))) ??
    null
  );
}

export async function resolveAppConfigForAuth(
  config: AppConfig = configStore.getAll()
): Promise<AppConfig> {
  return withSophronRuntimeAuth(config);
}

export async function resolveApiTestInputForAuth(input: ApiTestInput): Promise<ApiTestInput> {
  if (input.provider !== 'sophron') {
    return input;
  }
  const apiOrigin = desktopAuthService.getApiOrigin();
  return {
    ...input,
    customProtocol: 'openai',
    apiKey: await desktopAuthService.requireLlmAccessToken(),
    baseUrl: resolveDesktopLlmBaseUrl(apiOrigin),
  };
}

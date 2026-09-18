import { appContext } from '../../app/context';
import { sendToRenderer } from '../../app/events';
import { startSandboxBootstrap } from '../../app/sandbox-bootstrap';
import { configStore, type AppConfig } from '../../config/config-store';
import { setPermissionRules } from '../../config/permission-rules-store';
import { getPermissionRulesForPolicy } from '../../../shared/permission-policies';
import { getSandboxBootstrap } from '../../sandbox/sandbox-bootstrap';
import { log, logError } from '../../utils/logger';

export const buildAgentRuntimeSignature = (config: AppConfig): string =>
  JSON.stringify({
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    customProtocol: config.customProtocol,
    model: config.model,
    enableThinking: config.enableThinking,
    thinkingLevel: config.thinkingLevel,
    memoryEnabled: config.memoryEnabled,
    memoryRuntime: config.memoryRuntime,
  });

export const syncConfigAfterMutation = async (previousConfig: AppConfig) => {
  // Mark as configured if any config set has usable credentials
  configStore.set('isConfigured', configStore.hasAnyUsableCredentials());

  // Apply to environment
  configStore.applyToEnv();

  const updatedConfig = configStore.getAll();
  if (previousConfig.permissionPolicy !== updatedConfig.permissionPolicy) {
    setPermissionRules(
      getPermissionRulesForPolicy(updatedConfig.permissionPolicy),
      updatedConfig.permissionPolicy
    );
  }
  const shouldReloadRunner =
    buildAgentRuntimeSignature(previousConfig) !== buildAgentRuntimeSignature(updatedConfig);
  const shouldReloadSandbox = previousConfig.sandboxEnabled !== updatedConfig.sandboxEnabled;

  if (shouldReloadSandbox) {
    getSandboxBootstrap().reset();
  }

  if (appContext.sessionManager) {
    if (shouldReloadRunner) {
      appContext.sessionManager.reloadConfig();
    }
    if (shouldReloadSandbox) {
      await appContext.sessionManager
        .reloadSandbox()
        .catch((err) => logError('[Config] Sandbox reload failed:', err));
    }
    if (shouldReloadRunner || shouldReloadSandbox) {
      log(
        '[Config] Session manager config synced:',
        JSON.stringify({ runnerReloaded: shouldReloadRunner, sandboxReloaded: shouldReloadSandbox })
      );
    }
  }

  if (shouldReloadSandbox && updatedConfig.sandboxEnabled !== false) {
    void startSandboxBootstrap();
  }

  // Notify renderer of config update
  const isConfigured = configStore.isConfigured();
  sendToRenderer({
    type: 'config.status',
    payload: {
      isConfigured,
      config: updatedConfig,
    },
  });
  log('[Config] Notified renderer of config update, isConfigured:', isConfigured);
  return updatedConfig;
};

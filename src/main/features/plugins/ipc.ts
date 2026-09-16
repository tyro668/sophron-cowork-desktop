import { appContext } from '../../app/context';
import { handleIpc } from '../../ipc-handle';
import { logError } from '../../utils/logger';

export function registerPluginsIpc(): void {
  handleIpc(
    'plugins.listCatalog',
    async (
      _event,
      options?: {
        installableOnly?: boolean;
        source?: 'skillhub' | 'claude-marketplace' | 'all';
        page?: number;
        pageSize?: number;
      }
    ) => {
      try {
        if (!appContext.pluginRuntimeService) {
          throw new Error('PluginRuntimeService not initialized');
        }
        return await appContext.pluginRuntimeService.listCatalog(options);
      } catch (error) {
        logError('[Plugins] Error listing catalog:', error);
        throw error;
      }
    }
  );

  handleIpc('plugins.listInstalled', async () => {
    try {
      if (!appContext.pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      return appContext.pluginRuntimeService.listInstalled();
    } catch (error) {
      logError('[Plugins] Error listing installed plugins:', error);
      throw error;
    }
  });

  handleIpc('plugins.install', async (_event, pluginName: string) => {
    try {
      if (!appContext.pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await appContext.pluginRuntimeService.install(pluginName);
      appContext.sessionManager?.invalidateSkillsSetup();
      return result;
    } catch (error) {
      logError('[Plugins] Error installing plugin:', error);
      throw error;
    }
  });

  handleIpc('plugins.setEnabled', async (_event, pluginId: string, enabled: boolean) => {
    try {
      if (!appContext.pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await appContext.pluginRuntimeService.setEnabled(pluginId, enabled);
      appContext.sessionManager?.invalidateSkillsSetup();
      return result;
    } catch (error) {
      logError('[Plugins] Error toggling plugin:', error);
      throw error;
    }
  });

  handleIpc(
    'plugins.setComponentEnabled',
    async (
      _event,
      pluginId: string,
      component: 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp',
      enabled: boolean
    ) => {
      try {
        if (!appContext.pluginRuntimeService) {
          throw new Error('PluginRuntimeService not initialized');
        }
        const result = await appContext.pluginRuntimeService.setComponentEnabled(
          pluginId,
          component,
          enabled
        );
        if (component === 'skills') {
          appContext.sessionManager?.invalidateSkillsSetup();
        }
        return result;
      } catch (error) {
        logError('[Plugins] Error toggling plugin component:', error);
        throw error;
      }
    }
  );

  handleIpc('plugins.uninstall', async (_event, pluginId: string) => {
    try {
      if (!appContext.pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await appContext.pluginRuntimeService.uninstall(pluginId);
      appContext.sessionManager?.invalidateSkillsSetup();
      return result;
    } catch (error) {
      logError('[Plugins] Error uninstalling plugin:', error);
      throw error;
    }
  });
}

import { ipcRenderer } from 'electron';
import type {
  InstalledPlugin,
  PluginCatalogItemV2,
  PluginComponentKind,
  PluginInstallResultV2,
  PluginToggleResult,
} from '../../shared/contracts';
import type { ElectronApi } from '../../shared/contracts/electron-api';

export function createPluginsApi(): ElectronApi['plugins'] {
  return {
    listCatalog: (options?: {
      installableOnly?: boolean;
      source?: 'skillhub' | 'claude-marketplace' | 'all';
      page?: number;
      pageSize?: number;
    }): Promise<PluginCatalogItemV2[]> => ipcRenderer.invoke('plugins.listCatalog', options),
    listInstalled: (): Promise<InstalledPlugin[]> => ipcRenderer.invoke('plugins.listInstalled'),
    install: (pluginName: string): Promise<PluginInstallResultV2> =>
      ipcRenderer.invoke('plugins.install', pluginName),
    setEnabled: (pluginId: string, enabled: boolean): Promise<PluginToggleResult> =>
      ipcRenderer.invoke('plugins.setEnabled', pluginId, enabled),
    setComponentEnabled: (
      pluginId: string,
      component: PluginComponentKind,
      enabled: boolean
    ): Promise<PluginToggleResult> =>
      ipcRenderer.invoke('plugins.setComponentEnabled', pluginId, component, enabled),
    uninstall: (pluginId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('plugins.uninstall', pluginId),
  };
}

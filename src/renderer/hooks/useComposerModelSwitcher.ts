import { configClient } from '../features/config/api/config-client';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { parseBuiltinLlmConfigSetId } from '../../shared/builtin-llm';
import { formatIpcError } from '../utils/ipc-error';

interface UseComposerModelSwitcherOptions {
  isElectron: boolean;
  onCloseMenu: () => void;
}

export function useComposerModelSwitcher({
  isElectron,
  onCloseMenu,
}: UseComposerModelSwitcherOptions) {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const setIsConfigured = useAppStore((s) => s.setIsConfigured);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);

  const handleModelOptionClick = useCallback(
    async (configSetId: string) => {
      onCloseMenu();
      if (!appConfig || !isElectron || !window.electronAPI) {
        return;
      }

      try {
        const builtinModel = parseBuiltinLlmConfigSetId(configSetId);
        if (!builtinModel && configSetId === appConfig.activeConfigSetId) {
          return;
        }
        if (
          builtinModel &&
          appConfig.provider === 'sophron' &&
          (appConfig.builtinLlmModel?.trim() || appConfig.model?.trim()) === builtinModel
        ) {
          return;
        }

        const result = builtinModel
          ? await configClient.selectBuiltinModel({ model: builtinModel })
          : await configClient.switchSet({ id: configSetId });
        if (result.success) {
          setAppConfig(result.config);
          setIsConfigured(Boolean(result.config.isConfigured));
        }
      } catch (error) {
        setGlobalNotice({
          id: `notice-model-switch-${Date.now()}`,
          type: 'error',
          message: formatIpcError(error, t('api.saveFailed')),
        });
      }
    },
    [appConfig, isElectron, onCloseMenu, setAppConfig, setGlobalNotice, setIsConfigured, t]
  );

  return { handleModelOptionClick };
}

import { DEFAULT_PERMISSION_POLICY } from '../../../shared/permission-policies';
import type { Settings } from '../../types';
import type { AppSliceCreator, ConfigSlice } from '../types';

const defaultSettings: Settings = {
  theme: 'light',
  accentTheme: 'lavender',
  logoVariant: 'mark',
  defaultTools: [
    'askuserquestion',
    'todowrite',
    'todoread',
    'webfetch',
    'websearch',
    'read',
    'write',
    'edit',
    'list_directory',
    'glob',
    'grep',
  ],
  permissionPolicy: DEFAULT_PERMISSION_POLICY,
  globalSkillsPath: '',
  memoryStrategy: 'auto',
  maxContextTokens: 180000,
};

export const createConfigSlice: AppSliceCreator<ConfigSlice> = (set) => ({
  settings: defaultSettings,
  appConfig: null,
  isConfigured: false,
  showConfigModal: false,
  hasSeenInitialConfigStatus: false,
  desktopAuthStatus: { authenticated: false, updatedAt: 0 },
  workingDir: null,
  systemDarkMode: false,

  setSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates },
    })),

  updateSettings: (updates) => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.send({
        type: 'settings.update',
        payload: updates as Record<string, unknown>,
      });
    }
    set((state) => ({
      settings: { ...state.settings, ...updates },
    }));
  },

  setAppConfig: (config) => set({ appConfig: config }),
  setIsConfigured: (configured) => set({ isConfigured: configured }),
  setShowConfigModal: (show) => set({ showConfigModal: show }),
  markInitialConfigStatusSeen: () => set({ hasSeenInitialConfigStatus: true }),
  setDesktopAuthStatus: (status) => set({ desktopAuthStatus: status }),
  setWorkingDir: (path) => set({ workingDir: path }),
  setSystemDarkMode: (dark) => set({ systemDarkMode: dark }),
});

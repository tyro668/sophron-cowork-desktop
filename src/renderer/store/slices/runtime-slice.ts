import type { PermissionRequest } from '../../types';
import type { AppSliceCreator, RuntimeSlice } from '../types';

export const createRuntimeSlice: AppSliceCreator<RuntimeSlice> = (set) => ({
  isLoading: false,
  sidebarCollapsed: false,
  contextPanelCollapsed: false,
  showSettings: false,
  settingsTab: null,
  pendingPermission: null,
  pendingPermissionQueue: [],
  pendingSudoPassword: null,
  globalNotice: null,
  sandboxSetupProgress: null,
  isSandboxSetupComplete: false,
  sandboxSyncStatus: null,
  skillsStorageChangedAt: 0,
  skillsStorageChangeEvent: null,

  setLoading: (loading) => set({ isLoading: loading }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleContextPanel: () =>
    set((state) => ({ contextPanelCollapsed: !state.contextPanelCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setContextPanelCollapsed: (collapsed) => set({ contextPanelCollapsed: collapsed }),
  setShowSettings: (show) => set({ showSettings: show }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),

  setPendingPermission: (permission) =>
    set((state) => {
      const pending = state.pendingPermission
        ? [state.pendingPermission, ...state.pendingPermissionQueue]
        : state.pendingPermissionQueue;
      const next = permission
        ? pending.some((item) => item.toolUseId === permission.toolUseId)
          ? pending.map((item) => (item.toolUseId === permission.toolUseId ? permission : item))
          : [...pending, permission]
        : pending.slice(1);
      return { pendingPermission: next[0] ?? null, pendingPermissionQueue: next.slice(1) };
    }),

  dismissPermission: (toolUseId) =>
    set((state) => {
      const next = [state.pendingPermission, ...state.pendingPermissionQueue].filter(
        (item): item is PermissionRequest => item !== null && item.toolUseId !== toolUseId
      );
      return { pendingPermission: next[0] ?? null, pendingPermissionQueue: next.slice(1) };
    }),

  setPendingSudoPassword: (request) => set({ pendingSudoPassword: request }),
  setGlobalNotice: (notice) => set({ globalNotice: notice }),
  clearGlobalNotice: () => set({ globalNotice: null }),
  setSandboxSetupProgress: (progress) => set({ sandboxSetupProgress: progress }),
  setSandboxSetupComplete: (complete) => set({ isSandboxSetupComplete: complete }),
  setSandboxSyncStatus: (status) => set({ sandboxSyncStatus: status }),
  setSkillsStorageChangedAt: (timestamp) => set({ skillsStorageChangedAt: timestamp }),
  setSkillsStorageChangeEvent: (event) => set({ skillsStorageChangeEvent: event }),
});

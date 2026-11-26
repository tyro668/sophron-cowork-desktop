import { create } from 'zustand';
import { createSessionSlice } from './slices/session-slice';
import { createNavigationSlice } from './slices/navigation-slice';
import { createConfigSlice } from './slices/config-slice';
import { createRuntimeSlice } from './slices/runtime-slice';
import { installWindowNavBridge } from './nav-bridge';
import type { AppState } from './types';

export type {
  AppState,
  ChatScriptJob,
  ConfigSlice,
  DataWorkspaceTab,
  GlobalNotice,
  GlobalNoticeAction,
  GlobalNoticeType,
  LiveToolOutput,
  MainView,
  NavigationSlice,
  PendingCloudAutomationTemplateNavigation,
  PendingCloudInputSource,
  PendingDataNavigation,
  PendingDataTabNavigation,
  PendingTableAutomationNavigation,
  RuntimeSlice,
  ScriptAutomationPrefill,
  ScriptEditorTarget,
  SessionExecutionClock,
  SessionSlice,
  SessionState,
} from './types';

export const useAppStore = create<AppState>((...args) => ({
  ...createSessionSlice(...args),
  ...createNavigationSlice(...args),
  ...createConfigSlice(...args),
  ...createRuntimeSlice(...args),
}));

installWindowNavBridge(useAppStore);

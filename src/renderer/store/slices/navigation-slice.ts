import type { AppSliceCreator, NavigationSlice } from '../types';

let scriptEditorSeq = 0;
let dataNavigationSeq = 0;
let dataTabNavigationSeq = 0;
let cloudAutomationTemplateNavigationSeq = 0;

export const createNavigationSlice: AppSliceCreator<NavigationSlice> = (set) => ({
  mainView: 'chat',
  newTaskNonce: 0,
  scriptEditor: null,
  chatScriptDialog: null,
  chatScriptJobs: {},
  pendingDataNavigation: null,
  pendingDataTabNavigation: null,
  pendingCloudAutomationTemplateNavigation: null,
  pendingTableAutomationNavigation: null,
  welcomeCloudTableChatDrafts: [],
  cloudTableChatDraftsBySession: {},
  pendingSkillMention: null,

  setMainView: (view) => set({ mainView: view }),

  openNewTask: () =>
    set((state) => ({
      mainView: 'chat' as const,
      activeSessionId: null,
      showSettings: false,
      newTaskNonce: state.newTaskNonce + 1,
    })),

  openScriptEditor: (target) => set({ scriptEditor: { ...target, nonce: ++scriptEditorSeq } }),
  closeScriptEditor: () => set({ scriptEditor: null }),

  openChatScriptDialog: (target) => set({ chatScriptDialog: target }),
  closeChatScriptDialog: () => set({ chatScriptDialog: null }),

  setChatScriptJob: (anchorId, job) =>
    set((state) => {
      const next = { ...state.chatScriptJobs };
      if (job) next[anchorId] = job;
      else delete next[anchorId];
      return { chatScriptJobs: next };
    }),

  navigateToDataElement: (target) =>
    set({
      mainView: 'data',
      showSettings: false,
      pendingDataNavigation: { ...target, nonce: ++dataNavigationSeq },
    }),

  navigateToDataTab: (tab) =>
    set({
      mainView: 'data',
      activeSessionId: null,
      showSettings: false,
      pendingDataTabNavigation: { tab, nonce: ++dataTabNavigationSeq },
    }),

  navigateToCloudData: () =>
    set({
      mainView: 'data',
      activeSessionId: null,
      showSettings: false,
      pendingDataTabNavigation: { tab: 'cloud_analysis', nonce: ++dataTabNavigationSeq },
    }),

  navigateToCloudAutomationTemplate: (rawTemplate) =>
    set({
      mainView: 'automation',
      activeSessionId: null,
      showSettings: false,
      pendingCloudAutomationTemplateNavigation: {
        rawTemplate,
        nonce: ++cloudAutomationTemplateNavigationSeq,
      },
    }),

  navigateToTableAutomation: (target) =>
    set({
      mainView: 'automation',
      activeSessionId: null,
      showSettings: false,
      pendingTableAutomationNavigation: target,
    }),

  clearDataNavigation: (nonce) =>
    set((state) => {
      if (nonce !== undefined && state.pendingDataNavigation?.nonce !== nonce) {
        return {};
      }
      return { pendingDataNavigation: null };
    }),

  clearDataTabNavigation: (nonce) =>
    set((state) => {
      if (nonce !== undefined && state.pendingDataTabNavigation?.nonce !== nonce) {
        return {};
      }
      return { pendingDataTabNavigation: null };
    }),

  clearCloudAutomationTemplateNavigation: (nonce) =>
    set((state) => {
      if (nonce !== undefined && state.pendingCloudAutomationTemplateNavigation?.nonce !== nonce) {
        return {};
      }
      return { pendingCloudAutomationTemplateNavigation: null };
    }),

  clearTableAutomationNavigation: () => set({ pendingTableAutomationNavigation: null }),

  addCloudTablesToWelcomeChat: (attachments) => {
    if (attachments.length === 0) return;
    set((state) => {
      const byId = new Map(state.welcomeCloudTableChatDrafts.map((item) => [item.id, item]));
      attachments.forEach((item) => {
        byId.set(item.id, item);
      });
      return {
        mainView: 'chat',
        activeSessionId: null,
        showSettings: false,
        welcomeCloudTableChatDrafts: Array.from(byId.values()),
      };
    });
  },

  removeCloudTableFromWelcomeChat: (attachmentId) =>
    set((state) => {
      const next = state.welcomeCloudTableChatDrafts.filter((item) => item.id !== attachmentId);
      if (next.length === state.welcomeCloudTableChatDrafts.length) return {};
      return { welcomeCloudTableChatDrafts: next };
    }),

  clearCloudTablesFromWelcomeChat: () =>
    set((state) => {
      if (state.welcomeCloudTableChatDrafts.length === 0) return {};
      return { welcomeCloudTableChatDrafts: [] };
    }),

  addCloudTablesToChat: (sessionId, attachments) => {
    if (attachments.length === 0) return;
    set((state) => {
      const byId = new Map(
        (state.cloudTableChatDraftsBySession[sessionId] ?? []).map((item) => [item.id, item])
      );
      attachments.forEach((item) => {
        byId.set(item.id, item);
      });
      return {
        mainView: 'chat',
        activeSessionId: sessionId,
        showSettings: false,
        cloudTableChatDraftsBySession: {
          ...state.cloudTableChatDraftsBySession,
          [sessionId]: Array.from(byId.values()),
        },
      };
    });
  },

  removeCloudTableFromChat: (sessionId, attachmentId) =>
    set((state) => {
      const current = state.cloudTableChatDraftsBySession[sessionId] ?? [];
      const nextDraft = current.filter((item) => item.id !== attachmentId);
      if (nextDraft.length === current.length) return {};
      const next = { ...state.cloudTableChatDraftsBySession };
      if (nextDraft.length > 0) {
        next[sessionId] = nextDraft;
      } else {
        delete next[sessionId];
      }
      return { cloudTableChatDraftsBySession: next };
    }),

  clearCloudTablesFromChat: (sessionId) =>
    set((state) => {
      if (!state.cloudTableChatDraftsBySession[sessionId]) return {};
      const next = { ...state.cloudTableChatDraftsBySession };
      delete next[sessionId];
      return { cloudTableChatDraftsBySession: next };
    }),

  setPendingSkillMention: (name) => set({ pendingSkillMention: name }),
});

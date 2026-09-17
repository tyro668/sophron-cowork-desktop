import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  startSession: vi.fn(),
  continueSession: vi.fn(),
  updateConfig: vi.fn(),
  setPermissionRules: vi.fn(),
  policy: 'auto_review' as string,
}));

vi.mock('electron', () => ({
  ipcMain: { on: vi.fn() },
  dialog: {},
}));
vi.mock('../src/main/ipc-handle', () => ({
  handleIpc: (channel: string, handler: (...args: unknown[]) => unknown) => {
    mocks.handlers.set(channel, handler);
  },
}));
vi.mock('../src/main/app/context', () => ({
  appContext: {
    sessionManager: {
      startSession: mocks.startSession,
      continueSession: mocks.continueSession,
    },
    mainWindow: null,
  },
}));
vi.mock('../src/main/app/events', () => ({ sendToRenderer: vi.fn() }));
vi.mock('../src/main/app/projects', () => ({
  mapProjectRow: vi.fn(),
  listProjectsForRenderer: vi.fn(),
}));
vi.mock('../src/main/app/theme', () => ({
  DARK_BG: '#000',
  LIGHT_BG: '#fff',
  resolveEffectiveTheme: vi.fn(),
  applyNativeThemePreference: vi.fn(),
}));
vi.mock('../src/main/app/workdir', () => ({
  getWorkingDir: vi.fn(),
  getWorkspacePathUnsupportedReason: () => null,
  setWorkingDir: vi.fn(),
}));
vi.mock('../src/main/config/config-store', () => ({
  configStore: {
    get: (key: string) => (key === 'permissionPolicy' ? mocks.policy : undefined),
    getAll: () => ({ permissionPolicy: mocks.policy }),
    update: (updates: { permissionPolicy?: string }) => {
      mocks.updateConfig(updates);
      if (updates.permissionPolicy) mocks.policy = updates.permissionPolicy;
    },
    hasUsableCredentialsForActiveSet: () => true,
    isConfigured: () => true,
  },
}));
vi.mock('../src/main/config/permission-rules-store', () => ({
  setPermissionRules: mocks.setPermissionRules,
}));
vi.mock('../src/main/utils/logger', () => ({ logWarn: vi.fn(), logError: vi.fn() }));

import { registerSessionIpc } from '../src/main/features/session/ipc';
import { getPermissionRulesForPolicy } from '../src/shared/permission-policies';

describe('session permission policy routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.policy = 'auto_review';
    mocks.startSession.mockResolvedValue({ id: 'session-a' });
    mocks.continueSession.mockResolvedValue(undefined);
    registerSessionIpc();
  });

  const invoke = (event: unknown) => {
    const handler = mocks.handlers.get('client-invoke');
    if (!handler) throw new Error('client-invoke handler was not registered');
    return handler({}, event);
  };

  it('passes separate rule snapshots to each chat turn without changing global rules', async () => {
    await invoke({
      type: 'session.start',
      payload: { title: 'A', prompt: 'first', permissionPolicy: 'default' },
    });
    await invoke({
      type: 'session.continue',
      payload: { sessionId: 'session-b', prompt: 'second', permissionPolicy: 'full_access' },
    });

    expect(mocks.startSession.mock.calls[0][7].permissionRules).toEqual(
      getPermissionRulesForPolicy('default')
    );
    expect(mocks.startSession.mock.calls[0][7].permissionPolicy).toBe('default');
    expect(mocks.continueSession.mock.calls[0][3].permissionRules).toEqual(
      getPermissionRulesForPolicy('full_access')
    );
    expect(mocks.continueSession.mock.calls[0][3].permissionPolicy).toBe('full_access');
    expect(mocks.setPermissionRules).not.toHaveBeenCalled();
  });

  it('uses the saved policy when the caller omits one', async () => {
    mocks.policy = 'default';
    await invoke({ type: 'session.start', payload: { title: 'A', prompt: 'first' } });
    expect(mocks.startSession.mock.calls[0][7].permissionRules).toEqual(
      getPermissionRulesForPolicy('default')
    );
    expect(mocks.startSession.mock.calls[0][7].permissionPolicy).toBe('default');
  });

  it('persists a policy selection and updates only the global fallback', async () => {
    await invoke({ type: 'settings.update', payload: { permissionPolicy: 'full_access' } });
    expect(mocks.updateConfig).toHaveBeenCalledWith({
      theme: undefined,
      permissionPolicy: 'full_access',
    });
    expect(mocks.policy).toBe('full_access');
    expect(mocks.setPermissionRules).toHaveBeenCalledWith(
      getPermissionRulesForPolicy('full_access'),
      'full_access'
    );
  });
});

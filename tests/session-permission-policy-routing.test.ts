import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appContext } from '../src/main/app/context';
import type { AppConfig } from '../src/shared/contracts';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  startSession: vi.fn(),
  continueSession: vi.fn(),
  updateConfig: vi.fn(),
  setDockIcon: vi.fn(),
  setTrayImage: vi.fn(),
  setPermissionRules: vi.fn(),
  config: {
    permissionPolicy: 'auto_review',
    logoVariant: 'fold',
    accentTheme: 'lavender',
  } as Pick<AppConfig, 'permissionPolicy' | 'logoVariant' | 'accentTheme'>,
}));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), dock: { setIcon: mocks.setDockIcon } },
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
    tray: { setImage: mocks.setTrayImage },
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
    get: (key: keyof typeof mocks.config) => mocks.config[key],
    getAll: () => ({ ...mocks.config }),
    update: (updates: Partial<AppConfig>) => {
      mocks.updateConfig(updates);
      if (updates.permissionPolicy) mocks.config.permissionPolicy = updates.permissionPolicy;
      if (updates.logoVariant) mocks.config.logoVariant = updates.logoVariant;
      if (updates.accentTheme) mocks.config.accentTheme = updates.accentTheme;
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

describe('session settings and permission policy routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.config = {
      permissionPolicy: 'auto_review',
      logoVariant: 'fold',
      accentTheme: 'lavender',
    };
    mocks.startSession.mockResolvedValue({ id: 'session-a' });
    mocks.continueSession.mockResolvedValue(undefined);
    registerSessionIpc(appContext);
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
    mocks.config.permissionPolicy = 'default';
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
    expect(mocks.config.permissionPolicy).toBe('full_access');
    expect(mocks.setPermissionRules).toHaveBeenCalledWith(
      getPermissionRulesForPolicy('full_access'),
      'full_access'
    );
  });

  it('refreshes the macOS Dock with the saved shape and accent when either setting changes', async () => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }));
    try {
      const resources = join(process.cwd(), 'resources');
      const change = (payload: Partial<Pick<AppConfig, 'accentTheme' | 'logoVariant'>>) =>
        invoke({ type: 'settings.update', payload });
      await change({ accentTheme: 'rose' });
      expect(mocks.setDockIcon).toHaveBeenLastCalledWith(
        join(resources, 'dock-icons', 'fold-rose.png')
      );
      expect(mocks.setTrayImage).not.toHaveBeenCalled();
      await change({ logoVariant: 'mark' });
      expect(mocks.setDockIcon).toHaveBeenLastCalledWith(
        join(resources, 'dock-icons', 'mark-rose.png')
      );
      await change({ logoVariant: 'fold', accentTheme: 'mint' });
      expect(mocks.setDockIcon).toHaveBeenLastCalledWith(join(resources, 'icon-fold-mac.png'));
      await change({ accentTheme: 'mint' });
      expect(mocks.setDockIcon).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

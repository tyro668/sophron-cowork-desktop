import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { registerAppLifecycle } from '../src/main/app/lifecycle';
import { appContext } from '../src/main/app/context';
import { closeDatabase } from '../src/main/db/database';
import { remoteManager } from '../src/main/remote/remote-manager';
import { SandboxSync } from '../src/main/sandbox/sandbox-sync';
import { LimaSync } from '../src/main/sandbox/lima-sync';

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { app: Object.assign(new EventEmitter(), { quit: vi.fn() }) };
});
vi.mock('../src/main/app/context', () => ({ appContext: {} }));
vi.mock('../src/main/app/window', () => ({ createWindow: vi.fn() }));
vi.mock('../src/main/db/database', () => ({ closeDatabase: vi.fn() }));
vi.mock('../src/main/nav-server', () => ({ stopNavServer: vi.fn() }));
vi.mock('../src/main/agent/ai-runs', () => ({ abortAllAiRuns: () => 0 }));
vi.mock('../src/main/automation/script-packages/background-repairs', () => ({
  backgroundRepairs: { stop: vi.fn() },
}));
vi.mock('../src/main/features/cloud-connection/runtime', () => ({ stopCloudConnection: vi.fn() }));
vi.mock('../src/main/remote/remote-manager', () => ({ remoteManager: { stop: vi.fn() } }));
vi.mock('../src/main/sandbox/lima-sync', () => ({
  LimaSync: { cleanupAllSessions: vi.fn(async () => {}) },
}));
vi.mock('../src/main/sandbox/sandbox-sync', () => ({
  SandboxSync: { cleanupAllSessions: vi.fn(async () => {}) },
}));
vi.mock('../src/main/sandbox/sandbox-adapter', () => ({ shutdownSandbox: vi.fn(async () => {}) }));
vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  closeLogFile: vi.fn(),
}));

const events: EventEmitter = app;

beforeEach(() => {
  vi.stubEnv('VITE_DEV_SERVER_URL', undefined);
  appContext.isInstallingUpdate = false;
  const signals = vi.spyOn(process, 'on').mockReturnValue(process);
  registerAppLifecycle();
  signals.mockRestore();
});

afterEach(() => {
  events.removeAllListeners();
  vi.unstubAllEnvs();
});

describe('app quit cleanup', () => {
  it.each(['before-quit', 'window-all-closed'])(
    'waits for one cleanup when %s requests quit',
    async (entry) => {
      let finishRemoteStop!: () => void;
      const stopping = new Promise<void>((resolve) => {
        finishRemoteStop = resolve;
      });
      vi.mocked(remoteManager.stop).mockReturnValue(stopping);
      const repeatedQuit = { preventDefault: vi.fn() };
      const finalQuit = { preventDefault: vi.fn() };
      vi.mocked(app.quit).mockImplementation(() => {
        events.emit('before-quit', finalQuit);
      });

      if (entry === 'window-all-closed') {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        try {
          Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
          events.emit(entry);
        } finally {
          Object.defineProperty(process, 'platform', platform);
        }
      } else {
        const firstQuit = { preventDefault: vi.fn() };
        events.emit(entry, firstQuit);
        expect(firstQuit.preventDefault).toHaveBeenCalledOnce();
      }

      await Promise.resolve();
      events.emit('before-quit', repeatedQuit);
      expect(repeatedQuit.preventDefault).toHaveBeenCalledOnce();
      expect(remoteManager.stop).toHaveBeenCalledOnce();
      expect(app.quit).not.toHaveBeenCalled();
      finishRemoteStop();
      await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce());
      expect(SandboxSync.cleanupAllSessions).toHaveBeenCalledOnce();
      expect(LimaSync.cleanupAllSessions).toHaveBeenCalledOnce();
      expect(closeDatabase).toHaveBeenCalledOnce();
      expect(finalQuit.preventDefault).not.toHaveBeenCalled();
    }
  );

  it('allows an update installer to quit after its own preparation', () => {
    appContext.isInstallingUpdate = true;
    const quit = { preventDefault: vi.fn() };
    events.emit('before-quit', quit);
    expect(quit.preventDefault).not.toHaveBeenCalled();
    expect(remoteManager.stop).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/shared/contracts';
import { PathResolver } from '../src/main/sandbox/path-resolver';
import { AgentRunner } from '../src/main/agent/agent-runner';

const sandbox = vi.hoisted(() => ({ init: vi.fn(), sync: vi.fn() }));
vi.mock('../src/main/agent/agent-runner-sandbox-sync', () => ({
  initSandboxSyncForRun: sandbox.init,
  syncRunWorkspaceToHost: sandbox.sync,
}));

const session: Session = {
  id: 'session',
  title: 'test',
  status: 'running',
  mountedPaths: [],
  allowedTools: [],
  memoryEnabled: false,
  createdAt: 1,
  updatedAt: 1,
};
function fixture() {
  const paths = new PathResolver();
  const unmount = vi.spyOn(paths, 'unregisterSession');
  const send = vi.fn();
  const runner = new AgentRunner({ sendToRenderer: send }, paths);
  return { runner, send, unmount };
}
beforeEach(() => {
  sandbox.init.mockReset();
  sandbox.sync.mockReset();
});

describe('agent preparation lifecycle', () => {
  it('unregisters the session after failing preparation', async () => {
    sandbox.init.mockRejectedValue(new Error('Storage unavailable'));
    const { runner, send, unmount } = fixture();
    await runner.run(session, 'test', []);
    expect(unmount).toHaveBeenCalledWith(session.id);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trace.update',
        payload: expect.objectContaining({
          updates: expect.objectContaining({ outcome: 'provider_failed' }),
        }),
      })
    );
    expect(sandbox.sync).not.toHaveBeenCalled();
  });
  it('finishes sandbox cleanup when cancelled during initialization', async () => {
    let finish!: (value: unknown) => void;
    sandbox.init.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { runner, send, unmount } = fixture();
    const running = runner.run(session, 'test', []);
    await vi.waitFor(() => expect(sandbox.init).toHaveBeenCalled());
    runner.cancel(session.id);
    finish({ sandboxPath: '/workspace', useSandboxIsolation: true, sandbox: {} });
    await running;
    expect(unmount).toHaveBeenCalledWith(session.id);
    expect(sandbox.sync).toHaveBeenCalledWith(session.id);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trace.update',
        payload: expect.objectContaining({
          updates: expect.objectContaining({ outcome: 'cancelled' }),
        }),
      })
    );
  });
});

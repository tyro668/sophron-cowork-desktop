import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ exec: vi.fn(), spawn: vi.fn() }));
vi.mock('child_process', async (original) => ({
  ...(await original<typeof import('child_process')>()),
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: mocks.exec }),
  spawn: mocks.spawn,
}));
vi.mock('electron', () => ({ app: { isPackaged: false } }));
vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logError: vi.fn() }));
vi.mock('../src/main/sandbox/sandbox-bootstrap', () => ({
  getSandboxBootstrap: () => ({
    getCachedWSLStatus: () => ({
      available: true,
      distro: 'Ubuntu',
      nodeAvailable: true,
      pythonAvailable: true,
      pipAvailable: true,
    }),
  }),
}));
import { WSLBridge, pathConverter } from '../src/main/sandbox/wsl-bridge';
import { SandboxSync } from '../src/main/sandbox/sandbox-sync';

beforeEach(() => {
  mocks.exec.mockReset();
  mocks.spawn.mockReset();
  SandboxSync.clearAllSessions();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  SandboxSync.clearAllSessions();
});

function mockDistroList(names: string[], rows: string, broken: string[] = []) {
  mocks.exec.mockImplementation(async (_command, args: string[]) => {
    if (args.includes('--quiet'))
      return { stdout: Buffer.from('\uFEFF' + names.join('\r\n'), 'utf16le') };
    if (args.includes('--verbose')) return { stdout: Buffer.from(rows, 'utf16le') };
    if (args.includes('echo')) {
      if (broken.includes(args[1])) throw new Error('Cannot boot');
      return { stdout: 'OK\n' };
    }
    if (args.includes('node')) return { stdout: 'v22.0.0\n' };
    if (args.includes('python3'))
      return { stdout: args.includes('pip') ? 'pip 24' : 'Python 3.12' };
    return { stdout: '', stderr: '' };
  });
}

describe('Windows WSL discovery and paths', () => {
  it('skips internal distributions, WSL 1 and a broken preferred distro', async () => {
    mockDistroList(
      ['docker-desktop', 'Ubuntu-Old', 'Ubuntu', 'Debian'],
      '  NAME STATE VERSION\r\n* docker-desktop Running 2\r\n Ubuntu-Old Stopped 1\r\n Ubuntu 已停止 2\r\n Debian 已停止 2',
      ['Ubuntu']
    );
    expect(await WSLBridge.checkWSLStatus()).toMatchObject({
      available: true,
      distro: 'Debian',
      nodeAvailable: true,
    });
    expect(
      mocks.exec.mock.calls.filter(([, args]) => args.includes('echo')).map(([, args]) => args[1])
    ).toEqual(['Ubuntu', 'Debian']);
  });
  it('does not claim WSL 2 is available when only WSL 1 or Docker is installed', async () => {
    mockDistroList(['Ubuntu', 'docker-desktop'], 'Ubuntu Stopped 1\ndocker-desktop Running 2');
    expect(await WSLBridge.checkWSLStatus()).toEqual({ available: false });
  });
  it.each(['C:relative', 'C:', '\\\\server\\share', '//server/share'])(
    'rejects unsupported path %s',
    (input) => {
      expect(() => pathConverter.toWSL(input)).toThrow();
    }
  );
  it('converts local absolute paths without losing Chinese or spaces', () => {
    expect(pathConverter.toWSL('D:\\项目 文件\\input.csv')).toBe('/mnt/d/项目 文件/input.csv');
    expect(pathConverter.toWindows('/mnt/d/项目 文件/input.csv')).toBe('D:\\项目 文件\\input.csv');
    expect(pathConverter.toWSL('C:\\')).toBe('/mnt/c/');
  });
});

describe('WSL agent lifecycle', () => {
  async function fixture(respond: boolean) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-runtime-'));
    const entry = path.join(root, "Program Files (x86) & O'Brien", 'wsl-agent', 'index.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, '');
    const bridge = new WSLBridge();
    vi.spyOn(
      bridge as unknown as { getAgentScriptPath(): string },
      'getAgentScriptPath'
    ).mockReturnValue(entry);
    const children: Array<ReturnType<typeof child>> = [];
    function child() {
      const p = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        stdin: Object.assign(new EventEmitter(), {
          write: vi.fn((line: string, cb?: (error?: Error) => void) => {
            const request = JSON.parse(line);
            cb?.();
            if (respond)
              queueMicrotask(() =>
                p.stdout.emit(
                  'data',
                  Buffer.from(JSON.stringify({ id: request.id, result: {} }) + '\n')
                )
              );
            return true;
          }),
        }),
        kill: vi.fn(),
      });
      return p;
    }
    mocks.spawn.mockImplementation(() => {
      const p = child();
      children.push(p);
      return p;
    });
    return {
      root,
      entry,
      bridge,
      children,
      setRespond: (value: boolean) => {
        respond = value;
      },
    };
  }
  it('passes installation paths as data and can initialize again after shutdown', async () => {
    const f = await fixture(true);
    try {
      await f.bridge.initialize({ workspacePath: 'C:\\project' });
      expect(mocks.spawn.mock.calls[0][1]).toEqual([
        '-d',
        'Ubuntu',
        '--',
        'bash',
        '-c',
        'source ~/.nvm/nvm.sh 2>/dev/null; exec node "$1"',
        'sophron-wsl-agent',
        pathConverter.toWSL(f.entry),
      ]);
      await f.bridge.shutdown();
      await f.bridge.initialize({ workspacePath: 'D:\\other' });
      expect(mocks.spawn).toHaveBeenCalledTimes(2);
      await f.bridge.shutdown();
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });
  it('bounds startup timeout, kills the process, clears requests, and permits retry', async () => {
    vi.useFakeTimers();
    const f = await fixture(false);
    try {
      const result = f.bridge
        .initialize({ workspacePath: 'C:\\project' })
        .catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(30001);
      expect(await result).toMatchObject({ message: 'Request timeout: ping' });
      expect(f.children[0].kill).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      f.setRespond(true);
      await f.bridge.initialize({ workspacePath: 'C:\\project' });
      await f.bridge.shutdown();
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });
});

describe('WSL sync recovery', () => {
  function enableSync() {
    mocks.exec.mockImplementation(async (_command, args: string[]) => {
      const script = args[args.length - 1];
      return { stdout: script.includes('cd ~') ? '/home/test\n' : '1\n', stderr: '' };
    });
  }
  it('returns a failure when WSL home discovery fails', async () => {
    mocks.exec.mockRejectedValue(new Error('WSL unavailable'));
    expect(await SandboxSync.initSync('C:\\project', 'session1', 'Ubuntu')).toMatchObject({
      success: false,
      error: 'WSL unavailable',
    });
  });
  it.each(['single', 'all'])(
    'preserves outputs and mapping when %s cleanup cannot copy back',
    async (mode) => {
      enableSync();
      expect((await SandboxSync.initSync('C:\\project', 'session1', 'Ubuntu')).success).toBe(true);
      mocks.exec.mockClear();
      mocks.exec.mockRejectedValue(new Error('Disk full'));
      if (mode === 'single')
        expect((await SandboxSync.syncAndCleanup('session1')).success).toBe(false);
      else await SandboxSync.cleanupAllSessions();
      expect(SandboxSync.hasSession('session1')).toBe(true);
      expect(mocks.exec.mock.calls.some(([, args]) => args.at(-1).includes('rm -rf'))).toBe(false);
    }
  );
  it('rejects reuse across workspaces or distributions', async () => {
    enableSync();
    await SandboxSync.initSync('C:\\project', 'session1', 'Ubuntu');
    expect((await SandboxSync.initSync('D:\\other', 'session1', 'Ubuntu')).success).toBe(false);
    expect((await SandboxSync.initSync('C:\\project', 'session1', 'Debian')).success).toBe(false);
    expect(SandboxSync.getSession('session1')?.windowsPath).toBe('C:\\project');
  });
  it('still cleans up after successful copy-back', async () => {
    enableSync();
    await SandboxSync.initSync('C:\\project', 'session1', 'Ubuntu');
    mocks.exec.mockImplementation(async (_command, args: string[]) => ({
      stdout: args.at(-1)?.includes('realpath') ? '/home/test/.sophron/sandbox/session1\n' : '',
      stderr: '',
    }));
    expect((await SandboxSync.syncAndCleanup('session1')).success).toBe(true);
    expect(SandboxSync.hasSession('session1')).toBe(false);
  });
});

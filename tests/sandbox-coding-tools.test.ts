import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('child_process', async (original) => ({
  ...(await original<typeof import('child_process')>()),
  spawn: mocks.spawn,
}));
import {
  createSandboxCodingTools,
  resolveSandboxToolInput,
} from '../src/main/agent/sandbox-tool-operations';

const mode = { type: 'wsl', distro: 'Ubuntu' } as const;
afterEach(() => {
  vi.unstubAllEnvs();
  mocks.spawn.mockReset();
});

describe('cross-platform sandbox file paths', () => {
  it.each(['notes/输出.txt', 'notes\\输出.txt'])(
    'resolves %s before Windows SDK path resolution',
    (input) => {
      const resolved = resolveSandboxToolInput(input, '/home/user/.sophron/sandbox/session');
      expect(resolved).toBe('/home/user/.sophron/sandbox/session/notes/输出.txt');
      expect(path.win32.isAbsolute(resolved)).toBe(true);
    }
  );
  it('maps virtual workspace and normalizes parent segments', () => {
    expect(resolveSandboxToolInput('@/workspace/notes/../out.txt', '/home/test/session')).toBe(
      '/home/test/session/out.txt'
    );
  });
  it.each(['C:\\Users\\host\\file', '~/.ssh/id_rsa', '//server/share/file'])(
    'does not expand host-specific path %s',
    (input) => {
      expect(() => resolveSandboxToolInput(input, '/home/test/session')).toThrow();
    }
  );
});

// This runs the actual SDK Bash tool and generated guest script against a local
// POSIX shell. It verifies the protocol/script, not a Windows or WSL installation.
describe.skipIf(process.platform === 'win32')('sandbox SDK shell integration', () => {
  it('keeps guest runtime paths and handles virtual paths in different quote contexts', async () => {
    const { spawn: realSpawn } =
      await vi.importActual<typeof import('child_process')>('child_process');
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-sdk-')));
    const cwd = path.join(root, "项目 O'Brien $data !");
    fs.mkdirSync(cwd);
    vi.stubEnv('PATH', 'C:\\Windows\\System32;C:\\Program Files\\node');
    vi.stubEnv('HOME', 'C:\\Users\\Host');
    vi.stubEnv('PYTHONHOME', 'C:\\Python');
    vi.stubEnv('SOPHRON_TEST_VALUE', 'value with spaces');
    const scripts: string[] = [];
    mocks.spawn.mockImplementation((_command, args: string[], options) => {
      const script = args.at(-1)!;
      scripts.push(script);
      return realSpawn('/bin/bash', ['-c', script], {
        ...options,
        env: { PATH: '/usr/bin:/bin', HOME: root },
      });
    });
    try {
      const bash = createSandboxCodingTools(cwd, mode).find((tool) => tool.name === 'bash')!;
      const result = await bash.execute('call', {
        command: `printf '%s\\n' /workspace "/workspace" '/workspace' "/workspace/a b" "$SOPHRON_TEST_VALUE"; command -v sh; printf '%s' "$HOME"`,
      } as never);
      const output = result.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('');
      expect(output).toContain([cwd, cwd, cwd, cwd + '/a b', 'value with spaces'].join('\n'));
      expect(output).toMatch(/\n\/(?:usr\/)?bin\/sh\n/);
      expect(output).toContain(root);
      expect(scripts[0]).not.toMatch(/export (?:PATH|HOME|PYTHONHOME)=/);
      expect(mocks.spawn.mock.calls[0][0]).toBe('wsl');
      expect(mocks.spawn.mock.calls[0][1].slice(0, 5)).toEqual([
        '-d',
        'Ubuntu',
        '-e',
        '/bin/bash',
        '-lc',
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('sandbox shell failure handling', () => {
  it('settles a timeout even if the WSL launcher never closes', async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
      kill: vi.fn(),
    });
    mocks.spawn.mockReturnValue(child);
    try {
      const bash = createSandboxCodingTools('/home/test/session', mode).find(
        (tool) => tool.name === 'bash'
      )!;
      const result = bash
        .execute('call', { command: 'sleep 100', timeout: 1 } as never)
        .catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await result).toBeInstanceOf(Error);
      expect(child.kill).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(() => child.emit('error', new Error('late launcher failure'))).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe.skipIf(process.platform === 'win32')('sandbox SDK file round trip', () => {
  it('writes, reads and edits Chinese filenames through the guest operations', async () => {
    const { spawn: realSpawn } =
      await vi.importActual<typeof import('child_process')>('child_process');
    const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-files-')));
    mocks.spawn.mockImplementation((_command, args: string[], options) => {
      // macOS base64 lacks GNU's -w option; only adapt that host utility in this
      // fixture. WSL invocation and SDK operations still use the production code.
      const script = args.at(-1)!.replace('base64 -w 0 ', 'base64 < ');
      return realSpawn('/bin/bash', ['-c', script], { ...options, env: { PATH: '/usr/bin:/bin' } });
    });
    try {
      const tools = createSandboxCodingTools(cwd, mode);
      const file = "notes/项目 O'Brien.txt";
      await tools
        .find((tool) => tool.name === 'write')!
        .execute('write', { path: file, content: 'before\n' } as never);
      expect(fs.readFileSync(path.join(cwd, file), 'utf8')).toBe('before\n');
      const read = await tools
        .find((tool) => tool.name === 'read')!
        .execute('read', { path: '/workspace/' + file } as never);
      expect(read.content).toContainEqual(
        expect.objectContaining({ type: 'text', text: 'before\n' })
      );
      await tools
        .find((tool) => tool.name === 'edit')!
        .execute('edit', { path: file, edits: [{ oldText: 'before', newText: 'after' }] } as never);
      expect(fs.readFileSync(path.join(cwd, file), 'utf8')).toBe('after\n');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

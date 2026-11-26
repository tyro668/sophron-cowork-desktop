import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { build } from 'esbuild';
import path from 'node:path';

const nativeExecutorPath = path.resolve(process.cwd(), 'src/main/sandbox/native-executor.ts');
const wslAgentPath = path.resolve(process.cwd(), 'src/main/sandbox/wsl-agent/index.ts');
const limaAgentPath = path.resolve(process.cwd(), 'src/main/sandbox/lima-agent/index.ts');

describe('Sandbox executor containment wiring', () => {
  it('uses containment helpers instead of raw workspace prefix matching', () => {
    const nativeSource = fs.readFileSync(nativeExecutorPath, 'utf8');
    const wslSource = fs.readFileSync(wslAgentPath, 'utf8');
    const limaSource = fs.readFileSync(limaAgentPath, 'utf8');

    expect(nativeSource).toContain("import { isPathWithinRoot } from '../tools/path-containment';");
    expect(nativeSource).toContain('isPathWithinRoot(targetCheck, workspaceCheck, isWindows)');
    expect(nativeSource).toContain('isPathWithinRoot(realCheck, realWorkspaceCheck, isWindows)');

    expect(wslSource).toContain("startSandboxAgent('WSL')");
    expect(limaSource).toContain("startSandboxAgent('Lima')");
    const guest = fs.readFileSync(path.resolve('src/main/sandbox/guest-agent.ts'), 'utf8');
    expect(guest).toContain("import { isPathWithinRoot } from '../tools/path-containment';");
    expect(guest).toContain('isPathWithinRoot(resolved, this.workspacePath)');
  });
});

it.each([wslAgentPath, limaAgentPath])(
  'loads %s and limits file reads to its configured workspace',
  async (entry) => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guest-agent-')));
    try {
      const workspace = path.join(root, 'workspace');
      fs.mkdirSync(workspace);
      fs.writeFileSync(path.join(workspace, 'example.txt'), 'inside');
      const bundle = path.join(root, 'agent.cjs');
      await build({
        entryPoints: [entry],
        outfile: bundle,
        platform: 'node',
        bundle: true,
        format: 'cjs',
      });
      const child = spawn(process.execPath, [bundle], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const exited = once(child, 'exit');
      const responses = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
      let id = 0;
      const invoke = async (method: string, params: Record<string, unknown> = {}) => {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n');
        const line = await responses.next();
        if (line.done) throw new Error('Guest exited before replying');
        const reply = JSON.parse(line.value);
        expect(reply.id).toBe(id);
        return reply;
      };
      try {
        expect((await invoke('ping')).result).toEqual({ pong: true });
        await invoke('setWorkspace', {
          path: workspace,
          windowsPath: workspace,
          macPath: workspace,
        });
        expect(
          (await invoke('readFile', { path: path.join(workspace, 'example.txt') })).result
        ).toEqual({ content: 'inside' });
        expect((await invoke('readFile', { path: bundle })).error.message).toContain(
          'outside workspace'
        );
      } finally {
        child.stdin.end();
        await exited;
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);

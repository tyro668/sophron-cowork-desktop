import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NativeExecutor } from '../src/main/sandbox/native-executor';

vi.mock('../src/main/utils/logger', () => ({ log: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function setup() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-runtime-')));
  roots.push(root);
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(workspace);
  fs.mkdirSync(outside);
  const executor = new NativeExecutor();
  await executor.initialize({ workspacePath: workspace, timeout: 1000 });
  return { root, workspace, outside, executor };
}

describe.skipIf(process.platform === 'win32')('NativeExecutor runtime', () => {
  it('executes commands and round-trips workspace files', async () => {
    const { executor, workspace } = await setup();
    const source = path.join(workspace, 'nested', 'input.txt');
    const copy = path.join(workspace, 'copy.txt');
    await executor.writeFile(source, 'sandbox smoke');
    expect(await executor.readFile(source)).toBe('sandbox smoke');
    await executor.copyFile(source, copy);
    expect(await executor.listDirectory(workspace)).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'copy.txt' })])
    );
    const result = await executor.executeCommand('printf "%s" "$SANDBOX_TEST_VALUE"', workspace, {
      SANDBOX_TEST_VALUE: 'command works',
    });
    expect(result).toMatchObject({ success: true, stdout: 'command works', exitCode: 0 });
    await executor.deleteFile(copy);
    expect(await executor.fileExists(copy)).toBe(false);
    await executor.shutdown();
  });

  it.each(['write', 'copy', 'mkdir'])(
    'rejects %s through a symlink into a sibling directory',
    async (operation) => {
      const { executor, workspace, outside } = await setup();
      fs.symlinkSync(outside, path.join(workspace, 'escape'));
      const target = path.join(workspace, 'escape', 'new', 'file.txt');
      const source = path.join(workspace, 'source.txt');
      fs.writeFileSync(source, 'test');
      const action =
        operation === 'write'
          ? executor.writeFile(target, 'test')
          : operation === 'copy'
            ? executor.copyFile(source, target)
            : executor.createDirectory(target);
      await expect(action).rejects.toThrow(/outside workspace|Symlink escape/);
      expect(fs.readdirSync(outside)).toEqual([]);
    }
  );

  it('supports a workspace reached through a symlink without allowing escapes', async () => {
    const { executor, workspace, root } = await setup();
    const alias = path.join(root, 'alias');
    fs.symlinkSync(workspace, alias);
    await executor.initialize({ workspacePath: alias });
    const file = path.join(alias, 'file.txt');
    await executor.writeFile(file, 'content');
    expect(await executor.readFile(file)).toBe('content');
  });
});

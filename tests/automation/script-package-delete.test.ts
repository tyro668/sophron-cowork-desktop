import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScriptPackageService } from '../../src/main/automation/script-packages/service';
import { MemoryScriptVersionStore } from '../../src/main/automation/script-packages/version-store';

let root: string;
let versions: MemoryScriptVersionStore;
const secrets = { env: () => ({}), deleteScope: vi.fn() };

function service() {
  return new ScriptPackageService({
    rootDir: root,
    versions,
    secrets,
    node: { command: process.execPath },
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'script-delete-'));
  versions = new MemoryScriptVersionStore();
  secrets.deleteScope.mockClear();
  mkdirSync(path.join(root, 'fx'));
  writeFileSync(
    path.join(root, 'fx', 'manifest.json'),
    JSON.stringify({ name: '汇率', entry: 'main.js', runtime: 'node' })
  );
  writeFileSync(path.join(root, 'fx', 'main.js'), 'console.log(1)');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('deleting a script package', () => {
  it('removes its versions, folder (git repo included) and secrets', async () => {
    const scripts = service();
    await scripts.list();
    expect(versions.list('fx').length).toBeGreaterThan(0);
    expect(existsSync(path.join(root, 'fx', '.git'))).toBe(true);
    await scripts.deletePackage('fx');
    expect(existsSync(path.join(root, 'fx'))).toBe(false);
    expect(versions.list('fx')).toEqual([]);
    expect(secrets.deleteScope).toHaveBeenCalledWith('script:fx');
    expect(await scripts.list()).toEqual([]);
  });

  it('lists a package whose folder was deleted outside the app as missing, and deletes it', async () => {
    const scripts = service();
    await scripts.list();
    rmSync(path.join(root, 'fx'), { recursive: true, force: true });
    const listed = await scripts.list();
    expect(listed).toEqual([expect.objectContaining({ id: 'fx', missing: true })]);
    await scripts.deletePackage('fx');
    expect(await scripts.list()).toEqual([]);
    // The id is free again.
    expect(await scripts.newPackageId('fx')).toBe('fx');
  });
});

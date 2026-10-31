import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureExecSandbox, resetSandboxDetection } from '../../src/main/exec-guard/sandbox';
import { ScriptPackageService } from '../../src/main/automation/script-packages/service';
import { VersionRepo as PackageRepo } from '../../src/main/versioning/git-repo';

const hasPython = (() => {
  try {
    execFileSync('python3', ['-c', 'import venv'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let root: string;
let service: ScriptPackageService;

function writePackage(dir: string, files: Record<string, string>) {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
}

const NODE_MAIN = `
const fs = require('fs');
const { rows } = require('./lib/data');
const cfg = process.env.SOPHRON_CONFIG ? JSON.parse(fs.readFileSync(process.env.SOPHRON_CONFIG, 'utf8')) : {};
if (cfg.fail) { console.error('选择器失效'); process.exit(2); }
if (cfg.sleep) { setTimeout(() => {}, 60000); return; }
fs.writeFileSync(process.env.SOPHRON_OUTPUT, 'name,value\\n' + rows(cfg.n || 3).join('\\n') + '\\n');
`;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'script-pkg-'));
  // Node packages run on the test's own node binary (Electron uses ELECTRON_RUN_AS_NODE).
  service = new ScriptPackageService({ rootDir: root, node: { command: process.execPath } });
  writePackage(path.join(root, 'demo'), {
    'manifest.json': JSON.stringify({
      name: '示例抓取',
      entry: 'main.js',
      runtime: 'node',
      output: { format: 'csv', columns: ['name', 'value'] },
    }),
    'main.js': NODE_MAIN,
    'lib/data.js': 'exports.rows = (n) => Array.from({ length: n }, (_, i) => `r${i},${i}`);',
    'config.json': '{"n": 3}',
  });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('ScriptPackageService', () => {
  it('passes an on_empty fallback with a warning and rejects outputs with typed-column mismatches', async () => {
    writePackage(path.join(root, 'demo'), {
      'manifest.json': JSON.stringify({
        name: '示例抓取',
        entry: 'main.js',
        runtime: 'node',
        output: { format: 'csv', columns: ['name', { name: 'value', type: 'number' }] },
      }),
      'main.js': `console.log('SOPHRON_NOTICE: 今日榜单为空，已改用本周榜单');
require('fs').writeFileSync(process.env.SOPHRON_OUTPUT, 'name,value\\na,1\\nb,2\\n');`,
    });
    const passed = await service.testRun('demo', { timeoutMs: 10_000, target: 'working' });
    expect(passed).toMatchObject({ ok: true, warnings: ['今日榜单为空，已改用本周榜单'] });
    writePackage(path.join(root, 'demo'), {
      'main.js': `require('fs').writeFileSync(process.env.SOPHRON_OUTPUT, 'name,value\\na,免费\\nb,暂无\\n');`,
    });
    const failed = await service.testRun('demo', { timeoutMs: 10_000, target: 'working' });
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('「value」应为数字');
  });

  it('injects package secrets as env vars, hides app keys and redacts secret values in logs', async () => {
    const secretService = new ScriptPackageService({
      rootDir: root,
      node: { command: process.execPath },
      secrets: {
        env: (scope): Record<string, string> =>
          scope === 'script:demo' ? { API_KEY: 'rvwFq83mZpLk20Xy7Tc3210' } : {},
      },
    });
    process.env.OPENAI_API_KEY = 'app-model-key-should-not-leak';
    try {
      writePackage(path.join(root, 'demo'), {
        'main.js': `const fs = require('fs');
console.error('using ' + process.env.API_KEY);
fs.writeFileSync(process.env.SOPHRON_OUTPUT, 'name,value\\nkey,' + (process.env.API_KEY ? 'set' : 'missing') + '\\napp,' + (process.env.OPENAI_API_KEY ? 'leaked' : 'hidden') + '\\n');`,
      });
      const test = await secretService.testRun('demo', { timeoutMs: 10_000, target: 'working' });
      expect(test.ok).toBe(true);
      expect(JSON.stringify(test)).toContain('set');
      expect(JSON.stringify(test)).toContain('hidden');
      expect(JSON.stringify(test)).not.toContain('rvwFq83mZpLk20Xy7Tc3210');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('refuses to run code that addresses local services and blocks key literals in drafts', async () => {
    writePackage(path.join(root, 'demo'), {
      'config.json': '{"n": 3, "url": "http://127.0.0.1:19888/status"}',
    });
    const test = await service.testRun('demo', { timeoutMs: 10_000, target: 'working' });
    expect(test.ok).toBe(false);
    expect(test.error).toContain('本机');
    writePackage(path.join(root, 'demo'), {
      'config.json': '{"n": 3, "api_key": "rvwFq83mZpLk20Xy7Tc3210"}',
    });
    await expect(service.saveDraft('demo', { source: 'manual' })).rejects.toThrow(/密钥明文/);
  });

  it('discovers folders with a manifest and flags invalid ones', async () => {
    writePackage(path.join(root, 'broken'), { 'manifest.json': '{"name":"x"}' });
    mkdirSync(path.join(root, 'no-manifest'));
    const list = await service.list();
    expect(list.map((item) => item.id).sort()).toEqual(['broken', 'demo']);
    expect(list.find((item) => item.id === 'demo')).toMatchObject({
      name: '示例抓取',
      entry: 'main.js',
      runtime: 'node',
      depsReady: true,
    });
    expect(list.find((item) => item.id === 'broken')?.invalid).toContain('entry');
  });

  it('runs the published version and keeps the last good output on failure', async () => {
    const ok = await service.run('demo', { timeoutMs: 20_000 });
    expect(ok.rows).toBe(3);
    expect(ok.version).toBe(1);
    expect(readFileSync(ok.csvPath, 'utf8')).toContain('r2,2');
    expect((await service.summary('demo')).lastSuccess?.rows).toBe(3);

    // A folder edit becomes a 手动修改 draft; the automation keeps running v1.
    writeFileSync(path.join(root, 'demo', 'config.json'), '{"fail": true}');
    const summary = await service.summary('demo');
    expect(summary.published?.version).toBe(1);
    expect(summary.draft).toMatchObject({ version: 2, source: 'manual', status: 'draft' });
    expect((await service.run('demo', { timeoutMs: 20_000 })).rows).toBe(3);

    await service.publish('demo', 2);
    await expect(service.run('demo', { timeoutMs: 20_000 })).rejects.toThrow('选择器失效');
    expect(readFileSync(ok.csvPath, 'utf8')).toContain('r2,2');
    const failed = await service.summary('demo');
    expect(failed.lastError?.message).toBe('选择器失效');
    expect(failed.lastSuccess?.rows).toBe(3);
  });

  it('kills the script on timeout', async () => {
    writeFileSync(path.join(root, 'demo', 'config.json'), '{"sleep": true}');
    const started = Date.now();
    const test = await service.testRun('demo', { timeoutMs: 1_000, target: 'working' });
    expect(test.error).toBe('运行超时（1 秒）');
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('rejects output missing manifest columns and missing output files', async () => {
    writeFileSync(
      path.join(root, 'demo', 'main.js'),
      "require('fs').writeFileSync(process.env.SOPHRON_OUTPUT, 'name\\nx\\n')"
    );
    expect((await service.testRun('demo', { timeoutMs: 20_000, target: 'working' })).error).toBe(
      '结果缺少列：value'
    );
    writeFileSync(path.join(root, 'demo', 'main.js'), '');
    expect(
      (await service.testRun('demo', { timeoutMs: 20_000, target: 'working' })).error
    ).toContain('没有写出结果文件');
  });

  it('test runs do not replace the stable output and return preview rows', async () => {
    const result = await service.testRun('demo', { timeoutMs: 20_000 });
    expect(result).toMatchObject({ ok: true, rows: 3, columns: ['name', 'value'], version: 1 });
    expect(result.previewRows?.[2]).toEqual({ name: 'r2', value: '2' });
    expect(existsSync(path.join(root, 'demo', '.sophron', 'output.csv'))).toBe(false);
  });

  it('keeps versions in git: drafts, publish tags, archive, rollback and delete', async () => {
    await service.list();
    writeFileSync(path.join(root, 'demo', 'config.json'), '{"n": 5}');
    const v2 = await service.saveDraft('demo', { source: 'rule', rulePrompt: '抓 5 行' });
    expect(v2.version).toMatchObject({
      version: 2,
      status: 'draft',
      source: 'rule',
      baseVersion: 1,
    });
    // Trial-run the draft without publishing it.
    expect((await service.testRun('demo', { timeoutMs: 20_000, target: 2 })).rows).toBe(5);
    expect((await service.run('demo', { timeoutMs: 20_000 })).rows).toBe(3);

    const versions = await service.listVersions('demo');
    expect(versions.map((item) => [item.version, item.status])).toEqual([
      [2, 'draft'],
      [1, 'published'],
    ]);
    expect(versions[0].diff).toEqual({ added: [], modified: ['config.json'], removed: [] });
    const detail = await service.versionDetail('demo', 2);
    expect(detail.files.find((file) => file.path === 'config.json')?.content).toBe('{"n": 5}');

    await service.publish('demo', 2);
    expect((await service.run('demo', { timeoutMs: 20_000 })).rows).toBe(5);
    expect((await service.listVersions('demo')).map((item) => [item.version, item.status])).toEqual(
      [
        [2, 'published'],
        [1, 'archived'],
      ]
    );
    const repo = new PackageRepo(path.join(root, 'demo'));
    expect((await repo.listTags()).sort()).toEqual(['published', 'v1', 'v2']);

    // Rollback = publish the earlier tag; the run checks v1 out again.
    await service.publish('demo', 1);
    expect(await repo.resolveTag('published')).toBe(await repo.resolveTag('v1'));
    expect((await service.run('demo', { timeoutMs: 20_000 })).rows).toBe(3);
    await expect(service.deleteVersion('demo', 1)).rejects.toThrow('已发布的版本不能删除');
    await service.deleteVersion('demo', 2);
    expect((await service.listVersions('demo')).map((item) => item.version)).toEqual([1]);

    // A folder edit shows up in the history itself as a 手动修改 draft.
    writeFileSync(path.join(root, 'demo', 'config.json'), '{"n": 8}');
    const afterEdit = await service.listVersions('demo');
    expect(afterEdit.map((item) => [item.version, item.status, item.source])).toEqual([
      [2, 'draft', 'manual'],
      [1, 'published', expect.any(String)],
    ]);
  });

  it('AI repair works in the package folder and overwrites one draft on repeated failures', async () => {
    await service.list(); // v1 published from the pre-versioning folder
    writeFileSync(path.join(root, 'demo', 'config.json'), '{"n": 4}');
    await service.summary('demo'); // v2 manual draft
    const dir = await service.beginRepair('demo');
    // The published version is checked out for the repair.
    expect(readFileSync(path.join(dir, 'config.json'), 'utf8')).toBe('{"n": 3}');
    writeFileSync(path.join(dir, 'config.json'), '{"n": 6}');
    // Folder edits during a repair are not picked up as manual drafts.
    expect((await service.summary('demo')).draft?.source).toBe('manual');
    expect((await service.testRun('demo', { timeoutMs: 20_000, target: 'working' })).rows).toBe(6);
    const first = await service.finishRepair('demo', { ok: true, reason: 'boom', rows: 6 });
    expect(first?.version).toMatchObject({ version: 3, source: 'ai_repair', rulePrompt: 'boom' });

    await service.beginRepair('demo');
    writeFileSync(path.join(dir, 'config.json'), '{"n": 7}');
    const second = await service.finishRepair('demo', { ok: true, reason: 'again', rows: 7 });
    expect(second?.version.version).toBe(3);
    expect(second?.replaced).toBe(true);
    expect((await service.testRun('demo', { timeoutMs: 20_000, target: 3 })).rows).toBe(7);
    expect((await service.listVersions('demo')).map((item) => item.version)).toEqual([3, 2, 1]);

    // The same fix again: still that draft, with this attempt's details.
    const commitBefore = (await service.listVersions('demo'))[0].commit;
    await service.beginRepair('demo');
    writeFileSync(path.join(dir, 'config.json'), '{"n": 7}');
    const third = await service.finishRepair('demo', { ok: true, reason: 'third', rows: 7 });
    expect(third?.replaced).toBe(true);
    expect(third?.version).toMatchObject({ version: 3, rulePrompt: 'third', commit: commitBefore });

    // A failed repair is reverted, nothing is saved.
    await service.beginRepair('demo');
    writeFileSync(path.join(dir, 'config.json'), 'broken');
    expect(await service.finishRepair('demo', { ok: false, reason: 'x' })).toBeNull();
    expect(readFileSync(path.join(dir, 'config.json'), 'utf8')).toBe('{"n": 7}');
    expect((await service.summary('demo')).versionCount).toBe(3);
  });

  it('imports an AI-written folder as a draft; re-saving overwrites that draft', async () => {
    const source = mkdtempSync(path.join(os.tmpdir(), 'ai-pkg-'));
    try {
      writePackage(source, {
        'manifest.json': JSON.stringify({ name: 'AI 包', entry: 'run.js', runtime: 'node' }),
        'run.js': "require('fs').writeFileSync(process.env.SOPHRON_OUTPUT, 'a\\n1\\n')",
        'node_modules/x/index.js': '',
      });
      const saved = await service.importFromDir(source, 'ai-pkg');
      expect(saved.summary).toMatchObject({ id: 'ai-pkg', name: 'AI 包' });
      expect(saved.version).toMatchObject({ version: 1, status: 'draft', source: 'chat' });
      expect(existsSync(path.join(root, 'ai-pkg', 'node_modules'))).toBe(false);
      await expect(service.run('ai-pkg', { timeoutMs: 20_000 })).rejects.toThrow('还没有发布版本');
      expect((await service.testRun('ai-pkg', { timeoutMs: 20_000, target: 'working' })).rows).toBe(
        1
      );
      writeFileSync(
        path.join(source, 'run.js'),
        "require('fs').writeFileSync(process.env.SOPHRON_OUTPUT, 'a\\n1\\n2\\n')"
      );
      const again = await service.importFromDir(source, 'ai-pkg');
      expect(again.version.version).toBe(1);
      const unchanged = await service.importFromDir(source, 'ai-pkg');
      expect(unchanged.created).toBe(false);
      await service.publish('ai-pkg', 1);
      expect((await service.run('ai-pkg', { timeoutMs: 20_000 })).rows).toBe(2);
      await expect(service.importFromDir(source, '../escape')).rejects.toThrow('名称无效');
    } finally {
      rmSync(source, { recursive: true, force: true });
    }
  });

  it('runs a Node package with an npm dependency installed into the run checkout', async () => {
    const npmAvailable = (() => {
      try {
        execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], {
          stdio: 'ignore',
        });
        return true;
      } catch {
        return false;
      }
    })();
    if (!npmAvailable) return;
    // A local "file:" dependency exercises the real npm install path without the network. It
    // is symlinked from outside the package, which the sandbox hides, so run unsandboxed here.
    resetSandboxDetection('none');
    configureExecSandbox({ unsandboxedAllowed: true });
    const dep = mkdtempSync(path.join(os.tmpdir(), 'npm-dep-'));
    try {
      writePackage(dep, {
        'package.json': JSON.stringify({ name: 'tiny-dep', version: '1.0.0', main: 'index.js' }),
        'index.js': 'exports.twice = (n) => n * 2;',
      });
      writePackage(path.join(root, 'npmpkg'), {
        'manifest.json': JSON.stringify({ name: 'npm 包', entry: 'main.js', runtime: 'node' }),
        'package.json': JSON.stringify({
          name: 'npmpkg',
          version: '1.0.0',
          private: true,
          dependencies: { 'tiny-dep': `file:${dep}` },
        }),
        'main.js':
          "const { twice } = require('tiny-dep'); require('fs').writeFileSync(process.env.SOPHRON_OUTPUT, 'v\\n' + twice(21) + '\\n');",
      });
      const first = await service.run('npmpkg', { timeoutMs: 60_000 });
      expect(first.installedDeps).toBe(true);
      expect(readFileSync(first.csvPath, 'utf8')).toContain('42');
      expect(
        existsSync(path.join(root, 'npmpkg', '.sophron', 'run', 'published', 'node_modules'))
      ).toBe(true);
      // node_modules never enters git and the folder stays clean.
      expect(existsSync(path.join(root, 'npmpkg', 'node_modules'))).toBe(false);
      expect((await service.summary('npmpkg')).versionCount).toBe(1);
      expect((await service.run('npmpkg', { timeoutMs: 60_000 })).installedDeps).toBe(false);
    } finally {
      resetSandboxDetection();
      configureExecSandbox({ unsandboxedAllowed: false });
      rmSync(dep, { recursive: true, force: true });
    }
  }, 120_000);

  it.skipIf(!hasPython)(
    'creates a per-package venv and reinstalls when requirements change',
    async () => {
      writePackage(path.join(root, 'py'), {
        'manifest.json': JSON.stringify({ name: 'Py', entry: 'main.py', runtime: 'python' }),
        'main.py':
          "import os, sys\nopen(os.environ['SOPHRON_OUTPUT'],'w').write('exe\\n'+sys.executable+'\\n')\n",
        'requirements.txt': '# no deps\n',
      });
      const first = await service.run('py', { timeoutMs: 60_000 });
      expect(first.installedDeps).toBe(true);
      expect(readFileSync(first.csvPath, 'utf8')).toContain(
        path.join('py', '.sophron', 'run', 'published', '.venv')
      );
      expect((await service.summary('py')).runtimeVersion).toMatch(/^Python \d+\.\d+$/);
      expect((await service.run('py', { timeoutMs: 60_000 })).installedDeps).toBe(false);
      writeFileSync(path.join(root, 'py', 'requirements.txt'), '# changed\n');
      await service.publish('py', (await service.summary('py')).draft!.version);
      expect((await service.summary('py')).depsReady).toBe(false);
      expect((await service.run('py', { timeoutMs: 60_000 })).installedDeps).toBe(true);
    },
    120_000
  );
});

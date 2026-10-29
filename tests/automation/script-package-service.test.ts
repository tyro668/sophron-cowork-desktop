import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScriptPackageService } from '../../src/main/automation/script-packages/service';

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

  it('runs the entry with helper modules and config, and keeps the last good output on failure', async () => {
    const ok = await service.run('demo', { timeoutMs: 20_000 });
    expect(ok.rows).toBe(3);
    expect(readFileSync(ok.csvPath, 'utf8')).toContain('r2,2');
    expect((await service.summary('demo')).lastSuccess?.rows).toBe(3);

    writeFileSync(path.join(root, 'demo', 'config.json'), '{"fail": true}');
    await expect(service.run('demo', { timeoutMs: 20_000 })).rejects.toThrow('选择器失效');
    expect(readFileSync(ok.csvPath, 'utf8')).toContain('r2,2');
    const summary = await service.summary('demo');
    expect(summary.lastError?.message).toBe('选择器失效');
    expect(summary.lastSuccess?.rows).toBe(3);
  });

  it('kills the script on timeout', async () => {
    writeFileSync(path.join(root, 'demo', 'config.json'), '{"sleep": true}');
    const started = Date.now();
    await expect(service.run('demo', { timeoutMs: 1_000 })).rejects.toThrow('运行超时（1 秒）');
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('rejects output missing manifest columns and missing output files', async () => {
    writeFileSync(
      path.join(root, 'demo', 'main.js'),
      "require('fs').writeFileSync(process.env.SOPHRON_OUTPUT, 'name\\nx\\n')"
    );
    await expect(service.run('demo', { timeoutMs: 20_000 })).rejects.toThrow('结果缺少列：value');
    writeFileSync(path.join(root, 'demo', 'main.js'), '');
    await expect(service.run('demo', { timeoutMs: 20_000 })).rejects.toThrow('没有写出结果文件');
  });

  it('test runs do not replace the stable output', async () => {
    const result = await service.testRun('demo', { timeoutMs: 20_000 });
    expect(result).toMatchObject({ ok: true, rows: 3, columns: ['name', 'value'] });
    expect(existsSync(path.join(root, 'demo', '.sophron', 'output.csv'))).toBe(false);
  });

  it('keeps an AI version pending until confirmed', async () => {
    const pending = await service.preparePending('demo', 'boom');
    expect(readFileSync(path.join(pending, 'LAST_ERROR.txt'), 'utf8')).toContain('boom');
    writeFileSync(path.join(pending, 'config.json'), '{"n": 5}');
    const test = await service.testRun('demo', { timeoutMs: 20_000, pending: true });
    expect(test.rows).toBe(5);
    await service.markPending('demo', { createdAt: 1, rows: 5, reason: 'boom' });
    expect((await service.summary('demo')).pending?.rows).toBe(5);
    // Active version untouched.
    expect((await service.run('demo', { timeoutMs: 20_000 })).rows).toBe(3);

    await service.confirmPending('demo');
    expect((await service.summary('demo')).pending).toBeUndefined();
    expect((await service.run('demo', { timeoutMs: 20_000 })).rows).toBe(5);
    expect(existsSync(path.join(root, 'demo', 'LAST_ERROR.txt'))).toBe(false);

    await service.preparePending('demo', 'again');
    await service.markPending('demo', { createdAt: 2, rows: 1, reason: 'again' });
    await service.discardPending('demo');
    expect((await service.summary('demo')).pending).toBeUndefined();
  });

  it('imports an AI-written folder as a package', async () => {
    const source = mkdtempSync(path.join(os.tmpdir(), 'ai-pkg-'));
    try {
      writePackage(source, {
        'manifest.json': JSON.stringify({ name: 'AI 包', entry: 'run.js', runtime: 'node' }),
        'run.js': "require('fs').writeFileSync(process.env.SOPHRON_OUTPUT, 'a\\n1\\n')",
        'node_modules/x/index.js': '',
      });
      const saved = await service.importFromDir(source, 'ai-pkg');
      expect(saved).toMatchObject({ id: 'ai-pkg', name: 'AI 包' });
      expect(existsSync(path.join(root, 'ai-pkg', 'node_modules'))).toBe(false);
      expect((await service.run('ai-pkg', { timeoutMs: 20_000 })).rows).toBe(1);
      await expect(service.importFromDir(source, '../escape')).rejects.toThrow('名称无效');
    } finally {
      rmSync(source, { recursive: true, force: true });
    }
  });

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
      expect(readFileSync(first.csvPath, 'utf8')).toContain(path.join('py', '.venv'));
      expect((await service.summary('py')).runtimeVersion).toMatch(/^Python \d+\.\d+$/);
      expect((await service.run('py', { timeoutMs: 60_000 })).installedDeps).toBe(false);
      writeFileSync(path.join(root, 'py', 'requirements.txt'), '# changed\n');
      expect((await service.summary('py')).depsReady).toBe(false);
      expect((await service.run('py', { timeoutMs: 60_000 })).installedDeps).toBe(true);
    },
    120_000
  );
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScriptPackageService } from '../../src/main/automation/script-packages/service';
import {
  buildScriptFixPayload,
  type FixScriptFilesInput,
  type ScriptFilesGenerator,
} from '../../src/main/automation/script-packages/generator';

let root: string;
let source: string;
let service: ScriptPackageService;

const MANIFEST = JSON.stringify({
  name: '竞品价格',
  entry: 'main.js',
  runtime: 'node',
  output: { format: 'csv', columns: ['sku', '名称'] },
});
const BROKEN_MAIN = `
const fs = require('fs');
const { parse } = require('./lib/parse');
const cfg = JSON.parse(fs.readFileSync(process.env.SOPHRON_CONFIG, 'utf8'));
fs.writeFileSync(process.env.SOPHRON_OUTPUT, 'sku,名称\\n' + cfg.items.map(parse).join('\\n') + '\\n');
`;
const BROKEN_PARSE = `exports.parse = (raw) => { if (!raw.name) throw new Error("KeyError: 'name'"); return raw.sku + ',' + raw.name; };`;
const EMPTY_PARSE = `exports.parse = (raw) => raw.sku + ',' + (raw.name ?? '');`;
const GOOD_PARSE = `exports.parse = (raw) => raw.sku + ',' + raw.title;`;

function writeDir(dir: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'script-fix-'));
  source = mkdtempSync(path.join(os.tmpdir(), 'script-fix-src-'));
  service = new ScriptPackageService({ rootDir: root, node: { command: process.execPath } });
  writeDir(source, {
    'manifest.json': MANIFEST,
    'main.js': BROKEN_MAIN,
    'lib/parse.js': BROKEN_PARSE,
    'config.json': JSON.stringify({
      items: [
        { sku: 'A1', title: '耳机' },
        { sku: 'B2', title: '音箱' },
      ],
    }),
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

/** Stands in for the fix agent: edits lib/parse.js in the workspace and self-tests once. */
function fakeGenerator(parses: string[]) {
  const calls: FixScriptFilesInput[] = [];
  const generator: ScriptFilesGenerator = {
    generate: async () => {
      throw new Error('fix must not regenerate');
    },
    async fix(input) {
      calls.push(input);
      const content = parses[calls.length - 1] ?? GOOD_PARSE;
      writeFileSync(path.join(input.workspace.dir, 'lib', 'parse.js'), content);
      const lastCheck = await input.workspace.test();
      return { summary: `第 ${calls.length} 次修复`, stop: 'done', lastCheck, selfTests: 1 };
    },
  };
  return { generator, calls };
}

describe('script package 交给 AI 修复 (editor)', () => {
  it('fixes a chat-created package in the editor and keeps overwriting the same AI 修复 draft', async () => {
    const saved = await service.importFromDir(source, 'jingpin', { sessionId: 'session-1' });
    expect(saved.version).toMatchObject({ version: 1, source: 'chat' });
    const trial = await service.testRun('jingpin', { timeoutMs: 20_000, target: 1 });
    expect(trial.ok).toBe(false);
    expect(trial.exitCode).toBe(1);
    expect(trial.log).toContain("KeyError: 'name'");

    const { generator, calls } = fakeGenerator([EMPTY_PARSE, GOOD_PARSE]);
    const first = await service.generateDraft(
      {
        packageId: 'jingpin',
        rulePrompt: '修复试运行报错',
        baseVersion: 1,
        runtime: 'node',
        fix: {
          error: trial.error!,
          log: trial.log,
          exitCode: trial.exitCode,
          round: 1,
          maxRounds: 3,
        },
      },
      generator
    );
    expect(calls[0].files.find((file) => file.path === 'lib/parse.js')?.content).toBe(BROKEN_PARSE);
    expect(calls[0].request).toMatchObject({ exitCode: 1, round: 1, maxRounds: 3 });
    expect(first.version).toMatchObject({
      version: 2,
      status: 'draft',
      source: 'ai_repair',
      baseVersion: 1,
    });
    expect(first.replaced).toBe(false);

    // Round 1 runs but leaves 名称 empty: the run itself is judged a failure now.
    expect(first.check).toMatchObject({ passed: false });
    expect(first.check?.reason).toContain('「名称」列全为空');
    const rerun = await service.testRun('jingpin', { timeoutMs: 20_000, target: 2 });
    expect(rerun.ok).toBe(false);
    expect(rerun.error).toContain('「名称」列全为空');
    const verdict = { reason: rerun.error };

    const second = await service.generateDraft(
      {
        packageId: 'jingpin',
        rulePrompt: '修复试运行报错',
        baseVersion: 2,
        runtime: 'node',
        fix: {
          error: verdict.reason!,
          round: 2,
          maxRounds: 3,
          previousAttempts: [`第 1 轮：${verdict.reason}`],
        },
      },
      generator
    );
    expect(second.version.version).toBe(2);
    expect(second.replaced).toBe(true);
    expect(calls[1].files.find((file) => file.path === 'lib/parse.js')?.content).toBe(EMPTY_PARSE);
    expect(second.check).toMatchObject({ passed: true, rows: 2 });
    const passed = await service.testRun('jingpin', { timeoutMs: 20_000, target: 2 });
    expect(passed).toMatchObject({ ok: true, rows: 2 });
    expect((await service.listVersions('jingpin')).map((version) => version.version)).toEqual([
      2, 1,
    ]);
    // Editor rule prompt is not overwritten by fixes.
    expect((await service.editorState('jingpin'))?.rulePrompt).toBeUndefined();

    // After publishing, a further fix starts a new draft.
    await service.publish('jingpin', 2);
    const third = await service.generateDraft(
      {
        packageId: 'jingpin',
        rulePrompt: '修复',
        baseVersion: 2,
        runtime: 'node',
        fix: { error: 'x' },
      },
      fakeGenerator([BROKEN_PARSE.replace('KeyError', 'KeyError2')]).generator
    );
    expect(third.version).toMatchObject({ version: 3, source: 'ai_repair', status: 'draft' });
  });

  it('builds the script payload from config.json and the failing file without secrets or absolute paths', () => {
    const secret = 'tok_live_abcdefghijklmnop1234';
    const payload = buildScriptFixPayload(
      {
        files: [
          { path: 'manifest.json', content: MANIFEST },
          { path: 'main.js', content: BROKEN_MAIN },
          { path: 'lib/parse.js', content: BROKEN_PARSE },
          {
            path: 'config.json',
            content: JSON.stringify({
              apiKey: secret,
              items: [{ sku: 'A1', title: 'x'.repeat(400) }],
            }),
          },
        ],
        request: {
          error: "Error: KeyError: 'name'",
          log: `Error: KeyError: 'name'\n    at exports.parse (/home/u/.config/sophron/scripts/jingpin/.sophron/run/trial/lib/parse.js:1:56)\n    at main (/home/u/.config/sophron/scripts/jingpin/.sophron/run/trial/main.js:5:1)`,
          exitCode: 1,
        },
      },
      [secret]
    );
    expect(payload.failingFile?.path).toBe('lib/parse.js');
    expect(payload.location).toMatchObject({ file: 'lib/parse.js', line: 1 });
    expect(payload.input?.label).toBe('config.json · items 1 条');
    expect(payload.otherFiles).toEqual(expect.arrayContaining(['manifest.json', 'config.json']));
    const text = JSON.stringify(payload);
    expect(text).not.toContain(secret);
    expect(text).not.toContain('/home/u');
    expect(text).not.toContain('x'.repeat(300));
  });
});

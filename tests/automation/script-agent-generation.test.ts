import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { registerFauxProvider } from '@earendil-works/pi-ai/compat';
import { ScriptPackageService } from '../../src/main/automation/script-packages/service';
import {
  buildScriptAgentSystemPrompt,
  createAgentScriptFilesGenerator,
  ScriptAgentCancelled,
  type ScriptFilesGenerator,
} from '../../src/main/automation/script-packages/generator';
import { createWorkspaceTools, scrubbedEnv } from '../../src/main/agent/workspace-tools';
import { evaluatePass } from '../../src/shared/fix-error';
import type { AppConfig } from '../../src/main/config/config-store';

const fauxHolder: { model?: unknown } = {};
vi.mock('../../src/main/agent/pi-ai-one-shot', () => ({
  resolvePiAiTarget: vi.fn(async () => ({ model: fauxHolder.model, apiKey: 'test' })),
  runPiAiOneShot: vi.fn(),
}));

const MANIFEST = JSON.stringify({
  name: 'x',
  entry: 'main.js',
  runtime: 'node',
  output: { format: 'csv', columns: ['rank', 'name'] },
});
const mainWith = (_rows: string[]) => `
const fs = require('fs');
const { rows } = require('./lib/rows');
fs.writeFileSync(process.env.SOPHRON_OUTPUT, 'rank,name\\n' + rows().join('\\n') + (rows().length ? '\\n' : ''));
`;
const rowsModule = (rows: string[]) => `exports.rows = () => ${JSON.stringify(rows)};`;

let root: string;
let service: ScriptPackageService;

function write(dir: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'script-agent-'));
  service = new ScriptPackageService({ rootDir: root, node: { command: process.execPath } });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('规则生成 with a self-testing agent', () => {
  it('runs the final trial, auto-fixes a 0-row result and saves one rule draft', async () => {
    const fixCalls: string[] = [];
    const generator: ScriptFilesGenerator = {
      async generate(input) {
        expect(input.baseFiles).toEqual([]);
        write(input.workspace.dir, {
          'manifest.json': MANIFEST,
          'main.js': mainWith([]),
          'lib/rows.js': rowsModule([]),
          'config.json': '{"on_empty":{"action":"error"}}',
        });
        return { summary: '用接口', stop: 'done', selfTests: 0 };
      },
      async fix(input) {
        fixCalls.push(input.request.error);
        expect(input.request).toMatchObject({ round: 1, maxRounds: 3 });
        write(input.workspace.dir, { 'lib/rows.js': rowsModule(['1,Alpha', '2,Beta']) });
        return { summary: '改为月榜', stop: 'done', selfTests: 1 };
      },
    };
    const result = await service.generateDraft(
      { name: '开源中国', rulePrompt: '抓取榜单', baseVersion: null, runtime: 'node' },
      generator
    );
    expect(fixCalls[0]).toContain('输出 0 行');
    expect(result.autoFixRounds).toBe(1);
    expect(result.check).toMatchObject({ passed: true, rows: 2, columns: ['rank', 'name'] });
    expect(result.agentSummary).toBe('改为月榜');
    expect(result.version).toMatchObject({ version: 1, source: 'rule', status: 'draft', rows: 2 });
    const manifest = JSON.parse(
      result.version.files.find((file) => file.path === 'manifest.json')!.content
    );
    expect(manifest).toMatchObject({ name: '开源中国', runtime: 'node' });
    expect((await service.listVersions(result.summary.id)).length).toBe(1);
  });

  it('对话转成脚本: saves a 「对话生成」 draft with the origin and hands over the references', async () => {
    const origin = {
      sessionId: 's1',
      sessionTitle: 'OSChina更新榜单获取',
      turn: 1,
      messageId: 'm4',
    };
    const seen: Array<{ fromConversation?: boolean; references?: unknown }> = [];
    const generator: ScriptFilesGenerator = {
      async generate(input) {
        seen.push({ fromConversation: input.fromConversation, references: input.references });
        write(input.workspace.dir, {
          'manifest.json': MANIFEST,
          'main.js': mainWith([]),
          'lib/rows.js': rowsModule(seen.length > 1 ? ['1,Alpha', '2,Beta'] : ['1,Alpha']),
        });
        return { summary: '用对话里验证过的接口', stop: 'done', selfTests: 1 };
      },
      fix: async () => {
        throw new Error('not needed');
      },
    };
    const references = [{ name: 'fetch.py', content: 'import requests' }];
    const first = await service.generateDraft(
      {
        name: 'OSChina榜单',
        rulePrompt: '【来自对话：OSChina更新榜单获取 · 第 1 轮，已验证】',
        baseVersion: null,
        runtime: 'node',
        origin,
        references,
      },
      generator
    );
    expect(seen[0]).toEqual({ fromConversation: true, references });
    expect(first.version).toMatchObject({ version: 1, source: 'chat', sessionId: 's1', rows: 1 });
    expect(first.summary.origin).toEqual(origin);
    expect((await service.list()).find((pkg) => pkg.id === first.summary.id)?.origin).toEqual(
      origin
    );
    // 再次转成脚本 (update): a new draft of the same package, based on the current one.
    await service.publish(first.summary.id, 1);
    const again = await service.generateDraft(
      {
        packageId: first.summary.id,
        rulePrompt: '【来自对话：OSChina更新榜单获取 · 第 1 轮，已验证】改',
        baseVersion: 1,
        runtime: 'node',
        origin,
      },
      generator
    );
    expect(again.version).toMatchObject({ version: 2, source: 'chat', baseVersion: 1 });
    expect(again.summary.published?.version).toBe(1);
  });

  it('stops after 3 auto-fix rounds and still saves the draft with the failing check', async () => {
    let fixes = 0;
    const generator: ScriptFilesGenerator = {
      async generate(input) {
        write(input.workspace.dir, {
          'manifest.json': MANIFEST,
          'main.js': mainWith([]),
          'lib/rows.js': rowsModule([]),
        });
        return { summary: '', stop: 'max_turns', error: '达到轮次上限', selfTests: 2 };
      },
      async fix(input) {
        fixes += 1;
        write(input.workspace.dir, { 'lib/rows.js': rowsModule([]) + `\n// ${fixes}` });
        return { summary: `第 ${fixes} 轮`, stop: 'done', selfTests: 1 };
      },
    };
    const result = await service.generateDraft(
      { name: 'p', rulePrompt: 'r', baseVersion: null, runtime: 'node' },
      generator
    );
    expect(fixes).toBe(3);
    expect(result.autoFixRounds).toBe(3);
    expect(result.check).toMatchObject({ passed: false });
    expect(result.check?.reason).toContain('输出 0 行');
    expect(result.version.status).toBe('draft');
  });

  it('cancelling a new package leaves nothing behind', async () => {
    const generator: ScriptFilesGenerator = {
      async generate(input) {
        write(input.workspace.dir, { 'manifest.json': MANIFEST });
        throw new ScriptAgentCancelled();
      },
      fix: async () => {
        throw new Error('no');
      },
    };
    await expect(
      service.generateDraft(
        { name: 'gone', rulePrompt: 'r', baseVersion: null, runtime: 'node' },
        generator
      )
    ).rejects.toThrow('已取消');
    expect(existsSync(path.join(root, 'gone'))).toBe(false);
  });

  it('a regeneration on an existing package restores the folder when it fails', async () => {
    const ok: ScriptFilesGenerator = {
      async generate(input) {
        write(input.workspace.dir, {
          'manifest.json': MANIFEST,
          'main.js': mainWith([]),
          'lib/rows.js': rowsModule(['1,A']),
        });
        return { summary: '', stop: 'done', selfTests: 1 };
      },
      fix: async () => ({ summary: '', stop: 'done', selfTests: 0 }),
    };
    const first = await service.generateDraft(
      { name: 'keep', rulePrompt: 'r', baseVersion: null, runtime: 'node' },
      ok
    );
    const id = first.summary.id;
    const broken: ScriptFilesGenerator = {
      async generate(input) {
        expect(input.baseFiles.map((file) => file.path)).toContain('lib/rows.js');
        write(input.workspace.dir, { 'lib/rows.js': 'garbage(' });
        throw new Error('模型出错');
      },
      fix: ok.fix,
    };
    await expect(
      service.generateDraft(
        { packageId: id, rulePrompt: 'r2', baseVersion: 1, runtime: 'node' },
        broken
      )
    ).rejects.toThrow('模型出错');
    expect(readFileSync(path.join(root, id, 'lib/rows.js'), 'utf8')).toBe(rowsModule(['1,A']));
    expect((await service.listVersions(id)).length).toBe(1);
  });
});

describe('0 rows fail automation runs', () => {
  it('a published package writing only a header fails and keeps the last good output', async () => {
    const dir = path.join(root, 'daily');
    write(dir, {
      'manifest.json': MANIFEST,
      'main.js': mainWith([]),
      'lib/rows.js': rowsModule(['1,A']),
    });
    // First import publishes v1 (a folder that predates versioning).
    await service.list();
    const good = await service.run('daily', { timeoutMs: 20_000 });
    expect(good.rows).toBe(1);
    write(dir, { 'lib/rows.js': rowsModule([]) });
    const draft = (await service.listVersions('daily'))[0];
    await service.publish('daily', draft.version);
    await expect(service.run('daily', { timeoutMs: 20_000 })).rejects.toThrow('输出 0 行');
    expect(readFileSync(good.csvPath, 'utf8')).toContain('1,A');
    const summary = await service.summary('daily');
    expect(summary.lastError?.message).toContain('输出 0 行');
    expect(summary.lastSuccess?.rows).toBe(1);
  });

  it('evaluatePass treats 0 rows and all-blank output as failures', () => {
    expect(evaluatePass({ ok: true, columns: ['a'], rows: [], totalRows: 0 })).toMatchObject({
      ok: false,
      reason: '通过但结果异常：输出 0 行',
    });
    expect(
      evaluatePass({ ok: true, columns: ['a', 'b'], rows: [{ a: '', b: ' ' }], totalRows: 1 })
    ).toMatchObject({ ok: false, reason: '通过但结果异常：所有列全为空' });
    expect(evaluatePass({ ok: true, columns: ['a'], rows: [{ a: '1' }], totalRows: 1 }).ok).toBe(
      true
    );
  });
});

describe('agent generator tools', () => {
  let faux: ReturnType<typeof registerFauxProvider>;
  let work: string;
  beforeEach(() => {
    faux = registerFauxProvider({ provider: 'faux-test' });
    fauxHolder.model = faux.getModel();
    work = mkdtempSync(path.join(os.tmpdir(), 'script-agent-ws-'));
  });
  afterEach(() => {
    faux.unregister();
    rmSync(work, { recursive: true, force: true });
  });

  it('writes files in the folder, self-tests and refuses writes outside it', async () => {
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.txt`);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write', { path: 'manifest.json', content: MANIFEST })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxToolCall('write', { path: outside, content: 'x' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxToolCall('write', { path: '.git/config', content: 'x' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxToolCall('script_package_test', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('数据来自 /project/ranking?type=month')]),
    ]);
    const progress: string[] = [];
    const test = vi.fn(async () => ({ passed: true, rows: 10, columns: ['rank'], durationMs: 5 }));
    const outcome = await createAgentScriptFilesGenerator(() => ({}) as AppConfig).generate({
      name: 'osc',
      rulePrompt: '抓榜单',
      runtime: 'node',
      baseFiles: [],
      workspace: { dir: work, test },
      onProgress: (phase, text) => progress.push(`${phase}:${text}`),
    });
    expect(outcome).toMatchObject({
      stop: 'done',
      selfTests: 1,
      summary: '数据来自 /project/ranking?type=month',
    });
    expect(readFileSync(path.join(work, 'manifest.json'), 'utf8')).toBe(MANIFEST);
    expect(existsSync(outside)).toBe(false);
    expect(test).toHaveBeenCalledTimes(1);
    expect(progress).toContain('code_generation:写入 manifest.json（1 行）');
    expect(progress.some((line) => line.startsWith('verify:✓ 通过'))).toBe(true);
    expect(progress.some((line) => line.includes('只能写入工作目录内的文件'))).toBe(true);
    expect(progress.some((line) => line.includes('不能写入 .git/'))).toBe(true);
    expect(progress.join('\n')).not.toContain('{"');
  });

  it('stops at the turn cap and honours cancellation', async () => {
    faux.setResponses(
      Array.from({ length: 60 }, () =>
        fauxAssistantMessage([fauxToolCall('ls', { path: '.' })], { stopReason: 'toolUse' })
      )
    );
    const capped = await createAgentScriptFilesGenerator(() => ({}) as AppConfig).generate({
      name: 'osc',
      rulePrompt: 'r',
      runtime: 'node',
      baseFiles: [],
      workspace: { dir: work, test: async () => ({ passed: false, durationMs: 0 }) },
    });
    expect(capped.stop).toBe('max_turns');

    const controller = new AbortController();
    controller.abort();
    await expect(
      createAgentScriptFilesGenerator(() => ({}) as AppConfig).generate({
        name: 'osc',
        rulePrompt: 'r',
        runtime: 'node',
        baseFiles: [],
        workspace: { dir: work, test: async () => ({ passed: false, durationMs: 0 }) },
        signal: controller.signal,
      })
    ).rejects.toThrow('已取消');
  });

  it('shell env drops secrets and the prompt asks for the real API, browser headers and on_empty', () => {
    const env = scrubbedEnv({ PATH: '/bin', OPENAI_API_KEY: 'k', GITHUB_TOKEN: 't', HOME: '/h' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' });
    expect(
      createWorkspaceTools({ dir: work, bash: true, web: true }).map((tool) => tool.name)
    ).toEqual(['read', 'ls', 'write', 'edit', 'bash', 'webfetch', 'websearch']);
    const prompt = buildScriptAgentSystemPrompt('python');
    expect(prompt).toContain('XHR/JSON API');
    expect(prompt).toContain('Referer');
    expect(prompt).toContain('on_empty');
    expect(prompt).toContain('script_package_test');
  });
});

describe('describeCommand', () => {
  it('turns bash probes into readable console lines without headers', async () => {
    const { describeCommand } = await import('../../src/main/automation/script-packages/generator');
    expect(
      describeCommand(
        `cd /tmp && UA="Mozilla/5.0 (X)"; curl -s -m 60 -A "$UA" -H "Referer: https://www.oschina.net/" "https://www.oschina.net/project" -o p.html`
      )
    ).toBe('请求 https://www.oschina.net/project');
    expect(
      describeCommand(
        `cd /tmp && curl -s -A "Mozilla/5.0 (Windows NT 10.0)" https://a.com/x.js | grep foo`
      )
    ).toBe('请求 https://a.com/x.js');
    expect(describeCommand(`cd /tmp && grep -o 'x' idx.js | head`)).toBe(
      "执行：grep -o 'x' idx.js | head"
    );
    expect(
      describeCommand(
        `python3 - <<'EOF'\nurl="https://apiv1.oschina.net/oschinapi/project/ranking"\nEOF`
      )
    ).toBe('运行 Python 探查 https://apiv1.oschina.net/oschinapi/project/ranking');
  });
});

describe('newPackageId', () => {
  it('skips ids whose version rows outlived their folder', async () => {
    const { MemoryScriptVersionStore } =
      await import('../../src/main/automation/script-packages/version-store');
    const versions = new MemoryScriptVersionStore();
    versions.insert({
      packageId: 'OSChina',
      version: 1,
      commit: 'abc',
      status: 'published',
      source: 'chat',
      entry: 'main.py',
      runtime: 'python',
      baseVersion: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const scripts = new ScriptPackageService({ rootDir: root, versions });
    expect(await scripts.newPackageId('OSChina')).toBe('OSChina_2');
  });
});

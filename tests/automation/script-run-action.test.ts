import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationActionRegistry } from '../../src/main/automation/automation-action-registry';
import type { AutomationRunContext } from '../../src/main/automation/automation-action-registry';
import { registerScriptRunAction } from '../../src/main/automation/script-run-action';
import { BackgroundRepairs } from '../../src/main/automation/script-packages/background-repairs';
import { SCRIPT_REPAIR_PENDING } from '../../src/shared/automation/script-package';
import type { AutomationStore } from '../../src/main/automation/automation-store';
import type { AutomationRun } from '../../src/shared/automation/types';
import { ScriptPackageService } from '../../src/main/automation/script-packages/service';
import type { DataCommandService } from '../../src/main/data/data-command-service';
import type {
  FixScriptFilesInput,
  ScriptFilesGenerator,
} from '../../src/main/automation/script-packages/generator';

let root: string;
let scripts: ScriptPackageService;

function context(): AutomationRunContext & { artifacts: unknown[] } {
  const artifacts: unknown[] = [];
  return {
    automationId: 'a1',
    runId: 'r1',
    now: Date.now(),
    outputs: new Map(),
    emitArtifact: (artifact) => artifacts.push(artifact),
    log: vi.fn(),
    artifacts,
  };
}

let clock = Date.now();
let repairs: BackgroundRepairs;
let runs: Map<string, AutomationRun>;
let lastError: string | null;

/** Minimal run store: the runner records a failed run with the thrown message. */
const store = {
  listRuns: () => [...runs.values()],
  updateRun: (id: string, updates: Partial<AutomationRun>) => {
    const next = { ...runs.get(id)!, ...updates } as AutomationRun;
    runs.set(id, next);
    return next;
  },
  get: () => ({ id: 'a1', lastError }),
  setRuntimeState: (_id: string, updates: { lastError?: string | null }) => {
    if (updates.lastError !== undefined) lastError = updates.lastError;
    return null;
  },
} as unknown as AutomationStore;

/** Execute like the runner: a throw becomes the failed run's error. */
async function failRun(
  action: ReturnType<typeof setup>['action'],
  config: Record<string, unknown>
): Promise<string> {
  const ctx = context();
  runs.set(ctx.runId, { id: ctx.runId, automationId: 'a1', status: 'running' } as AutomationRun);
  try {
    await action.execute(config, ctx, node(config));
  } catch (error) {
    const message = (error as Error).message;
    runs.set(ctx.runId, {
      ...runs.get(ctx.runId)!,
      status: 'failed',
      error: message,
      executionSummary: {
        tables: [],
        executedNodeIds: [],
        skippedNodeIds: [],
        steps: [
          {
            nodeId: 'n1',
            type: 'script.run',
            status: 'failed',
            startedAt: 0,
            finishedAt: 0,
            durationMs: 0,
            error: message,
          },
        ],
      },
    });
    lastError = message;
    return message;
  }
  throw new Error('expected the run to fail');
}

const settled = async () => {
  await repairs.idle();
  return runs.get('r1')!;
};

function setup(generator?: ScriptFilesGenerator, repairPolicy = { cooldownMs: 0, dailyCap: 100 }) {
  const commands = {
    updateRawTable: vi.fn(async (input: { id: string }) => ({
      rawTable: { id: input.id, name: 'T' },
    })),
    createRawTable: vi.fn(async (input: { name: string }) => ({
      rawTable: { id: 'new-raw', name: input.name },
    })),
    listRawTables: vi.fn(async () => ({ rawTables: [{ name: '汇率' }], total: 1 })),
  };
  const registry = new AutomationActionRegistry();
  registerScriptRunAction(registry, {
    scripts,
    commands: commands as unknown as DataCommandService,
    generator,
    ...(generator ? { store } : {}),
    repairs,
    repairPolicy,
    now: () => clock,
  });
  return { commands, action: registry.get('script.run')! };
}

const node = (config: Record<string, unknown>) => ({
  id: 'n1',
  type: 'script.run',
  enabled: true,
  config,
});

beforeEach(() => {
  clock = Date.now();
  repairs = new BackgroundRepairs();
  runs = new Map();
  lastError = null;
  root = mkdtempSync(path.join(os.tmpdir(), 'script-action-'));
  scripts = new ScriptPackageService({ rootDir: root, node: { command: process.execPath } });
  mkdirSync(path.join(root, 'fx'));
  writeFileSync(
    path.join(root, 'fx', 'manifest.json'),
    JSON.stringify({ name: '汇率', entry: 'main.js', runtime: 'node' })
  );
  writeFileSync(
    path.join(root, 'fx', 'main.js'),
    "require('fs').writeFileSync(process.env.SOPHRON_OUTPUT, 'ccy,rate\\nCNY,7.1\\nEUR,0.9\\n')"
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('script.run action', () => {
  it('imports the output into the selected raw table without any AI session', async () => {
    const startSession = vi.fn();
    const { commands, action } = setup({ generate: startSession, fix: startSession });
    const ctx = context();
    const config = { packageId: 'fx', timeoutMs: 20_000, rawTableId: 'raw-1' };
    const result = await action.execute(config, ctx, node(config));
    expect(result).toBe('汇率 · 2 行');
    expect(commands.updateRawTable).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'raw-1',
        sourceKind: 'csv',
        filePath: expect.stringContaining('output.csv'),
      })
    );
    expect(startSession).not.toHaveBeenCalled();
    expect(ctx.artifacts).toEqual([
      expect.objectContaining({ kind: 'data_input', dataRef: { kind: 'raw_table', id: 'raw-1' } }),
    ]);
  });

  it('creates a uniquely named raw table when none is selected', async () => {
    const { commands, action } = setup();
    const config = { packageId: 'fx', timeoutMs: 20_000 };
    await action.execute(config, context(), node(config));
    expect(commands.createRawTable).toHaveBeenCalledWith(
      expect.objectContaining({ name: '汇率 2', sourceKind: 'csv' })
    );
  });

  it('reuses the raw table already fed by this package when the config lost its id', async () => {
    const { commands, action } = setup();
    const outputPath = path.join(root, 'fx', '.sophron', 'output.csv');
    commands.listRawTables.mockResolvedValue({
      rawTables: [{ id: 'raw-9', name: '汇率', sourcePath: outputPath } as never],
      total: 1,
    });
    const config = { packageId: 'fx', timeoutMs: 20_000 };
    await expect(action.execute(config, context(), node(config))).resolves.toBe('汇率 · 2 行');
    expect(commands.createRawTable).not.toHaveBeenCalled();
    expect(commands.updateRawTable).toHaveBeenCalledWith(expect.objectContaining({ id: 'raw-9' }));
  });

  it('notify policy: fails with the package name and keeps old data', async () => {
    const startSession = vi.fn();
    const { commands, action } = setup({ generate: startSession, fix: startSession });
    await breakPublished();
    const config = {
      packageId: 'fx',
      timeoutMs: 20_000,
      rawTableId: 'raw-1',
      onScriptError: 'notify',
    };
    await expect(action.execute(config, context(), node(config))).rejects.toThrow(
      '汇率：选择器失效'
    );
    expect(commands.updateRawTable).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it('runs only the published version, never an unpublished folder edit', async () => {
    const { action } = setup();
    await scripts.list();
    writeFileSync(path.join(root, 'fx', 'main.js'), "console.error('坏了'); process.exit(1)");
    const config = { packageId: 'fx', timeoutMs: 20_000, rawTableId: 'raw-1' };
    await expect(action.execute(config, context(), node(config))).resolves.toBe('汇率 · 2 行');
    expect((await scripts.summary('fx')).draft?.source).toBe('manual');
  });

  it('ai_repair policy: fails right away, repairs in the background and rewrites the run error', async () => {
    await breakPublished();
    const fix = vi.fn(async (input: FixScriptFilesInput) => {
      expect(input.request.error).toContain('选择器失效');
      // The agent fixes the published (broken) code in its workspace.
      expect(input.files.find((file) => file.path === 'main.js')?.content).toContain('选择器失效');
      writeFileSync(
        path.join(input.workspace.dir, 'main.js'),
        "require('fs').writeFileSync(process.env.SOPHRON_OUTPUT, 'ccy,rate\\nCNY,7.3\\n')"
      );
      return { summary: '修好了选择器', stop: 'done' as const, selfTests: 1 };
    });
    const generate = vi.fn();
    const check = vi.spyOn(scripts, 'checkWorkingTree');
    const { commands, action } = setup({ generate, fix });
    const config = {
      packageId: 'fx',
      timeoutMs: 20_000,
      rawTableId: 'raw-1',
      onScriptError: 'ai_repair',
    };
    expect(await failRun(action, config)).toBe(`汇率：选择器失效${SCRIPT_REPAIR_PENDING}`);
    const run = await settled();
    const outcome = '汇率：选择器失效 · AI 已修复为 v3（试运行 1 行），等你确认使用';
    expect(run.error).toBe(outcome);
    expect(run.executionSummary?.steps?.[0]?.error).toBe(outcome);
    expect(lastError).toBe(outcome);
    // The self-test uses the node's timeout.
    expect(check).toHaveBeenCalledWith('fx', 20_000);
    expect(commands.updateRawTable).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    // Second failure while the v3 draft waits for review: no new repair.
    expect(await failRun(action, config)).toContain(
      'AI 已修复为 v3（试运行 1 行），等你确认使用；本次不再修复'
    );
    await repairs.idle();
    expect(fix).toHaveBeenCalledTimes(1);
    const summary = await scripts.summary('fx');
    expect(summary.draft).toMatchObject({ version: 3, source: 'ai_repair', baseVersion: 2 });
    // The published (broken) version keeps running until the draft is confirmed.
    await expect(scripts.run('fx', { timeoutMs: 20_000 })).rejects.toThrow('选择器失效');
    await scripts.publish('fx', 3);
    const fixed = await scripts.run('fx', { timeoutMs: 20_000 });
    expect(fixed.rows).toBe(1);
    expect(readFileSync(fixed.csvPath, 'utf8')).toContain('7.3');
  });

  it('ai_repair policy: cooldown and daily cap per package', async () => {
    await breakPublished();
    const fix = vi.fn(async () => {
      throw new Error('模型不可用');
    });
    const { action } = setup({ generate: vi.fn(), fix }, { cooldownMs: 60_000, dailyCap: 2 });
    const config = { packageId: 'fx', timeoutMs: 20_000, onScriptError: 'ai_repair' };
    await failRun(action, config);
    expect((await settled()).error).toContain('AI 修复失败：模型不可用');
    expect(await failRun(action, config)).toContain('未交给 AI 修复：距上次修复不足 1 分钟');
    clock += 2 * 60_000;
    expect(await failRun(action, config)).toContain(SCRIPT_REPAIR_PENDING);
    await repairs.idle();
    clock += 2 * 60_000;
    expect(await failRun(action, config)).toContain('未交给 AI 修复：24 小时内已自动修复 2 次');
    clock += 24 * 60 * 60_000;
    expect(await failRun(action, config)).toContain(SCRIPT_REPAIR_PENDING);
    await repairs.idle();
    expect(fix).toHaveBeenCalledTimes(3);
  });

  it('ai_repair policy: stopping the automation aborts its background repair', async () => {
    await breakPublished();
    const fix = vi.fn(
      (input: FixScriptFilesInput) =>
        new Promise<never>((_resolve, reject) =>
          input.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        )
    );
    const { action } = setup({ generate: vi.fn(), fix });
    const config = { packageId: 'fx', timeoutMs: 20_000, onScriptError: 'ai_repair' };
    await failRun(action, config);
    await vi.waitFor(() => expect(fix).toHaveBeenCalled());
    expect(repairs.isRunning('fx')).toBe(true);
    repairs.stop('other-automation');
    expect(repairs.isRunning('fx')).toBe(true);
    repairs.stop('a1');
    expect((await settled()).error).toContain('AI 修复已停止');
    expect(repairs.isRunning('fx')).toBe(false);
  });

  it('ai_repair policy without a generator reports it is unavailable', async () => {
    await breakPublished();
    const { action } = setup();
    const config = { packageId: 'fx', timeoutMs: 20_000, onScriptError: 'ai_repair' };
    await expect(action.execute(config, context(), node(config))).rejects.toThrow('AI 修复不可用');
  });
});

/** v1 is the working script; publish a broken v2 so automations fail. */
async function breakPublished() {
  await scripts.list();
  writeFileSync(path.join(root, 'fx', 'main.js'), "console.error('选择器失效'); process.exit(1)");
  const saved = await scripts.saveDraft('fx', { source: 'manual' });
  await scripts.publish('fx', saved.version.version);
}

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationActionRegistry } from '../../src/main/automation/automation-action-registry';
import type { AutomationRunContext } from '../../src/main/automation/automation-action-registry';
import { registerScriptRunAction } from '../../src/main/automation/script-run-action';
import { ScriptPackageService } from '../../src/main/automation/script-packages/service';
import type { DataCommandService } from '../../src/main/data/data-command-service';
import type { SessionManager } from '../../src/main/session/session-manager';

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

function setup(sessionManager?: Partial<SessionManager>) {
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
    sessionManager: sessionManager as SessionManager | undefined,
    now: () => Date.now(),
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
    const { commands, action } = setup({ startSession } as Partial<SessionManager>);
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
    const { commands, action } = setup({ startSession } as Partial<SessionManager>);
    writeFileSync(path.join(root, 'fx', 'main.js'), "console.error('选择器失效'); process.exit(1)");
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

  it('ai_repair policy: fixes a pending copy, test-runs it and leaves it for confirmation', async () => {
    writeFileSync(path.join(root, 'fx', 'main.js'), "console.error('选择器失效'); process.exit(1)");
    const startSession = vi.fn(async (_title: string, prompt: string, cwd: string) => {
      expect(prompt).toContain('SOPHRON_OUTPUT');
      // The "AI" repairs the copy in its working directory.
      writeFileSync(
        path.join(cwd, 'main.js'),
        "require('fs').writeFileSync(process.env.SOPHRON_OUTPUT, 'ccy,rate\\nCNY,7.2\\n')"
      );
      return { id: 's1', title: '修复脚本' };
    });
    const listSessions = vi.fn(() => [{ id: 's1', status: 'completed' }]);
    const { commands, action } = setup({
      startSession,
      listSessions,
    } as unknown as Partial<SessionManager>);
    const config = {
      packageId: 'fx',
      timeoutMs: 20_000,
      rawTableId: 'raw-1',
      onScriptError: 'ai_repair',
    };
    await expect(action.execute(config, context(), node(config))).rejects.toThrow(
      '汇率：选择器失效 · 脚本已重新生成（试运行 1 行），待确认'
    );
    expect(commands.updateRawTable).not.toHaveBeenCalled();
    // Unattended: permission prompts are denied rather than blocking the run.
    expect((startSession.mock.calls[0] as unknown[])[7]).toMatchObject({
      denyPermissionRequests: true,
      permissionRules: expect.arrayContaining([{ tool: 'script_package_test', action: 'allow' }]),
    });
    const summary = await scripts.summary('fx');
    expect(summary.pending).toMatchObject({ rows: 1, sessionId: 's1' });
    // Active version is still the broken one until confirmed.
    await expect(scripts.run('fx', { timeoutMs: 20_000 })).rejects.toThrow('选择器失效');
    await scripts.confirmPending('fx');
    expect((await scripts.run('fx', { timeoutMs: 20_000 })).rows).toBe(1);
  });
});

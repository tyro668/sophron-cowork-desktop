import {
  SCRIPT_REPAIR_PENDING,
  SCRIPT_RUN_ACTION,
  scriptRunConfigSchema,
  type ScriptRunConfig,
} from '../../shared/automation/script-package';
import type { DataCommandService } from '../data/data-command-service';
import type { ScriptFilesGenerator } from './script-packages/generator';
import { AutomationActionRegistry, objectSchema } from './automation-action-registry';
import type { AutomationRunContext } from './automation-action-registry';
import type { AutomationStore } from './automation-store';
import { cloudActionState } from './cloud-action-state';
import { backgroundRepairs, type BackgroundRepairs } from './script-packages/background-repairs';
import {
  formatTimeout,
  type AutoRepairPolicy,
  type ScriptPackageService,
} from './script-packages/service';

const REPAIR_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_REPAIR_POLICY: AutoRepairPolicy = { cooldownMs: 30 * 60 * 1000, dailyCap: 5 };

export interface ScriptRunActionOptions {
  scripts: ScriptPackageService;
  commands?: DataCommandService;
  store?: AutomationStore;
  /** The script generation agent used for onScriptError 'ai_repair'. */
  generator?: ScriptFilesGenerator;
  now: () => number;
  /** Background AI 修复 jobs (defaults to the app-wide registry). */
  repairs?: BackgroundRepairs;
  repairPolicy?: AutoRepairPolicy;
}

export function registerScriptRunAction(
  registry: AutomationActionRegistry,
  options: ScriptRunActionOptions
): void {
  registry.register({
    type: SCRIPT_RUN_ACTION,
    title: 'Run script',
    description: 'Run a saved script package and import its output into a raw table, without AI.',
    category: 'data',
    icon: 'folder-code',
    version: 1,
    defaultConfig: { packageId: '', timeoutMs: 120_000, onScriptError: 'notify' },
    configSchema: objectSchema(
      {
        packageId: { type: 'string', title: 'Script package' },
        timeoutMs: { type: 'integer', title: 'Timeout' },
        rawTableId: { type: 'string', title: 'Output raw table' },
        rawTableName: { type: 'string', title: 'Output raw table name' },
        onScriptError: { type: 'string', enum: ['notify', 'ai_repair'], default: 'notify' },
      },
      ['packageId']
    ),
    validate: (config) => {
      if (!scriptRunConfigSchema.safeParse(config).success) {
        throw new Error('执行脚本：请选择脚本包');
      }
    },
    execute: async (raw, context, node) => {
      const config = scriptRunConfigSchema.parse(raw);
      const summary = await options.scripts.summary(config.packageId);
      const name = summary.name;
      let output;
      try {
        output = await options.scripts.run(config.packageId, { timeoutMs: config.timeoutMs });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        context.log({ level: 'error', message: `${name}: ${reason}` });
        const suffix =
          config.onScriptError === 'ai_repair'
            ? await startRepair(options, config, reason, context)
            : '';
        throw new Error(`${name}：${reason}${suffix}`, { cause: error });
      }
      if (!options.commands) throw new Error('执行脚本：数据服务不可用');
      let rawTableId = config.rawTableId || '';
      try {
        // No table chosen: reuse the one this package already feeds (an editor draft may not
        // have the id saved back by an earlier run yet), else create one named after it.
        const listed = rawTableId
          ? null
          : await options.commands.listRawTables({ limit: 1000 }).catch(() => null);
        const reused = listed?.rawTables.find((table) => table.sourcePath === output.csvPath);
        let tableName = reused?.name;
        if (reused) rawTableId = reused.id;
        if (rawTableId) {
          await options.commands.updateRawTable({
            id: rawTableId,
            sourceKind: 'csv',
            filePath: output.csvPath,
          });
        } else {
          const created = await options.commands.createRawTable({
            name: availableName(
              (listed?.rawTables ?? []).map((table) => table.name),
              config.rawTableName || name
            ),
            sourceKind: 'csv',
            filePath: output.csvPath,
          });
          rawTableId = created.rawTable.id;
          tableName = created.rawTable.name;
        }
        if (rawTableId !== config.rawTableId && options.store) {
          cloudActionState(
            options.store,
            context.automationId,
            node,
            scriptRunConfigSchema,
            config
          ).save({ rawTableId, ...(tableName ? { rawTableName: tableName } : {}) });
        }
      } catch (error) {
        throw new Error(
          `${name}：写入原始表失败：${error instanceof Error ? error.message : String(error)}`,
          { cause: error }
        );
      }
      context.emitArtifact({
        sourceNodeId: node.id,
        kind: 'data_input',
        title: name,
        summary: `${output.rows} rows, ${output.columns.length} columns`,
        dataRef: { kind: 'raw_table', id: rawTableId },
      });
      if (output.warnings?.length) {
        // Passed with a fallback / suspicious shape: a yellow line in the run log, not a plain ✓.
        for (const warning of output.warnings)
          context.log({ level: 'warning', message: `${name}：${warning}` });
        return `${name} · ${output.rows} 行 · ⚠ ${output.warnings.join('；')}`;
      }
      return `${name} · ${output.rows} 行`;
    },
  });
}

function availableName(taken: string[], base: string): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    if (!names.has(`${base} ${index}`)) return `${base} ${index}`;
  }
  return `${base} ${Date.now()}`;
}

/**
 * Hand the failure to the script generation agent (the same one as 脚本管理's AI 修复). The
 * run fails right away with SCRIPT_REPAIR_PENDING; the repair runs in the background, fixes
 * the published version, self-tests it with the node's timeout and saves the 「AI 修复」 draft,
 * then rewrites the run's error with the outcome. Skipped while an earlier AI 修复 draft waits
 * for review, during the cooldown, and past the daily cap.
 */
async function startRepair(
  options: ScriptRunActionOptions,
  config: ScriptRunConfig,
  reason: string,
  context: AutomationRunContext
): Promise<string> {
  if (!options.generator) return ' · AI 修复不可用';
  const repairs = options.repairs ?? backgroundRepairs;
  try {
    const summary = await options.scripts.summary(config.packageId);
    const pending = summary.draft;
    if (pending?.source === 'ai_repair') {
      return pending.rows != null
        ? ` · AI 已修复为 v${pending.version}（试运行 ${pending.rows} 行），等你确认使用；本次不再修复`
        : ` · AI 修复的 v${pending.version} 未通过试运行，等你查看；本次不再修复`;
    }
    const baseVersion = summary.published?.version ?? summary.draft?.version;
    if (baseVersion == null) return ' · AI 修复不可用：没有可修复的版本';
    if (repairs.isRunning(config.packageId)) return ' · AI 正在修复（由更早的一次运行发起）';
    const booked = await options.scripts.reserveAutoRepair(
      config.packageId,
      options.now(),
      options.repairPolicy ?? DEFAULT_REPAIR_POLICY
    );
    if (!booked.ok) return ` · 未交给 AI 修复：${booked.reason}`;
    const generator = options.generator;
    repairs.start(config.packageId, context.automationId, async (stop) => {
      const outcome = await repairOnce(
        options,
        generator,
        config,
        reason,
        baseVersion,
        context,
        stop
      );
      await settleRunError(options, context, outcome);
    });
    return SCRIPT_REPAIR_PENDING;
  } catch (error) {
    return ` · AI 修复失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function repairOnce(
  options: ScriptRunActionOptions,
  generator: ScriptFilesGenerator,
  config: ScriptRunConfig,
  reason: string,
  baseVersion: number,
  context: AutomationRunContext,
  stop: AbortSignal
): Promise<string> {
  const signal = AbortSignal.any([stop, AbortSignal.timeout(REPAIR_TIMEOUT_MS)]);
  try {
    const summary = await options.scripts.summary(config.packageId);
    const result = await options.scripts.generateDraft(
      {
        packageId: config.packageId,
        rulePrompt: `自动化运行失败：${reason}`.slice(0, 4000),
        baseVersion,
        runtime: summary.runtime,
        fix: {
          error: reason,
          note: `自动化定时运行失败；修复后试运行需在 ${formatTimeout(config.timeoutMs)} 内完成。`,
        },
      },
      generator,
      { automationId: context.automationId, signal, checkTimeoutMs: config.timeoutMs }
    );
    const version = result.version.version;
    if (!result.check?.passed) {
      return ` · AI 修复的 v${version} 未通过试运行：${result.check?.reason ?? ''}`;
    }
    return ` · AI 已修复为 v${version}（试运行 ${result.check.rows ?? 0} 行），等你确认使用`;
  } catch (error) {
    if (stop.aborted) return ' · AI 修复已停止（自动化已暂停、停用或删除）';
    if (signal.aborted) return ` · AI 修复超时（${formatTimeout(REPAIR_TIMEOUT_MS)}）`;
    return ` · AI 修复失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Swap SCRIPT_REPAIR_PENDING in the finished run (and the automation's last error) for the outcome. */
async function settleRunError(
  options: ScriptRunActionOptions,
  context: AutomationRunContext,
  outcome: string
): Promise<void> {
  const store = options.store;
  if (!store) return;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const run = store
      .listRuns(context.automationId, { limit: 200, status: 'all' })
      .find((item) => item.id === context.runId);
    if (!run) return;
    if (run.status !== 'running' && run.status !== 'queued') {
      const swap = <T extends string | null | undefined>(text: T): T =>
        (text?.includes(SCRIPT_REPAIR_PENDING)
          ? text.replace(SCRIPT_REPAIR_PENDING, outcome)
          : text) as T;
      const summary = run.executionSummary;
      store.updateRun(run.id, {
        error: swap(run.error) ?? null,
        ...(summary?.steps
          ? {
              executionSummary: {
                ...summary,
                steps: summary.steps.map((step) =>
                  step.error ? { ...step, error: swap(step.error) } : step
                ),
              },
            }
          : {}),
      });
      const automation = store.get(context.automationId);
      if (automation?.lastError?.includes(SCRIPT_REPAIR_PENDING)) {
        store.setRuntimeState(context.automationId, { lastError: swap(automation.lastError) });
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

import {
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
import { formatTimeout, type ScriptPackageService } from './script-packages/service';

const REPAIR_TIMEOUT_MS = 20 * 60 * 1000;

export interface ScriptRunActionOptions {
  scripts: ScriptPackageService;
  commands?: DataCommandService;
  store?: AutomationStore;
  /** The script generation agent used for onScriptError 'ai_repair'. */
  generator?: ScriptFilesGenerator;
  now: () => number;
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
            ? await repairWithAi(options, config, reason, context)
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
 * Let the script generation agent (the same one as 脚本管理's AI 修复) fix the published
 * version headlessly and self-test it. The result is saved as the 「AI 修复」 draft — repeated
 * failures overwrite that same draft. The published version keeps running until the user
 * reviews and publishes the draft in the editor.
 */
async function repairWithAi(
  options: ScriptRunActionOptions,
  config: ScriptRunConfig,
  reason: string,
  context: AutomationRunContext
): Promise<string> {
  if (!options.generator) return ' · AI 重新生成不可用';
  try {
    const summary = await options.scripts.summary(config.packageId);
    const baseVersion = summary.published?.version ?? summary.draft?.version;
    if (baseVersion == null) return ' · AI 重新生成不可用：没有可修复的版本';
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
      options.generator,
      { automationId: context.automationId, signal: AbortSignal.timeout(REPAIR_TIMEOUT_MS) }
    );
    const version = result.version.version;
    if (!result.check?.passed) {
      return ` · AI 重新生成的 v${version} 草稿未通过试运行：${result.check?.reason ?? ''}`;
    }
    return ` · 脚本已重新生成为 v${version} 草稿（试运行 ${result.check.rows ?? 0} 行），待发布`;
  } catch (error) {
    return ` · AI 重新生成失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

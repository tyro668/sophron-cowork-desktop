import {
  SCRIPT_RUN_ACTION,
  scriptRunConfigSchema,
  type ScriptRunConfig,
} from '../../shared/automation/script-package';
import { getPermissionRulesForPolicy } from '../../shared/permission-policies';
import type { DataCommandService } from '../data/data-command-service';
import type { SessionManager } from '../session/session-manager';
import { AutomationActionRegistry, objectSchema } from './automation-action-registry';
import type { AutomationRunContext } from './automation-action-registry';
import type { AutomationStore } from './automation-store';
import { cloudActionState } from './cloud-action-state';
import { waitForSession } from './wait-for-session';
import { formatTimeout, type ScriptPackageService } from './script-packages/service';

const REPAIR_TIMEOUT_MS = 20 * 60 * 1000;

export interface ScriptRunActionOptions {
  scripts: ScriptPackageService;
  commands?: DataCommandService;
  store?: AutomationStore;
  sessionManager?: SessionManager;
  sendSessionUpdate?: (session: Awaited<ReturnType<SessionManager['startSession']>>) => void;
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
            ? await repairWithAi(options, config, name, reason, context)
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
 * Ask the AI to fix the package in its own folder (the published version is checked out
 * there first), then dry-run the result. A passing fix is committed as the 「AI 修复」 draft —
 * repeated failures overwrite that same draft. The published version keeps running until
 * the user reviews and publishes the draft.
 */
async function repairWithAi(
  options: ScriptRunActionOptions,
  config: ScriptRunConfig,
  name: string,
  reason: string,
  context: AutomationRunContext
): Promise<string> {
  if (!options.sessionManager) return ' · AI 重新生成不可用';
  let started = false;
  try {
    const dir = await options.scripts.beginRepair(config.packageId);
    started = true;
    const prompt = buildRepairPrompt(name, config.packageId, dir, reason, config.timeoutMs);
    const permissionPolicy = 'auto_review' as const;
    const session = await options.sessionManager.startSession(
      `修复脚本：${name}`,
      prompt,
      dir,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        suppressCompletionNotification: true,
        // Runs unattended from an automation: never block on a permission prompt.
        denyPermissionRequests: true,
        selectedSkillNames: [],
        permissionPolicy,
        permissionRules: [
          { tool: 'script_package_test', action: 'allow' },
          { tool: 'script_package_list', action: 'allow' },
          ...getPermissionRulesForPolicy(permissionPolicy),
        ],
      }
    );
    options.sendSessionUpdate?.(session);
    context.emitArtifact({
      kind: 'session',
      title: session.title,
      summary: reason.slice(0, 160),
      dataRef: { kind: 'session', id: session.id },
    });
    await waitForSession(options.sessionManager, session.id, REPAIR_TIMEOUT_MS, options.now);
    const test = await options.scripts.testRun(config.packageId, {
      timeoutMs: config.timeoutMs,
      target: 'working',
    });
    const saved = await options.scripts.finishRepair(config.packageId, {
      ok: test.ok,
      reason,
      rows: test.rows,
      sessionId: session.id,
      automationId: context.automationId,
    });
    started = false;
    if (!test.ok || !saved) return ` · AI 重新生成未通过试运行：${test.error ?? ''}`;
    return ` · 脚本已重新生成为 v${saved.version.version} 草稿（试运行 ${test.rows ?? 0} 行），待发布`;
  } catch (error) {
    if (started) {
      await options.scripts
        .finishRepair(config.packageId, { ok: false, reason })
        .catch(() => undefined);
    }
    return ` · AI 重新生成失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

export function buildRepairPrompt(
  name: string,
  packageId: string,
  dir: string,
  reason: string,
  timeoutMs: number
): string {
  return [
    `自动化里的脚本包「${name}」运行失败，请修复它。`,
    '',
    `脚本包目录（当前工作目录，已检出正在运行的已发布版本）：${dir}`,
    `失败原因：${reason}`,
    '',
    '要求：',
    '- 只修改这个目录里的文件；不要改动其他目录。',
    '- 保持 manifest.json 的约定：入口脚本必须把结果写到环境变量 SOPHRON_OUTPUT 指定的路径（CSV 带表头，或 manifest 声明的 JSON 对象数组），输出列保持不变。',
    '- 依赖写在 requirements.txt（Python）或 package.json（Node）。',
    `- 用 script_package_test（id="${packageId}"）试运行这个目录的当前代码：它会安装依赖、运行入口，并返回行数、输出预览和日志。需要时用 webfetch 查看接口/网页的实际返回。这是无人值守的后台任务，需要确认的操作会被直接拒绝。`,
    `- 试运行必须成功，且运行时间在 ${formatTimeout(timeoutMs)} 内。`,
    '- 不要提交 git、不要调用 script_package_save；结束后应用会把这个目录保存为「AI 修复」草稿版本。',
    '- 完成后用一两句话说明改了什么。草稿要等用户发布后自动化才会运行。',
  ].join('\n');
}

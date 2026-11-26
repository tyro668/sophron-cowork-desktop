import { RepairDraftError } from './script-packages/errors';
import { scriptRunMessage } from './script-run-messages';
import {
  type ScriptRepairStatus,
  SCRIPT_RUN_ACTION,
  DEFAULT_SCRIPT_TIMEOUT_MS,
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
import { type AutoRepairPolicy, type ScriptPackageService } from './script-packages/service';

const REPAIR_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_REPAIR_POLICY: AutoRepairPolicy = { cooldownMs: 30 * 60 * 1000, dailyCap: 5 };

export interface ScriptRunActionOptions {
  scripts: ScriptPackageService;
  locale?: string;
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
    defaultConfig: { packageId: '', timeoutMs: DEFAULT_SCRIPT_TIMEOUT_MS, onScriptError: 'notify' },
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
        throw new Error(scriptRunMessage('packageRequired', {}, options.locale));
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
        if (config.onScriptError === 'ai_repair') {
          await startRepair(options, config, reason, context, (outcome) =>
            options.store?.setRunScriptRepair(context.runId, node.id, {
              ...outcome,
              packageId: config.packageId,
            })
          );
        }
        throw new Error(`${name}: ${reason}`, { cause: error });
      }
      if (!options.commands) throw new Error(scriptRunMessage('unavailable', {}, options.locale));
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
          scriptRunMessage(
            'writeFailed',
            { name, reason: error instanceof Error ? error.message : String(error) },
            options.locale
          ),
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
      const rowCount = scriptRunMessage('rowCount', { name, rows: output.rows }, options.locale);
      if (output.warnings?.length) {
        // Passed with a fallback / suspicious shape: a yellow line in the run log, not a plain ✓.
        for (const warning of output.warnings)
          context.log({ level: 'warning', message: `${name}: ${warning}` });
        return `${rowCount} · ⚠ ${output.warnings.join('; ')}`;
      }
      return rowCount;
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

async function startRepair(
  options: ScriptRunActionOptions,
  config: ScriptRunConfig,
  reason: string,
  context: AutomationRunContext,
  record: (outcome: ScriptRepairStatus) => void
): Promise<void> {
  if (!options.generator) return record({ status: 'unavailable' });
  const repairs = options.repairs ?? backgroundRepairs;
  try {
    const summary = await options.scripts.summary(config.packageId);
    const pending = summary.draft;
    if (pending?.source === 'ai_repair') {
      return record(
        pending.rows != null
          ? { status: 'awaitingReview', version: pending.version, rows: pending.rows }
          : { status: 'awaitingFailedReview', version: pending.version, reason: '' }
      );
    }
    const baseVersion = summary.published?.version ?? summary.draft?.version;
    if (baseVersion == null) return record({ status: 'noVersion' });
    if (repairs.isRunning(config.packageId)) return record({ status: 'inProgress' });
    const bookedAt = options.now();
    const booked = await options.scripts.reserveAutoRepair(
      config.packageId,
      bookedAt,
      options.repairPolicy ?? DEFAULT_REPAIR_POLICY
    );
    if (!booked.ok) return record(booked.outcome);
    const generator = options.generator;
    const started = repairs.start(config.packageId, context.automationId, async (stop) => {
      const outcome = await repairOnce(
        options,
        generator,
        config,
        reason,
        baseVersion,
        context,
        stop,
        bookedAt
      );
      record(outcome);
    });
    if (!started) {
      await options.scripts.releaseAutoRepair(config.packageId, bookedAt);
      return record({ status: 'inProgress' });
    }
    record({ status: 'pending' });
  } catch (error) {
    return record({
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function repairOnce(
  options: ScriptRunActionOptions,
  generator: ScriptFilesGenerator,
  config: ScriptRunConfig,
  reason: string,
  baseVersion: number,
  context: AutomationRunContext,
  stop: AbortSignal,
  bookedAt: number
): Promise<ScriptRepairStatus> {
  const signal = AbortSignal.any([stop, AbortSignal.timeout(REPAIR_TIMEOUT_MS)]);
  try {
    const summary = await options.scripts.summary(config.packageId);
    const result = await options.scripts.generateDraft(
      {
        packageId: config.packageId,
        rulePrompt: `Automation run failed: ${reason}`.slice(0, 4000),
        baseVersion,
        runtime: summary.runtime,
        fix: {
          error: reason,
          note: `The scheduled run failed. Complete the trial within ${config.timeoutMs} ms.`,
        },
      },
      generator,
      { automationId: context.automationId, signal, checkTimeoutMs: config.timeoutMs }
    );
    const version = result.version.version;
    if (!result.check?.passed) {
      return { status: 'trialFailed', version, reason: result.check?.reason ?? '' };
    }
    return { status: 'ready', version, rows: result.check.rows ?? 0 };
  } catch (error) {
    if (stop.aborted) {
      // Stopped by the user (pause / disable / delete) or app quit: the model request was
      // aborted and nothing was saved, so it doesn't count toward the cooldown / daily cap.
      await options.scripts.releaseAutoRepair(config.packageId, bookedAt).catch(() => undefined);
      return { status: 'stopped' };
    }
    if (signal.aborted) return { status: 'timeout', minutes: REPAIR_TIMEOUT_MS / 60_000 };
    return error instanceof RepairDraftError
      ? { status: 'failed', reason: error.message, reasonKey: error.reasonKey }
      : { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

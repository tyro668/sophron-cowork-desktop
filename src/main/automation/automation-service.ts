import { automationRunScope } from './automation-run-scope';
import { cloudSyncSchema } from '../../shared/automation/cloud-sync';
import { z } from 'zod';
import type {
  Automation,
  AutomationActionDefinitionSummary,
  AutomationArtifact,
  AutomationCreateInput,
  AutomationListQuery,
  AutomationRun,
  AutomationRunQuery,
  AutomationUpdateInput,
} from '../../shared/automation/types';
import type { AutomationStore } from './automation-store';
import { computeNextAutomationRunAt, normalizeAutomationTrigger } from './automation-trigger';
import type { AutomationRunner } from './automation-runner';
import type { AutomationActionRegistry } from './automation-action-registry';

const outputBindingsSchema = z
  .array(
    z.object({
      outputTableId: z.string().trim().min(1),
      runOnChange: z.boolean(),
    })
  )
  .refine(
    (bindings) =>
      new Set(bindings.map((binding) => binding.outputTableId)).size === bindings.length,
    'An output table can only be linked once'
  );

export interface AutomationServiceOptions {
  store: AutomationStore;
  runner: AutomationRunner;
  registry: AutomationActionRegistry;
  now?: () => number;
}

export class AutomationService {
  private readonly store: AutomationStore;
  private readonly runner: AutomationRunner;
  private readonly registry: AutomationActionRegistry;
  private readonly now: () => number;

  constructor(options: AutomationServiceOptions) {
    this.store = options.store;
    this.runner = options.runner;
    this.registry = options.registry;
    this.now = options.now ?? (() => Date.now());
  }

  list(query?: AutomationListQuery): Automation[] {
    return this.store.list(query);
  }

  get(id: string): Automation | null {
    return this.store.get(id);
  }

  create(input: AutomationCreateInput): Automation {
    this.validateActionGraph(input.actionGraph);
    const outputBindings = outputBindingsSchema.parse(input.outputBindings ?? []);
    return this.store.create({
      ...input,
      outputBindings,
      trigger: normalizeAutomationTrigger(input.trigger),
    });
  }

  update(id: string, input: AutomationUpdateInput): Automation | null {
    const outputBindings =
      input.outputBindings === undefined
        ? undefined
        : outputBindingsSchema.parse(input.outputBindings);
    if (input.actionGraph) {
      this.validateActionGraph(input.actionGraph);
    } else if (input.enabled === true) {
      const current = this.store.get(id);
      if (current) this.validateActionGraph(current.actionGraph);
    }
    return this.store.update(id, { ...input, ...(outputBindings ? { outputBindings } : {}) });
  }

  delete(id: string): { success: boolean } {
    return { success: this.store.delete(id) };
  }

  setEnabled(id: string, enabled: boolean): Automation | null {
    const automation = this.store.get(id);
    if (!automation) return null;
    if (enabled) this.validateActionGraph(automation.actionGraph);
    const nextRunAt = enabled ? computeNextAutomationRunAt(automation.trigger, this.now()) : null;
    return this.store.setRuntimeState(id, {
      enabled,
      status: enabled ? 'enabled' : 'disabled',
      nextRunAt,
      lastError: enabled ? null : automation.lastError,
    });
  }

  pause(id: string): Automation | null {
    const automation = this.store.get(id);
    if (!automation) return null;
    if (!automation.enabled) return automation;
    return this.store.setRuntimeState(id, { status: 'paused' });
  }

  resume(id: string): Automation | null {
    const automation = this.store.get(id);
    if (!automation) return null;
    this.validateActionGraph(automation.actionGraph);
    if (!automation.enabled) {
      return this.setEnabled(id, true);
    }
    return this.store.setRuntimeState(id, {
      status: 'enabled',
      nextRunAt: computeNextAutomationRunAt(automation.trigger, this.now()),
    });
  }

  async runNow(id: string): Promise<AutomationRun | null> {
    const automation = this.store.get(id);
    if (!automation) return null;
    if (automation.lockedRunId) {
      if (automation.concurrencyPolicy.overlapPolicy === 'queue_once') {
        return this.store.createRun({
          automationId: automation.id,
          status: 'queued',
          triggerReason: 'queued_overlap',
          queuedAt: this.now(),
        });
      }
      throw new Error('Automation is already running');
    }
    return this.runner.run(automation, 'manual');
  }

  async runTriggered(
    id: string,
    reason: 'timer' | 'file_change' | 'output_change'
  ): Promise<AutomationRun | null> {
    const automation = this.store.get(id);
    if (!automation || !automation.enabled || automation.status === 'paused') return null;
    if (automation.lockedRunId) {
      if (automation.concurrencyPolicy.overlapPolicy === 'queue_once') {
        if (reason === 'output_change') return this.runner.queueOnce(automation, reason);
        return this.store.createRun({
          automationId: automation.id,
          status: 'queued',
          triggerReason: 'queued_overlap',
          queuedAt: this.now(),
        });
      }
      return null;
    }
    return this.runner.run(automation, reason);
  }

  async runForOutputTables(outputTableIds: string[]): Promise<void> {
    const committed = new Set(outputTableIds);
    const ancestors = automationRunScope.getStore() ?? [];
    for (const automation of this.store.list({ status: 'all' })) {
      if (
        !automation.outputBindings?.some(
          (binding) => binding.runOnChange && committed.has(binding.outputTableId)
        )
      )
        continue;
      // Skip causal cycles and coalesce commits already waiting in the queue.
      // Independent overlapping changes still honor the automation's policy.
      if (this.runner.hasQueuedRun(automation.id) || ancestors.includes(automation.id)) continue;
      void this.runTriggered(automation.id, 'output_change').catch((error) => {
        console.warn('[Automation] Output trigger failed:', automation.id, error);
      });
    }
  }

  listRuns(id: string, query?: AutomationRunQuery): AutomationRun[] {
    return this.store.listRuns(id, query);
  }

  listArtifacts(runId: string): AutomationArtifact[] {
    return this.store.listArtifacts(runId);
  }

  listActionDefinitions(): AutomationActionDefinitionSummary[] {
    return this.registry.list();
  }

  async runDueAutomations(): Promise<void> {
    const now = this.now();
    for (const automation of this.store.listRunnable(now)) {
      if (automation.lockedRunId) {
        if (automation.concurrencyPolicy.overlapPolicy === 'queue_once') {
          this.store.createRun({
            automationId: automation.id,
            status: 'queued',
            triggerReason: 'queued_overlap',
            queuedAt: now,
          });
        }
        continue;
      }
      const nextRunAt = computeNextAutomationRunAt(automation.trigger, now);
      if (nextRunAt === null && automation.trigger.kind === 'once') {
        this.store.setRuntimeState(automation.id, {
          enabled: false,
          status: 'disabled',
          nextRunAt: null,
        });
      } else {
        this.store.setRuntimeState(automation.id, { nextRunAt });
      }
      void this.runner.run(automation, 'timer');
    }
  }

  private validateActionGraph(graph: AutomationCreateInput['actionGraph']): void {
    if (!Array.isArray(graph.nodes)) {
      throw new Error('Automation action graph requires nodes');
    }
    for (const node of graph.nodes) {
      if (
        node.enabled !== false &&
        node.type === 'cloud.table.process' &&
        (node.config.output as { location?: string } | undefined)?.location !== 'local'
      )
        throw new Error('schedule.cloudSync.useOutputAction');
      if (node.enabled !== false && node.type === 'cloud.sync') {
        try {
          cloudSyncSchema.parse(node.config);
        } catch {
          throw new Error(
            node.config?.type === 'cloud_table'
              ? 'schedule.cloudSync.legacyTarget'
              : 'schedule.cloudSync.invalid'
          );
        }
      }
      if (!this.registry.get(node.type)) {
        throw new Error(`Automation action is not registered: ${node.type}`);
      }
    }
  }
}

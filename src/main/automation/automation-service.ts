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
    return this.store.create({
      ...input,
      trigger: normalizeAutomationTrigger(input.trigger),
    });
  }

  update(id: string, input: AutomationUpdateInput): Automation | null {
    if (input.actionGraph) {
      this.validateActionGraph(input.actionGraph);
    }
    return this.store.update(id, input);
  }

  delete(id: string): { success: boolean } {
    return { success: this.store.delete(id) };
  }

  setEnabled(id: string, enabled: boolean): Automation | null {
    const automation = this.store.get(id);
    if (!automation) return null;
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

  async runTriggered(id: string, reason: 'timer' | 'file_change'): Promise<AutomationRun | null> {
    const automation = this.store.get(id);
    if (!automation || !automation.enabled || automation.status === 'paused') return null;
    if (automation.lockedRunId) {
      if (automation.concurrencyPolicy.overlapPolicy === 'queue_once') {
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
      if (!this.registry.get(node.type)) {
        throw new Error(`Automation action is not registered: ${node.type}`);
      }
    }
  }
}

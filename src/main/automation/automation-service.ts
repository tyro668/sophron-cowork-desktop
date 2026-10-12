import {
  automationTableBindingsSchema,
  automationTableRefSchema,
  automationTablePolicyPatchSchema,
  getAutomationTableBindings,
  tableBindingKey,
} from '../../shared/automation/table-bindings';
import { automationRunScope, automationTableChangeScope } from './automation-run-scope';
import { cloudSyncSchema } from '../../shared/automation/cloud-sync';
import { z } from 'zod';
import type {
  Automation,
  AutomationTableRef,
  AutomationTablePolicy,
  AutomationTableTriggerContext,
  AutomationActionDefinitionSummary,
  AutomationArtifact,
  AutomationAssignGroupInput,
  AutomationCreateGroupInput,
  AutomationCreateInput,
  AutomationGroup,
  AutomationListQuery,
  AutomationListResult,
  AutomationRenameGroupInput,
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
      resultTableId: z.string().trim().min(1),
      runOnChange: z.boolean(),
      runOnTrigger: z.boolean().optional(),
    })
  )
  .refine(
    (bindings) =>
      new Set(bindings.map((binding) => binding.resultTableId)).size === bindings.length,
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

  getTablePolicy(table: AutomationTableRef): AutomationTablePolicy {
    return this.store.getTablePolicy(automationTableRefSchema.parse(table));
  }

  setTablePolicy(
    table: AutomationTableRef,
    patch: Partial<AutomationTablePolicy>
  ): AutomationTablePolicy {
    return this.store.setTablePolicy(
      automationTableRefSchema.parse(table),
      automationTablePolicyPatchSchema.parse(patch)
    );
  }

  replaceTableAssociation(table: AutomationTableRef, previousId: string, nextId: string): void {
    const ref = automationTableRefSchema.parse(table);
    const previous = this.store.get(previousId);
    const next = this.store.get(nextId);
    if (!previous || !next) throw new Error('Automation no longer exists');
    if (previousId === nextId) return;
    const matches = (binding: AutomationTableRef) =>
      tableBindingKey(binding) === tableBindingKey(ref);
    if (!getAutomationTableBindings(previous).some(matches))
      throw new Error('Association no longer exists');
    if (getAutomationTableBindings(next).some(matches))
      throw new Error('Automation is already linked');
    if (previous.lockedRunId || next.lockedRunId)
      throw new Error('Cannot replace a running automation association');
    const removed = new Set(
      previous.actionGraph.nodes
        .filter(
          (node) =>
            node.type === 'cloud.sync' &&
            node.config.direction === (ref.kind === 'raw' ? 'input' : 'output') &&
            node.config[ref.kind === 'raw' ? 'rawTableId' : 'resultTableId'] === ref.tableId
        )
        .map((node) => node.id)
    );
    // Bypass removed sync nodes, preserving branches and unrelated actions.
    let edges = [...previous.actionGraph.edges];
    for (const id of removed) {
      const incoming = edges.filter((edge) => edge.targetNodeId === id);
      const outgoing = edges.filter((edge) => edge.sourceNodeId === id);
      edges = edges.filter((edge) => edge.sourceNodeId !== id && edge.targetNodeId !== id);
      for (const source of incoming)
        for (const target of outgoing) {
          if (
            !edges.some(
              (edge) =>
                edge.sourceNodeId === source.sourceNodeId &&
                edge.targetNodeId === target.targetNodeId
            )
          ) {
            edges.push({
              id: `relink:${source.sourceNodeId}:${target.targetNodeId}`,
              sourceNodeId: source.sourceNodeId,
              targetNodeId: target.targetNodeId,
            });
          }
        }
    }
    const actionGraph = {
      ...previous.actionGraph,
      nodes: previous.actionGraph.nodes.filter((node) => !removed.has(node.id)),
      edges,
    };
    this.validateActionGraph(actionGraph);
    this.store.updateTogether([
      {
        id: previousId,
        updates: {
          tableBindings: getAutomationTableBindings(previous).filter(
            (binding) => !matches(binding)
          ),
          outputBindings: previous.outputBindings?.filter(
            (binding) => ref.kind !== 'result' || binding.resultTableId !== ref.tableId
          ),
          actionGraph,
        },
      },
      {
        id: nextId,
        updates: {
          tableBindings: [
            ...getAutomationTableBindings(next),
            { ...ref, ...this.store.getTablePolicy(ref) },
          ],
        },
      },
    ]);
  }

  list(query?: AutomationListQuery): AutomationListResult {
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
      ...(input.tableBindings === undefined
        ? {}
        : { tableBindings: automationTableBindingsSchema.parse(input.tableBindings) }),
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
    let tableBindings =
      input.tableBindings === undefined
        ? undefined
        : automationTableBindingsSchema.parse(input.tableBindings);
    // Once converted, the canonical list remains authoritative. Adding a new
    // sync action creates a default link without resurrecting removed links.
    if (input.actionGraph) {
      const current = this.store.get(id);
      if (current && (tableBindings ?? current.tableBindings) !== undefined) {
        const base = tableBindings ?? current.tableBindings!;
        const before = new Set(
          getAutomationTableBindings({ actionGraph: current.actionGraph }).map(tableBindingKey)
        );
        const added = getAutomationTableBindings({ actionGraph: input.actionGraph }).filter(
          (binding) =>
            !before.has(tableBindingKey(binding)) &&
            !base.some((b) => tableBindingKey(b) === tableBindingKey(binding))
        );
        tableBindings = [...base, ...added];
      }
    }
    return this.store.update(id, {
      ...input,
      ...(outputBindings ? { outputBindings } : {}),
      ...(tableBindings === undefined ? {} : { tableBindings }),
    });
  }

  delete(id: string): { success: boolean } {
    return { success: this.store.delete(id) };
  }

  listGroups(): AutomationGroup[] {
    return this.store.listGroups();
  }

  createGroup(input: AutomationCreateGroupInput): AutomationGroup {
    return this.store.createGroup(input);
  }

  renameGroup(input: AutomationRenameGroupInput): { success: boolean } {
    return { success: this.store.renameGroup(input) };
  }

  deleteGroup(id: string): { success: boolean } {
    return { success: this.store.deleteGroup(id) };
  }

  assignGroup(input: AutomationAssignGroupInput): { success: boolean } {
    this.store.assignToGroup(input);
    return { success: true };
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
    reason: 'timer' | 'file_change' | 'output_change',
    context?: AutomationTableTriggerContext
  ): Promise<AutomationRun | null> {
    const automation = this.store.get(id);
    if (!automation || !automation.enabled || automation.status === 'paused') return null;
    if (reason === 'output_change' && this.runner.hasQueuedRun(automation.id)) {
      return this.runner.queueOnce(automation, reason, context);
    }
    if (automation.lockedRunId) {
      if (automation.concurrencyPolicy.overlapPolicy === 'queue_once') {
        if (reason === 'output_change') return this.runner.queueOnce(automation, reason, context);
        return this.store.createRun({
          automationId: automation.id,
          status: 'queued',
          triggerReason: 'queued_overlap',
          queuedAt: this.now(),
        });
      }
      return null;
    }
    return this.runner.run(automation, reason, context);
  }

  async runForResultTables(resultTableIds: string[]): Promise<void> {
    return this.runForTables('result', resultTableIds);
  }

  async runForRawTables(rawTableIds: string[]): Promise<void> {
    return this.runForTables('raw', rawTableIds);
  }

  private async runForTables(kind: 'raw' | 'result', tableIds: string[]): Promise<void> {
    const committed = new Set(tableIds);
    const activeChanges = automationTableChangeScope.getStore();
    if (activeChanges) {
      const all = new Map(activeChanges.tables.map((table) => [tableBindingKey(table), table]));
      for (const tableId of committed)
        all.set(tableBindingKey({ kind, tableId }), { kind, tableId });
      activeChanges.tables = [...all.values()];
    }
    const ancestors = automationRunScope.getStore() ?? [];
    for (const automation of this.store.list({ status: 'all' }).automations) {
      if (ancestors.includes(automation.id)) continue;
      const tables = getAutomationTableBindings(automation).filter(
        (binding) => binding.kind === kind && binding.runOnChange && committed.has(binding.tableId)
      );
      if (!tables.length) continue;
      void this.runTriggered(automation.id, 'output_change', { tables }).catch((error) => {
        console.warn('[Automation] Table change dispatch failed:', automation.id, error);
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

import type {
  Automation,
  AutomationActionNode,
  AutomationArtifact,
  AutomationRun,
  AutomationTriggerReason,
} from '../../shared/automation/types';
import type { AutomationStore } from './automation-store';
import { AutomationActionRegistry, type AutomationRunLogEvent } from './automation-action-registry';

export interface AutomationRunnerOptions {
  store: AutomationStore;
  registry: AutomationActionRegistry;
  maxConcurrentRuns?: number;
  now?: () => number;
  deliver?: (
    automation: Automation,
    run: AutomationRun,
    artifacts: AutomationArtifact[]
  ) => Promise<AutomationRun['deliveryStatus']>;
  notifyRunFinished?: (automation: Automation, run: AutomationRun) => void;
}

export class AutomationRunner {
  private readonly store: AutomationStore;
  private readonly registry: AutomationActionRegistry;
  private readonly maxConcurrentRuns: number;
  private readonly now: () => number;
  private readonly deliver?: AutomationRunnerOptions['deliver'];
  private readonly notifyRunFinished?: AutomationRunnerOptions['notifyRunFinished'];
  private runningCount = 0;
  private readonly queued: Array<{
    automation: Automation;
    reason: AutomationTriggerReason;
    runId: string;
  }> = [];

  constructor(options: AutomationRunnerOptions) {
    this.store = options.store;
    this.registry = options.registry;
    this.maxConcurrentRuns = options.maxConcurrentRuns ?? 4;
    this.now = options.now ?? (() => Date.now());
    this.deliver = options.deliver;
    this.notifyRunFinished = options.notifyRunFinished;
  }

  async run(automation: Automation, reason: AutomationTriggerReason): Promise<AutomationRun> {
    if (this.runningCount >= this.maxConcurrentRuns) {
      const queuedRun = this.store.createRun({
        automationId: automation.id,
        status: 'queued',
        triggerReason: reason,
        queuedAt: this.now(),
      });
      this.queued.push({ automation, reason, runId: queuedRun.id });
      return queuedRun;
    }
    return this.execute(automation, reason);
  }

  private async execute(
    automation: Automation,
    reason: AutomationTriggerReason,
    existingRunId?: string
  ): Promise<AutomationRun> {
    this.runningCount += 1;
    const startedAt = this.now();
    // When draining a queued entry, advance its existing run record to `running`
    // instead of orphaning it as a stale `queued` row (which recovery would later
    // mark `cancelled`). Fall back to a fresh run if the record went missing.
    let run =
      (existingRunId
        ? this.store.updateRun(existingRunId, { status: 'running', startedAt })
        : null) ??
      this.store.createRun({
        automationId: automation.id,
        status: 'running',
        triggerReason: reason,
        startedAt,
      });
    this.store.setRuntimeState(automation.id, {
      status: 'running',
      lockedRunId: run.id,
      lastError: null,
    });
    const emittedArtifacts: AutomationArtifact[] = [];
    const logs: AutomationRunLogEvent[] = [];
    const outputs = new Map<string, unknown>();

    try {
      for (const node of topoSortNodes(
        automation.actionGraph.nodes,
        automation.actionGraph.edges
      )) {
        if (node.enabled === false) continue;
        const definition = this.registry.get(node.type);
        if (!definition) {
          throw new Error(`Automation action is not registered: ${node.type}`);
        }
        await definition.validate?.(node.config);
        const result = await definition.execute(
          node.config,
          {
            automationId: automation.id,
            runId: run.id,
            projectId: automation.projectId,
            now: this.now(),
            outputs,
            emitArtifact: (artifact) => {
              const created = this.store.createArtifact({
                runId: run.id,
                sourceNodeId: artifact.sourceNodeId ?? node.id,
                kind: artifact.kind,
                title: artifact.title,
                summary: artifact.summary,
                mimeType: artifact.mimeType,
                content: artifact.content,
                filePath: artifact.filePath,
                href: artifact.href,
                dataRef: artifact.dataRef,
              });
              emittedArtifacts.push(created);
            },
            log: (event) => logs.push({ ...event, nodeId: event.nodeId ?? node.id }),
          },
          node
        );
        outputs.set(node.id, result);
      }

      const deliveryStatus = automation.delivery?.enabled
        ? await this.deliver?.(automation, run, emittedArtifacts)
        : 'skipped';
      const finishedAt = this.now();
      run =
        this.store.updateRun(run.id, {
          status: 'succeeded',
          finishedAt,
          durationMs: finishedAt - startedAt,
          artifactCount: emittedArtifacts.length,
          deliveryStatus: deliveryStatus ?? 'skipped',
          createdSessionId: findSessionArtifactId(emittedArtifacts),
        }) ?? run;
      this.store.setRuntimeState(automation.id, {
        status: automation.enabled ? 'enabled' : 'disabled',
        lockedRunId: null,
        lastRunAt: finishedAt,
        lastRunStatus: 'succeeded',
        lastError: null,
      });
      this.notifyRunFinished?.(automation, run);
      return run;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finishedAt = this.now();
      const deliveryStatus =
        automation.delivery?.enabled && automation.failurePolicy.notifyOnFailure
          ? await this.deliver?.(automation, run, emittedArtifacts)
          : 'skipped';
      run =
        this.store.updateRun(run.id, {
          status: 'failed',
          finishedAt,
          durationMs: finishedAt - startedAt,
          error: message,
          artifactCount: emittedArtifacts.length,
          deliveryStatus: deliveryStatus ?? 'skipped',
        }) ?? run;
      this.store.setRuntimeState(automation.id, {
        status: automation.failurePolicy.disableOnFailure ? 'disabled' : 'failed',
        enabled: automation.failurePolicy.disableOnFailure ? false : automation.enabled,
        lockedRunId: null,
        lastRunAt: finishedAt,
        lastRunStatus: 'failed',
        lastError: message,
      });
      this.notifyRunFinished?.(automation, run);
      return run;
    } finally {
      this.runningCount = Math.max(0, this.runningCount - 1);
      void this.drainQueue();
    }
  }

  private async drainQueue(): Promise<void> {
    while (this.runningCount < this.maxConcurrentRuns && this.queued.length > 0) {
      const next = this.queued.shift();
      if (!next) return;
      await this.execute(next.automation, next.reason, next.runId);
    }
  }
}

function topoSortNodes(
  nodes: AutomationActionNode[],
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>
): AutomationActionNode[] {
  if (nodes.length <= 1 || edges.length === 0) return nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.sourceNodeId) || !byId.has(edge.targetNodeId)) continue;
    incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) ?? 0) + 1);
    outgoing.set(edge.sourceNodeId, [
      ...(outgoing.get(edge.sourceNodeId) ?? []),
      edge.targetNodeId,
    ]);
  }
  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  const sorted: AutomationActionNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) continue;
    sorted.push(node);
    for (const target of outgoing.get(node.id) ?? []) {
      const nextIncoming = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, nextIncoming);
      if (nextIncoming === 0) {
        const targetNode = byId.get(target);
        if (targetNode) queue.push(targetNode);
      }
    }
  }
  return sorted.length === nodes.length ? sorted : nodes;
}

function findSessionArtifactId(artifacts: AutomationArtifact[]): string | null {
  return artifacts.find((artifact) => artifact.kind === 'session')?.dataRef?.id ?? null;
}

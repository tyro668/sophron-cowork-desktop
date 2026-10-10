import { randomUUID } from 'crypto';
import type { DataPipelineStore } from '../../data/data-pipeline-store';
import { createDataResourceHref } from '../../../shared/data-resource-link';
import type { Automation, AutomationActionNode } from '../../../shared/automation/types';
import type { AutomationService } from '../automation-service';
import { computeNextAutomationRunAt, normalizeAutomationTrigger } from '../automation-trigger';
import {
  compileAutomationSchedule,
  formatAutomationTrigger,
  formatTimestamp,
} from './schedule-compiler';
import {
  AutomationDraftReceiptStore,
  type AutomationDraftReceipt,
  type AutomationScheduleUpdateDraftReceipt,
} from './draft-receipt-store';
import type {
  AutomationCreateToolInput,
  AutomationListToolInput,
  AutomationPrepareScheduleUpdateToolInput,
  AutomationPrepareToolInput,
  AutomationSetEnabledToolInput,
  AutomationToolActionInput,
  AutomationToolExecutionContext,
  AutomationToolListItem,
  AutomationToolResult,
  AutomationUpdateScheduleToolInput,
  PreparedAutomationDependency,
} from './contract';
import { TOOL_RESULT_GUIDANCE } from '../../prompts/tool-copy';

interface AutomationToolServiceOptions {
  automationService: AutomationService;
  dataPipelineStore: DataPipelineStore;
  receiptStore?: AutomationDraftReceiptStore;
  now?: () => number;
  systemTimezone?: () => string;
  projectExists?: (projectId: string) => boolean;
  onAutomationsChanged?: () => void;
}

export class AutomationToolService {
  private readonly automationService: AutomationService;
  private readonly dataPipelineStore: DataPipelineStore;
  private readonly receiptStore: AutomationDraftReceiptStore;
  private readonly now: () => number;
  private readonly systemTimezone: () => string;
  private readonly projectExists?: (projectId: string) => boolean;
  private readonly onAutomationsChanged?: () => void;

  constructor(options: AutomationToolServiceOptions) {
    this.automationService = options.automationService;
    this.dataPipelineStore = options.dataPipelineStore;
    this.receiptStore = options.receiptStore ?? new AutomationDraftReceiptStore();
    this.now = options.now ?? (() => Date.now());
    this.systemTimezone =
      options.systemTimezone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    this.projectExists = options.projectExists;
    this.onAutomationsChanged = options.onAutomationsChanged;
  }

  list(input: AutomationListToolInput = {}): AutomationToolResult {
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 20)));
    const matches = this.automationService.list({
      query: input.query,
      status: input.status ?? 'all',
    });
    const automations = matches.automations
      .slice(offset, offset + limit)
      .map((automation) => this.toListItem(automation));
    const lines = automations.map(
      (automation) =>
        `- ${automation.name} (${automation.id}) status=${automation.status} action=${automation.actionKind} schedule=${automation.scheduleSummary} nextRun=${automation.nextRunAtText ?? 'none'}`
    );
    return toolResult(
      lines.length
        ? `Found ${automations.length} of ${matches.automations.length} automation(s):\n${lines.join('\n')}`
        : 'No automations found.',
      { total: matches.automations.length, automations }
    );
  }

  setEnabled(input: AutomationSetEnabledToolInput): AutomationToolResult {
    if (input.confirmed !== true) {
      throw new Error('Explicit confirmation is required to enable or disable an automation.');
    }

    const automationId = input.automationId.trim();
    const current = this.automationService.get(automationId);
    if (!current) throw new Error(`Automation not found: ${automationId}`);

    const alreadyInRequestedState = input.enabled
      ? current.enabled && (current.status === 'enabled' || current.status === 'running')
      : !current.enabled && current.status === 'disabled';
    if (alreadyInRequestedState) {
      return this.formatEnabledResult(current, 'unchanged');
    }

    const updated = this.automationService.setEnabled(automationId, input.enabled);
    if (!updated) throw new Error(`Automation not found: ${automationId}`);

    this.onAutomationsChanged?.();
    return this.formatEnabledResult(updated, 'updated', current.status === 'running');
  }

  async prepare(
    input: AutomationPrepareToolInput,
    context: AutomationToolExecutionContext
  ): Promise<AutomationToolResult> {
    const name = input.name.trim();
    if (!name) throw new Error('Automation name is required.');
    if (name.length > 200) throw new Error('Automation name must not exceed 200 characters.');
    const description = input.description?.trim() || null;
    if (description && description.length > 2_000) {
      throw new Error('Automation description must not exceed 2000 characters.');
    }

    const compiledSchedule = compileAutomationSchedule(input.schedule, {
      now: this.now(),
      systemTimezone: this.systemTimezone(),
      nextRunCount: 3,
    });
    const preparedAction = await this.prepareAction(input.action);
    const createInput = {
      name,
      description,
      projectId: preparedAction.projectId,
      enabled: input.enabled !== false,
      trigger: compiledSchedule.trigger,
      actionGraph: {
        version: 1 as const,
        nodes: [preparedAction.node],
        edges: [],
      },
    };
    const summary = {
      name,
      actionKind: input.action.kind,
      actionText: preparedAction.actionText,
      scheduleText: compiledSchedule.summary,
      timezone: compiledSchedule.timezone,
      nextRuns: compiledSchedule.nextRuns,
    };
    const receipt = this.receiptStore.create({
      sessionId: context.sessionId,
      sourceUserMessageId: context.currentUserMessageId,
      input: { ...input, name, description: description ?? undefined },
      createInput,
      summary,
      dependency: preparedAction.dependency,
    });
    return toolResult(
      [
        `Automation draft is ready: ${name}`,
        `Action: ${summary.actionText}`,
        `Schedule: ${summary.scheduleText}`,
        `Next runs: ${summary.nextRuns.map((run) => run.text).join('; ')}`,
        `Draft id: ${receipt.id}`,
        TOOL_RESULT_GUIDANCE.automationPrepared,
      ].join('\n'),
      {
        status: 'ready',
        draftId: receipt.id,
        expiresAt: receipt.expiresAt,
        summary,
        warnings: [],
        errors: [],
      }
    );
  }

  async create(
    input: AutomationCreateToolInput,
    context: AutomationToolExecutionContext
  ): Promise<AutomationToolResult> {
    if (input.confirmed !== true) {
      throw new Error('Explicit confirmation is required to create an automation.');
    }
    const receipt = this.receiptStore.get(input.draftId);
    if (!receipt) {
      throw new Error('Automation draft was not found or has expired. Prepare it again.');
    }
    if (receipt.sessionId !== context.sessionId) {
      throw new Error('Automation draft belongs to another conversation.');
    }
    if (receipt.createdAutomationId) {
      const existing = this.automationService.get(receipt.createdAutomationId);
      if (existing) return this.formatCreatedResult(existing, receipt, 'already_created');
    }

    await this.revalidateDependency(receipt.dependency);
    if (computeNextAutomationRunAt(receipt.createInput.trigger, this.now()) === null) {
      throw new Error(
        'Automation schedule no longer has a future execution time. Prepare it again.'
      );
    }
    const created = this.automationService.create(receipt.createInput);
    this.receiptStore.markCreated(receipt.id, created.id);
    this.onAutomationsChanged?.();
    return this.formatCreatedResult(created, receipt, 'created');
  }

  prepareScheduleUpdate(
    input: AutomationPrepareScheduleUpdateToolInput,
    context: AutomationToolExecutionContext
  ): AutomationToolResult {
    const automationId = input.automationId.trim();
    const automation = this.automationService.get(automationId);
    if (!automation) throw new Error(`Automation not found: ${automationId}`);

    const compiledSchedule = compileAutomationSchedule(input.schedule, {
      now: this.now(),
      systemTimezone: this.systemTimezone(),
      nextRunCount: 3,
    });
    const summary = {
      automationId: automation.id,
      name: automation.name,
      previousScheduleText: formatAutomationTrigger(automation.trigger),
      scheduleText: compiledSchedule.summary,
      timezone: compiledSchedule.timezone,
      nextRuns: compiledSchedule.nextRuns,
      enabled: automation.enabled,
      status: automation.status,
    };
    const receipt = this.receiptStore.createScheduleUpdate({
      sessionId: context.sessionId,
      sourceUserMessageId: context.currentUserMessageId,
      input: { ...input, automationId },
      automationId,
      expectedTrigger: automation.trigger,
      trigger: compiledSchedule.trigger,
      summary,
    });
    const warnings = buildScheduleUpdateWarnings(automation, compiledSchedule.trigger);
    return toolResult(
      [
        `Automation schedule update draft is ready: ${automation.name} (${automation.id})`,
        `Previous schedule: ${summary.previousScheduleText}`,
        `New schedule: ${summary.scheduleText}`,
        `Next runs: ${summary.nextRuns.map((run) => run.text).join('; ')}`,
        ...warnings.map((warning) => `Warning: ${warning}`),
        `Draft id: ${receipt.id}`,
        TOOL_RESULT_GUIDANCE.automationScheduleUpdatePrepared,
      ].join('\n'),
      {
        status: 'ready',
        draftId: receipt.id,
        expiresAt: receipt.expiresAt,
        summary,
        warnings,
        errors: [],
      }
    );
  }

  updateSchedule(
    input: AutomationUpdateScheduleToolInput,
    context: AutomationToolExecutionContext
  ): AutomationToolResult {
    if (input.confirmed !== true) {
      throw new Error('Explicit confirmation is required to update an automation schedule.');
    }
    const receipt = this.receiptStore.getScheduleUpdate(input.draftId);
    if (!receipt) {
      throw new Error(
        'Automation schedule update draft was not found or has expired. Prepare it again.'
      );
    }
    if (receipt.sessionId !== context.sessionId) {
      throw new Error('Automation schedule update draft belongs to another conversation.');
    }
    if (receipt.updatedAutomation) {
      return this.formatScheduleUpdatedResult(
        receipt.updatedAutomation,
        receipt,
        'already_updated'
      );
    }

    const current = this.automationService.get(receipt.automationId);
    if (!current) throw new Error(`Automation not found: ${receipt.automationId}`);

    const currentTriggerFingerprint = automationTriggerFingerprint(current.trigger);
    const expectedTriggerFingerprint = automationTriggerFingerprint(receipt.expectedTrigger);
    const nextTriggerFingerprint = automationTriggerFingerprint(receipt.trigger);
    if (currentTriggerFingerprint === nextTriggerFingerprint) {
      this.receiptStore.markScheduleUpdated(receipt.id, current);
      return this.formatScheduleUpdatedResult(current, receipt, 'unchanged');
    }
    if (currentTriggerFingerprint !== expectedTriggerFingerprint) {
      throw new Error(
        'Automation schedule changed after this draft was prepared. Review the latest schedule and prepare the update again.'
      );
    }
    if (computeNextAutomationRunAt(receipt.trigger, this.now()) === null) {
      throw new Error(
        'Automation schedule no longer has a future execution time. Prepare the update again.'
      );
    }

    const updated = this.automationService.update(receipt.automationId, {
      trigger: receipt.trigger,
    });
    if (!updated) throw new Error(`Automation not found: ${receipt.automationId}`);
    this.receiptStore.markScheduleUpdated(receipt.id, updated);
    this.onAutomationsChanged?.();
    return this.formatScheduleUpdatedResult(updated, receipt, 'updated');
  }

  pendingDraftKinds(sessionId: string): Array<'create' | 'update'> {
    return this.receiptStore.pendingKindsForSession(sessionId);
  }

  hasPendingDrafts(sessionId: string): boolean {
    return this.receiptStore.hasPendingForSession(sessionId);
  }

  clearConversationContext(sessionId: string): void {
    this.receiptStore.deleteForSession(sessionId);
  }

  private async prepareAction(input: AutomationToolActionInput): Promise<{
    node: AutomationActionNode;
    projectId: string | null;
    actionText: string;
    dependency: PreparedAutomationDependency;
  }> {
    if (input.kind === 'data_pipeline') {
      const pipelineId = input.pipelineId.trim();
      if (!pipelineId) throw new Error('Data pipeline id is required.');
      const pipeline = await this.requireRunnableDataPipeline(pipelineId);
      return {
        node: {
          id: randomUUID(),
          type: 'data.pipeline.run',
          label: pipeline.name,
          enabled: true,
          config: { pipelineId: pipeline.id, outputMode: 'persisted' },
        },
        projectId: null,
        actionText: `正式执行数据加工 ${pipeline.name} (${pipeline.id})`,
        dependency: { kind: 'data_pipeline', pipelineId: pipeline.id, pipelineName: pipeline.name },
      };
    }

    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('Conversation task prompt is required.');
    if (prompt.length > 20_000) {
      throw new Error('Conversation task prompt must not exceed 20000 characters.');
    }
    const projectId = input.projectId?.trim() || null;
    if (projectId && this.projectExists && !this.projectExists(projectId)) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const selectedSkillNames = Array.from(
      new Set(
        (input.selectedSkillNames ?? [])
          .map((name) => (typeof name === 'string' ? name.trim() : ''))
          .filter(Boolean)
      )
    ).slice(0, 50);
    return {
      node: {
        id: randomUUID(),
        type: 'conversation.run',
        label: prompt.slice(0, 80),
        enabled: true,
        config: {
          prompt,
          selectedSkillNames,
          projectId,
          modelConfigSetId: null,
          model: null,
          completionMode: 'wait',
          timeoutMs: 30 * 60 * 1000,
          collectArtifacts: true,
          permissionPolicy: 'auto_review',
        },
      },
      projectId,
      actionText: `启动任务对话：${prompt.slice(0, 160)}`,
      dependency: { kind: 'conversation', projectId },
    };
  }

  private async requireRunnableDataPipeline(pipelineId: string) {
    const pipeline = await this.dataPipelineStore.getPipelineRecord(pipelineId);
    if (!pipeline) throw new Error(`Data pipeline not found: ${pipelineId}`);
    const workflow = await this.dataPipelineStore.getPipelineWorkflow(pipelineId);
    if (pipeline.nodeCount <= 0 || workflow.nodes.length === 0) {
      throw new Error(`Data pipeline has no runnable workflow: ${pipeline.name} (${pipeline.id})`);
    }
    return pipeline;
  }

  private async revalidateDependency(dependency: PreparedAutomationDependency): Promise<void> {
    if (dependency.kind === 'data_pipeline') {
      await this.requireRunnableDataPipeline(dependency.pipelineId);
      return;
    }
    if (dependency.projectId && this.projectExists && !this.projectExists(dependency.projectId)) {
      throw new Error(`Project no longer exists: ${dependency.projectId}`);
    }
  }

  private formatCreatedResult(
    automation: Automation,
    receipt: AutomationDraftReceipt,
    status: 'created' | 'already_created'
  ): AutomationToolResult {
    const nextRunAtText =
      automation.nextRunAt === null
        ? null
        : formatTimestamp(automation.nextRunAt, automation.trigger.timezone);
    const dataPipelineLink =
      receipt.dependency.kind === 'data_pipeline'
        ? `[${receipt.dependency.pipelineName}](${createDataResourceHref('pipeline', receipt.dependency.pipelineId)})`
        : null;
    return toolResult(
      [
        status === 'created'
          ? `Created automation: ${automation.name} (${automation.id})`
          : `Automation was already created: ${automation.name} (${automation.id})`,
        dataPipelineLink
          ? `Data pipeline: ${dataPipelineLink}`
          : `Action: ${receipt.summary.actionText}`,
        `Schedule: ${receipt.summary.scheduleText}`,
        `Next run: ${nextRunAtText ?? 'none'}`,
        'The automation is available on the Automation page.',
      ].join('\n'),
      {
        status,
        automation: {
          id: automation.id,
          name: automation.name,
          enabled: automation.enabled,
          status: automation.status,
          actionKind: receipt.summary.actionKind,
          nextRunAt: automation.nextRunAt,
          nextRunAtText,
          timezone: automation.trigger.timezone,
        },
      }
    );
  }

  private formatScheduleUpdatedResult(
    automation: Automation,
    receipt: AutomationScheduleUpdateDraftReceipt,
    status: 'updated' | 'already_updated' | 'unchanged'
  ): AutomationToolResult {
    const nextRunAtText =
      automation.nextRunAt === null
        ? null
        : formatTimestamp(automation.nextRunAt, automation.trigger.timezone);
    const headline =
      status === 'updated'
        ? `Updated automation schedule: ${automation.name} (${automation.id})`
        : status === 'already_updated'
          ? `Automation schedule was already updated: ${automation.name} (${automation.id})`
          : `Automation already uses this schedule: ${automation.name} (${automation.id})`;
    const stateNote = !automation.enabled
      ? 'The automation remains disabled.'
      : automation.status === 'paused'
        ? 'The automation remains paused.'
        : null;
    return toolResult(
      [
        headline,
        `Previous schedule: ${receipt.summary.previousScheduleText}`,
        `New schedule: ${formatAutomationTrigger(automation.trigger)}`,
        `Next run: ${nextRunAtText ?? 'none'}`,
        ...(stateNote ? [stateNote] : []),
        'The automation is available on the Automation page.',
      ].join('\n'),
      {
        status,
        automation: {
          id: automation.id,
          name: automation.name,
          enabled: automation.enabled,
          status: automation.status,
          scheduleText: formatAutomationTrigger(automation.trigger),
          nextRunAt: automation.nextRunAt,
          nextRunAtText,
          timezone: automation.trigger.timezone,
        },
      }
    );
  }

  private formatEnabledResult(
    automation: Automation,
    status: 'updated' | 'unchanged',
    wasRunning = false
  ): AutomationToolResult {
    const nextRunAtText =
      automation.nextRunAt === null
        ? null
        : formatTimestamp(automation.nextRunAt, automation.trigger.timezone);
    const stateText = automation.enabled ? 'enabled' : 'disabled';
    const headline =
      status === 'updated'
        ? `${automation.enabled ? 'Enabled' : 'Disabled'} automation: ${automation.name} (${automation.id})`
        : `Automation is already ${stateText}: ${automation.name} (${automation.id})`;
    const runningNote =
      wasRunning && !automation.enabled
        ? 'The current execution was not cancelled; future scheduled executions are disabled.'
        : null;
    const noFutureRunNote =
      automation.enabled && automation.nextRunAt === null
        ? 'This automation is enabled but its schedule has no future execution time. Update the schedule before it can run again.'
        : null;

    return toolResult(
      [
        headline,
        `Status: ${automation.status}`,
        `Schedule: ${formatAutomationTrigger(automation.trigger)}`,
        `Next run: ${nextRunAtText ?? 'none'}`,
        ...(runningNote ? [runningNote] : []),
        ...(noFutureRunNote ? [noFutureRunNote] : []),
        'The automation is available on the Automation page.',
      ].join('\n'),
      {
        status,
        automation: {
          id: automation.id,
          name: automation.name,
          enabled: automation.enabled,
          status: automation.status,
          scheduleText: formatAutomationTrigger(automation.trigger),
          nextRunAt: automation.nextRunAt,
          nextRunAtText,
          timezone: automation.trigger.timezone,
        },
        ...(runningNote ? { currentExecutionCancelled: false } : {}),
      }
    );
  }

  private toListItem(automation: Automation): AutomationToolListItem {
    const enabledNode = automation.actionGraph.nodes.find((node) => node.enabled !== false);
    const actionKind =
      enabledNode?.type === 'data.pipeline.run'
        ? 'data_pipeline'
        : enabledNode?.type === 'conversation.run'
          ? 'conversation'
          : 'other';
    const pipelineId =
      actionKind === 'data_pipeline' && typeof enabledNode?.config.pipelineId === 'string'
        ? enabledNode.config.pipelineId
        : undefined;
    return {
      id: automation.id,
      name: automation.name,
      enabled: automation.enabled,
      status: automation.status,
      actionKind,
      dataPipelineId: pipelineId,
      scheduleSummary: formatAutomationTrigger(automation.trigger),
      timezone: automation.trigger.timezone,
      nextRunAt: automation.nextRunAt,
      nextRunAtText:
        automation.nextRunAt === null
          ? null
          : formatTimestamp(automation.nextRunAt, automation.trigger.timezone),
    };
  }
}

function toolResult(text: string, details: unknown): AutomationToolResult {
  return { content: [{ type: 'text', text }], details };
}

function automationTriggerFingerprint(trigger: Automation['trigger']): string {
  return JSON.stringify(normalizeAutomationTrigger(trigger));
}

function buildScheduleUpdateWarnings(
  automation: Automation,
  trigger: Automation['trigger']
): string[] {
  const warnings: string[] = [];
  if (!automation.enabled) {
    warnings.push('This automation is disabled and changing its schedule will not enable it.');
  } else if (automation.status === 'paused') {
    warnings.push('This automation is paused and changing its schedule will not resume it.');
  }
  if (automationTriggerFingerprint(automation.trigger) === automationTriggerFingerprint(trigger)) {
    warnings.push('This automation already uses the requested schedule.');
  }
  return warnings;
}

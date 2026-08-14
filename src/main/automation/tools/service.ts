import { randomUUID } from 'crypto';
import type { DataTaskStore } from '../../data/data-task-store';
import { createDataResourceHref } from '../../../shared/data-resource-link';
import type { Automation, AutomationActionNode } from '../../../shared/automation/types';
import type { AutomationService } from '../automation-service';
import { computeNextAutomationRunAt } from '../automation-trigger';
import {
  compileAutomationSchedule,
  formatAutomationTrigger,
  formatTimestamp,
} from './schedule-compiler';
import { AutomationDraftReceiptStore, type AutomationDraftReceipt } from './draft-receipt-store';
import type {
  AutomationCreateToolInput,
  AutomationListToolInput,
  AutomationPrepareToolInput,
  AutomationToolActionInput,
  AutomationToolExecutionContext,
  AutomationToolListItem,
  AutomationToolResult,
  PreparedAutomationDependency,
} from './contract';

interface AutomationToolServiceOptions {
  automationService: AutomationService;
  dataTaskStore: DataTaskStore;
  receiptStore?: AutomationDraftReceiptStore;
  now?: () => number;
  systemTimezone?: () => string;
  projectExists?: (projectId: string) => boolean;
  onAutomationsChanged?: () => void;
}

export class AutomationToolService {
  private readonly automationService: AutomationService;
  private readonly dataTaskStore: DataTaskStore;
  private readonly receiptStore: AutomationDraftReceiptStore;
  private readonly now: () => number;
  private readonly systemTimezone: () => string;
  private readonly projectExists?: (projectId: string) => boolean;
  private readonly onAutomationsChanged?: () => void;

  constructor(options: AutomationToolServiceOptions) {
    this.automationService = options.automationService;
    this.dataTaskStore = options.dataTaskStore;
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
    const automations = matches
      .slice(offset, offset + limit)
      .map((automation) => this.toListItem(automation));
    const lines = automations.map(
      (automation) =>
        `- ${automation.name} (${automation.id}) status=${automation.status} action=${automation.actionKind} schedule=${automation.scheduleSummary} nextRun=${automation.nextRunAtText ?? 'none'}`
    );
    return toolResult(
      lines.length
        ? `Found ${automations.length} of ${matches.length} automation(s):\n${lines.join('\n')}`
        : 'No automations found.',
      { total: matches.length, automations }
    );
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
        'Call automation_create only if the user explicitly asked to create this automation.',
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

  clearConversationContext(sessionId: string): void {
    this.receiptStore.deleteForSession(sessionId);
  }

  private async prepareAction(input: AutomationToolActionInput): Promise<{
    node: AutomationActionNode;
    projectId: string | null;
    actionText: string;
    dependency: PreparedAutomationDependency;
  }> {
    if (input.kind === 'data_task') {
      const taskId = input.taskId.trim();
      if (!taskId) throw new Error('Data task id is required.');
      const task = await this.requireRunnableDataTask(taskId);
      return {
        node: {
          id: randomUUID(),
          type: 'data.task.run',
          label: task.name,
          enabled: true,
          config: { taskId: task.id, outputMode: 'persisted' },
        },
        projectId: null,
        actionText: `正式执行数据任务 ${task.name} (${task.id})`,
        dependency: { kind: 'data_task', taskId: task.id, taskName: task.name },
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

  private async requireRunnableDataTask(taskId: string) {
    const task = await this.dataTaskStore.getTaskRecord(taskId);
    if (!task) throw new Error(`Data task not found: ${taskId}`);
    const workflow = await this.dataTaskStore.getTaskWorkflow(taskId);
    if (task.nodeCount <= 0 || workflow.nodes.length === 0) {
      throw new Error(`Data task has no runnable workflow: ${task.name} (${task.id})`);
    }
    return task;
  }

  private async revalidateDependency(dependency: PreparedAutomationDependency): Promise<void> {
    if (dependency.kind === 'data_task') {
      await this.requireRunnableDataTask(dependency.taskId);
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
    const dataTaskLink =
      receipt.dependency.kind === 'data_task'
        ? `[${receipt.dependency.taskName}](${createDataResourceHref('task', receipt.dependency.taskId)})`
        : null;
    return toolResult(
      [
        status === 'created'
          ? `Created automation: ${automation.name} (${automation.id})`
          : `Automation was already created: ${automation.name} (${automation.id})`,
        dataTaskLink ? `Data task: ${dataTaskLink}` : `Action: ${receipt.summary.actionText}`,
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

  private toListItem(automation: Automation): AutomationToolListItem {
    const enabledNode = automation.actionGraph.nodes.find((node) => node.enabled !== false);
    const actionKind =
      enabledNode?.type === 'data.task.run'
        ? 'data_task'
        : enabledNode?.type === 'conversation.run'
          ? 'conversation'
          : 'other';
    const taskId =
      actionKind === 'data_task' && typeof enabledNode?.config.taskId === 'string'
        ? enabledNode.config.taskId
        : undefined;
    return {
      id: automation.id,
      name: automation.name,
      enabled: automation.enabled,
      status: automation.status,
      actionKind,
      dataTaskId: taskId,
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

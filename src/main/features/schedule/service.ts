import * as crypto from 'crypto';
import type {
  Automation,
  AutomationActionGraph,
  AutomationCreateInput,
  AutomationTrigger,
} from '../../../shared/automation/types';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
} from '../../../shared/schedule/task-title';
import { appContext } from '../../app/context';
import { resolveAutomationProjectCwd } from '../../app/projects';
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
} from '../../schedule/scheduled-task-manager';
import { logWarn } from '../../utils/logger';

export async function resolveScheduledTaskTitle(
  prompt: string,
  _cwd?: string,
  fallbackTitle?: string
): Promise<string> {
  const normalizedPrompt = prompt.trim();
  const fallback = fallbackTitle
    ? buildScheduledTaskTitle(fallbackTitle)
    : buildScheduledTaskFallbackTitle(normalizedPrompt);
  if (!appContext.sessionManager) {
    return fallback;
  }
  try {
    return await appContext.sessionManager.generateScheduledTaskTitle(normalizedPrompt);
  } catch (error) {
    logWarn('[Schedule] Failed to generate title via session title flow, using fallback', error);
    return fallback;
  }
}

export function scheduleInputToTrigger(input: {
  runAt: number;
  scheduleConfig?: ScheduledTaskCreateInput['scheduleConfig'];
  repeatEvery?: number | null;
  repeatUnit?: ScheduledTaskCreateInput['repeatUnit'];
}): AutomationTrigger {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (input.scheduleConfig?.kind === 'daily') {
    return { kind: 'daily', times: input.scheduleConfig.times, timezone };
  }
  if (input.scheduleConfig?.kind === 'weekly') {
    return {
      kind: 'weekly',
      weekdays: input.scheduleConfig.weekdays,
      times: input.scheduleConfig.times,
      timezone,
    };
  }
  if (input.scheduleConfig?.kind === 'monthly') {
    return {
      kind: 'monthly',
      daysOfMonth: input.scheduleConfig.daysOfMonth,
      includeLastDay: input.scheduleConfig.includeLastDay,
      times: input.scheduleConfig.times,
      timezone,
    };
  }
  if (input.repeatEvery && input.repeatUnit) {
    return {
      kind: 'interval',
      every: input.repeatEvery,
      unit: input.repeatUnit,
      startAt: input.runAt,
      timezone,
    };
  }
  return { kind: 'once', runAt: input.runAt, timezone };
}

export function scheduleInputToActionGraph(input: {
  prompt: string;
  cwd: string;
  projectId?: string | null;
  automationConfig?: ScheduledTaskCreateInput['automationConfig'];
}): AutomationActionGraph {
  const automationConfig = input.automationConfig;
  if (automationConfig?.actionKind === 'data_task' && automationConfig.dataTaskId) {
    const dataNodeId = crypto.randomUUID();
    return {
      version: 1,
      nodes: [
        {
          id: dataNodeId,
          type: 'data.task.run',
          label: automationConfig.dataTaskName ?? 'Data task',
          enabled: true,
          config: { taskId: automationConfig.dataTaskId, outputMode: 'persisted' },
        },
      ],
      edges: [],
    };
  }
  return {
    version: 1,
    nodes: [
      {
        id: crypto.randomUUID(),
        type: 'conversation.run',
        label: '',
        enabled: true,
        config: {
          prompt: input.prompt,
          projectId: input.projectId ?? null,
          completionMode: 'fire_and_forget',
          timeoutMs: 30 * 60 * 1000,
          collectArtifacts: true,
        },
      },
    ],
    edges: [],
  };
}

export function scheduleDeliveryToAutomationDelivery(
  delivery?: {
    enabled?: boolean;
    artifactPolicy?: 'summary' | 'links' | 'files';
    recipients?: Array<{ id: string; channel: string; target: string; enabled: boolean }>;
  } | null
): AutomationCreateInput['delivery'] {
  const value = delivery ?? undefined;
  if (!value?.enabled) return null;
  return {
    enabled: true,
    artifactPolicy:
      value.artifactPolicy === 'files' ? 'attachments' : (value.artifactPolicy ?? 'links'),
    failureMessage: { includeRunLog: true, includeArtifacts: false },
    channels:
      value.recipients?.map((recipient) => ({
        id: recipient.id,
        type:
          recipient.channel === 'email' || recipient.channel === 'webhook'
            ? recipient.channel
            : 'feishu',
        enabled: recipient.enabled !== false,
        recipient: recipient.target,
        config: {},
      })) ?? [],
  };
}

export function automationToScheduledTask(automation: Automation): ScheduledTask {
  const conversationNode = automation.actionGraph.nodes.find(
    (node) => node.type === 'conversation.run'
  );
  const dataTaskNode = automation.actionGraph.nodes.find((node) => node.type === 'data.task.run');
  const prompt =
    typeof conversationNode?.config.prompt === 'string' ? conversationNode.config.prompt : '';
  const actionProjectId =
    typeof conversationNode?.config.projectId === 'string' &&
    conversationNode.config.projectId.trim()
      ? conversationNode.config.projectId.trim()
      : null;
  const legacyCwd =
    typeof conversationNode?.config.cwd === 'string' ? conversationNode.config.cwd : '';
  const cwd = resolveAutomationProjectCwd(automation.projectId ?? actionProjectId) || legacyCwd;
  const scheduleConfig =
    automation.trigger.kind === 'daily'
      ? { kind: 'daily' as const, times: automation.trigger.times }
      : automation.trigger.kind === 'weekly'
        ? {
            kind: 'weekly' as const,
            weekdays: automation.trigger.weekdays,
            times: automation.trigger.times,
          }
        : automation.trigger.kind === 'monthly'
          ? {
              kind: 'monthly' as const,
              daysOfMonth: automation.trigger.daysOfMonth,
              includeLastDay: automation.trigger.includeLastDay,
              times: automation.trigger.times,
            }
          : null;
  return {
    id: automation.id,
    title: automation.name,
    prompt,
    cwd,
    automationConfig: dataTaskNode
      ? {
          actionKind: 'data_task',
          dataTaskId:
            typeof dataTaskNode.config.taskId === 'string' ? dataTaskNode.config.taskId : null,
          dataTaskName: dataTaskNode.label ?? null,
          delivery: {
            enabled: automation.delivery?.enabled ?? false,
            artifactPolicy:
              automation.delivery?.artifactPolicy === 'attachments'
                ? 'files'
                : (automation.delivery?.artifactPolicy ?? 'links'),
            recipients:
              automation.delivery?.channels.map((channel) => ({
                id: channel.id,
                label: channel.recipient,
                channel:
                  channel.type === 'email' || channel.type === 'webhook' ? channel.type : 'feishu',
                target: channel.recipient,
                enabled: channel.enabled,
              })) ?? [],
          },
        }
      : null,
    runAt:
      automation.trigger.kind === 'once'
        ? automation.trigger.runAt
        : automation.trigger.kind === 'interval'
          ? automation.trigger.startAt
          : (automation.nextRunAt ?? automation.createdAt),
    nextRunAt: automation.nextRunAt,
    scheduleConfig,
    repeatEvery: automation.trigger.kind === 'interval' ? automation.trigger.every : null,
    repeatUnit: automation.trigger.kind === 'interval' ? automation.trigger.unit : null,
    enabled: automation.enabled && automation.status !== 'paused',
    lastRunAt: automation.lastRunAt,
    lastRunSessionId: null,
    lastError: automation.lastError,
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
  };
}

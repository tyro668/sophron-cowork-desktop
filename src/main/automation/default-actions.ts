import type { DataTaskStore } from '../data/data-task-store';
import type { SessionManager } from '../session/session-manager';
import type { AgentRuntimeConfig } from '../../renderer/types';
import { buildScheduledTaskFallbackTitle } from '../../shared/schedule/task-title';
import { AutomationActionRegistry, objectSchema } from './automation-action-registry';

interface DefaultAutomationActionOptions {
  dataTaskStore: DataTaskStore;
  sessionManager: SessionManager;
  resolveProjectCwd?: (projectId: string) => string | null;
  resolveModelRuntimeConfig?: (configSetId: string) => AgentRuntimeConfig | null;
  sendNotification?: (payload: {
    channel: string;
    recipient: string;
    message: string;
  }) => Promise<{ id?: string; href?: string } | void>;
  sendSessionUpdate?: (session: Awaited<ReturnType<SessionManager['startSession']>>) => void;
  now?: () => number;
}

export function createDefaultAutomationActionRegistry(
  options: DefaultAutomationActionOptions
): AutomationActionRegistry {
  const registry = new AutomationActionRegistry();
  const now = options.now ?? (() => Date.now());

  registry.register({
    type: 'notification.send',
    title: 'Message',
    description: 'Create a notification artifact for a configured recipient or channel.',
    category: 'integration',
    icon: 'message-square',
    version: 1,
    defaultConfig: {
      channel: 'feishu',
      recipient: '',
      message: '',
    },
    configSchema: objectSchema(
      {
        channel: {
          type: 'string',
          title: 'Channel',
          enum: ['feishu', 'email', 'webhook'],
          default: 'feishu',
        },
        recipient: { type: 'string', title: 'Recipient' },
        message: { type: 'string', title: 'Message' },
      },
      ['message']
    ),
    validate: (config) => {
      if (!String(config.message ?? '').trim()) {
        throw new Error('notification.send requires message');
      }
    },
    execute: async (config, context, node) => {
      const channel = String(config.channel ?? 'feishu');
      const recipient = String(config.recipient ?? '').trim();
      const message = String(config.message ?? '').trim();
      const deliveryResult = await options.sendNotification?.({ channel, recipient, message });
      context.emitArtifact({
        sourceNodeId: node.id,
        kind: deliveryResult?.href ? 'link' : 'markdown',
        title: node.label || 'Message notification',
        summary: recipient ? `${channel}: ${recipient}` : channel,
        content: deliveryResult?.href ? undefined : message,
        href: deliveryResult?.href,
      });
      return { channel, recipient, message, deliveryId: deliveryResult?.id ?? null };
    },
  });

  registry.register({
    type: 'conversation.run',
    title: 'Conversation',
    description: 'Start a task conversation and optionally wait until it finishes.',
    category: 'conversation',
    icon: 'message-square',
    version: 1,
    defaultConfig: {
      prompt: '',
      projectId: null,
      modelConfigSetId: null,
      model: null,
      completionMode: 'wait',
      timeoutMs: 30 * 60 * 1000,
      collectArtifacts: true,
    },
    configSchema: objectSchema(
      {
        prompt: { type: 'string', title: 'Prompt' },
        projectId: { type: 'string', title: 'Project' },
        modelConfigSetId: { type: 'string', title: 'Model config set' },
        model: { type: 'string', title: 'Model' },
        completionMode: {
          type: 'string',
          title: 'Completion mode',
          enum: ['wait', 'fire_and_forget'],
          default: 'wait',
        },
        timeoutMs: { type: 'integer', title: 'Timeout' },
        collectArtifacts: { type: 'boolean', title: 'Collect artifacts', default: true },
      },
      ['prompt']
    ),
    validate: (config) => {
      if (!String(config.prompt ?? '').trim()) {
        throw new Error('conversation.run requires prompt');
      }
    },
    execute: async (config, context) => {
      const prompt = String(config.prompt ?? '').trim();
      const projectId =
        typeof config.projectId === 'string' && config.projectId.trim()
          ? config.projectId.trim()
          : context.projectId;
      const cwd = projectId ? (options.resolveProjectCwd?.(projectId) ?? undefined) : undefined;
      const modelConfigSetId =
        typeof config.modelConfigSetId === 'string' && config.modelConfigSetId.trim()
          ? config.modelConfigSetId.trim()
          : null;
      const runtimeConfig = modelConfigSetId
        ? (options.resolveModelRuntimeConfig?.(modelConfigSetId) ?? undefined)
        : undefined;
      const title = buildScheduledTaskFallbackTitle(prompt);
      const session = await options.sessionManager.startSession(
        title,
        prompt,
        cwd,
        undefined,
        undefined,
        undefined,
        runtimeConfig,
        { suppressCompletionNotification: true }
      );
      options.sendSessionUpdate?.(session);
      context.emitArtifact({
        kind: 'session',
        title: session.title,
        summary: prompt.slice(0, 160),
        dataRef: { kind: 'session', id: session.id },
      });
      if (config.completionMode !== 'fire_and_forget') {
        await waitForSession(
          options.sessionManager,
          session.id,
          Number(config.timeoutMs) || 30 * 60 * 1000,
          now
        );
      }
      return { sessionId: session.id };
    },
  });

  registry.register({
    type: 'data.task.run',
    title: 'Run data task',
    description: 'Run a saved data task and emit the produced output table.',
    category: 'data',
    icon: 'database',
    version: 1,
    defaultConfig: { taskId: '', outputMode: 'persisted' },
    configSchema: objectSchema(
      {
        taskId: { type: 'string', title: 'Data task' },
        outputMode: {
          type: 'string',
          title: 'Output mode',
          enum: ['persisted', 'temporary'],
          default: 'persisted',
        },
      },
      ['taskId']
    ),
    validate: (config) => {
      if (!String(config.taskId ?? '').trim()) {
        throw new Error('data.task.run requires taskId');
      }
    },
    execute: async (config, context, node) => {
      const task = await options.dataTaskStore.runTask(String(config.taskId), {
        outputMode: config.outputMode === 'temporary' ? 'temporary' : 'persisted',
      });
      context.emitArtifact({
        sourceNodeId: node.id,
        kind: 'data_output',
        title: task.name,
        summary:
          task.rowCount === null
            ? undefined
            : `${task.rowCount} rows, ${task.columnCount ?? 0} columns`,
        dataRef: { kind: 'output_table', id: task.id },
      });
      return task;
    },
  });

  registry.register({
    type: 'data.input.preview',
    title: 'Preview input table',
    category: 'data',
    icon: 'table',
    version: 1,
    defaultConfig: { inputTableId: '', limit: 20 },
    configSchema: objectSchema(
      {
        inputTableId: { type: 'string', title: 'Input table' },
        limit: { type: 'integer', title: 'Rows', default: 20 },
      },
      ['inputTableId']
    ),
    execute: async (config, context, node) => {
      const preview = await options.dataTaskStore.previewDataset({
        id: String(config.inputTableId),
        limit: Number(config.limit) || 20,
      });
      context.emitArtifact({
        sourceNodeId: node.id,
        kind: 'table',
        title: 'Input preview',
        summary: `${preview.rows.length} preview rows`,
        content: JSON.stringify(preview.rows),
        dataRef: { kind: 'input_table', id: String(config.inputTableId) },
      });
      return preview;
    },
  });

  registry.register({
    type: 'data.output.preview',
    title: 'Preview output table',
    category: 'data',
    icon: 'table',
    version: 1,
    defaultConfig: { outputTableId: '', limit: 20 },
    configSchema: objectSchema(
      {
        outputTableId: { type: 'string', title: 'Output table' },
        limit: { type: 'integer', title: 'Rows', default: 20 },
      },
      ['outputTableId']
    ),
    execute: async (config, context, node) => {
      const preview = await options.dataTaskStore.previewDataset({
        id: String(config.outputTableId),
        limit: Number(config.limit) || 20,
      });
      context.emitArtifact({
        sourceNodeId: node.id,
        kind: 'table',
        title: 'Output preview',
        summary: `${preview.rows.length} preview rows`,
        content: JSON.stringify(preview.rows),
        dataRef: { kind: 'output_table', id: String(config.outputTableId) },
      });
      return preview;
    },
  });

  return registry;
}

async function waitForSession(
  sessionManager: SessionManager,
  sessionId: string,
  timeoutMs: number,
  now: () => number
): Promise<void> {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const session = sessionManager.listSessions().find((row) => row.id === sessionId);
    if (!session || session.status === 'completed') return;
    if (session.status === 'error') {
      throw new Error(`Conversation failed: ${session.title}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Conversation timed out after ${timeoutMs}ms`);
}

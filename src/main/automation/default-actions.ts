import type { DataTaskStore } from '../data/data-task-store';
import type { DataCommandService } from '../data/data-command-service';
import type { SessionManager } from '../session/session-manager';
import type { AgentRuntimeConfig } from '../../shared/contracts';
import { buildScheduledTaskFallbackTitle } from '../../shared/schedule/task-title';
import {
  getPermissionRulesForPolicy,
  normalizePermissionPolicy,
} from '../../shared/permission-policies';
import { AutomationActionRegistry, objectSchema } from './automation-action-registry';

interface DefaultAutomationActionOptions {
  dataTaskStore: DataTaskStore;
  dataCommandService?: DataCommandService;
  sessionManager: SessionManager;
  resolveProjectCwd?: (projectId: string) => string | null;
  resolveModelRuntimeConfig?: (configSetId: string) => AgentRuntimeConfig | null;
  sendSessionUpdate?: (session: Awaited<ReturnType<SessionManager['startSession']>>) => void;
  now?: () => number;
}

export function createDefaultAutomationActionRegistry(
  options: DefaultAutomationActionOptions
): AutomationActionRegistry {
  const registry = new AutomationActionRegistry();
  const now = options.now ?? (() => Date.now());

  registry.register({
    type: 'conversation.run',
    title: 'Conversation',
    description: 'Start a task conversation and optionally wait until it finishes.',
    category: 'conversation',
    icon: 'message-square',
    version: 1,
    defaultConfig: {
      prompt: '',
      selectedSkillNames: [],
      projectId: null,
      modelConfigSetId: null,
      model: null,
      completionMode: 'wait',
      timeoutMs: 30 * 60 * 1000,
      collectArtifacts: true,
      permissionPolicy: 'auto_review',
    },
    configSchema: objectSchema(
      {
        prompt: { type: 'string', title: 'Prompt' },
        selectedSkillNames: {
          type: 'array',
          title: 'Selected skills',
          items: { type: 'string' },
          default: [],
        },
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
        permissionPolicy: {
          type: 'string',
          title: 'Permission policy',
          enum: ['default', 'auto_review', 'full_access'],
          default: 'auto_review',
        },
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
      const selectedSkillNames = Array.isArray(config.selectedSkillNames)
        ? config.selectedSkillNames
            .map((name) => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean)
        : [];
      const permissionPolicy = normalizePermissionPolicy(config.permissionPolicy);
      const title = buildScheduledTaskFallbackTitle(prompt);
      const session = await options.sessionManager.startSession(
        title,
        prompt,
        cwd,
        undefined,
        undefined,
        undefined,
        runtimeConfig,
        {
          suppressCompletionNotification: true,
          selectedSkillNames,
          permissionRules: getPermissionRulesForPolicy(permissionPolicy),
        }
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
      const taskId = String(config.taskId);
      const task = await options.dataTaskStore.runTask(taskId, {
        outputMode: config.outputMode === 'temporary' ? 'temporary' : 'persisted',
      });
      const workflow = await options.dataTaskStore.getTaskWorkflow(taskId);
      const outputNode = workflow.nodes.find((workflowNode) => workflowNode.type === 'output');
      const outputTableId =
        typeof outputNode?.config.outputDatasetId === 'string'
          ? outputNode.config.outputDatasetId
          : typeof outputNode?.config.outputTableId === 'string'
            ? outputNode.config.outputTableId
            : null;
      context.emitArtifact({
        sourceNodeId: node.id,
        kind: 'data_output',
        title: task.name,
        summary:
          task.rowCount === null
            ? undefined
            : `${task.rowCount} rows, ${task.columnCount ?? 0} columns`,
        dataRef: outputTableId ? { kind: 'output_table', id: outputTableId } : undefined,
      });
      return task;
    },
  });

  registry.register({
    type: 'cloud.table.process',
    title: 'Process cloud/local table',
    description: 'Run a generated data task with runtime input/output bindings without LLM tokens.',
    category: 'data',
    icon: 'database',
    version: 1,
    defaultConfig: {
      taskId: '',
      source: null,
      output: null,
      requiredColumns: [],
      expectedOutputSchema: [],
      lineage: [],
      columnsSnapshot: [],
      schemaPolicy: 'required_subset',
      outputMode: 'persisted',
    },
    configSchema: objectSchema(
      {
        taskId: { type: 'string', title: 'Data task' },
        source: { type: 'object', title: 'Runtime source' },
        output: { type: 'object', title: 'Runtime output' },
        requiredColumns: { type: 'array', title: 'Required columns', items: { type: 'object' } },
        expectedOutputSchema: {
          type: 'array',
          title: 'Expected output schema',
          items: { type: 'object' },
        },
        lineage: { type: 'array', title: 'Output lineage', items: { type: 'object' } },
        columnsSnapshot: { type: 'array', title: 'Column snapshot', items: { type: 'object' } },
        schemaPolicy: {
          type: 'string',
          title: 'Schema policy',
          enum: ['strict', 'required_subset'],
          default: 'required_subset',
        },
        outputMode: {
          type: 'string',
          title: 'Output mode',
          enum: ['persisted', 'temporary'],
          default: 'persisted',
        },
      },
      ['taskId', 'source', 'output']
    ),
    validate: (config) => {
      if (!options.dataCommandService) {
        throw new Error('cloud.table.process requires DataCommandService');
      }
      if (!String(config.taskId ?? '').trim()) {
        throw new Error('cloud.table.process requires taskId');
      }
      if (!config.source || typeof config.source !== 'object') {
        throw new Error('cloud.table.process requires source');
      }
      if (!config.output || typeof config.output !== 'object') {
        throw new Error('cloud.table.process requires output');
      }
    },
    execute: async (config, context, node) => {
      if (!options.dataCommandService) {
        throw new Error('cloud.table.process requires DataCommandService');
      }
      context.log({
        level: 'info',
        message: 'Running generated data task without model tokens',
        details: { tokenUsage: 0 },
      });
      const result = await options.dataCommandService.runGeneratedTask({
        taskId: String(config.taskId),
        source: config.source as never,
        output: config.output as never,
        requiredColumns: Array.isArray(config.requiredColumns)
          ? (config.requiredColumns as never)
          : [],
        expectedOutputSchema: Array.isArray(config.expectedOutputSchema)
          ? (config.expectedOutputSchema as never)
          : [],
        schemaPolicy: config.schemaPolicy === 'strict' ? 'strict' : 'required_subset',
        mode: config.outputMode === 'temporary' ? 'temporary' : 'persisted',
      });
      context.emitArtifact({
        sourceNodeId: node.id,
        kind: 'data_output',
        title: result.task.name,
        summary:
          result.task.rowCount === null
            ? 'Generated data task completed with 0 model tokens'
            : `${result.task.rowCount} rows, ${result.task.columnCount ?? 0} columns, 0 model tokens`,
        dataRef: { kind: 'output_table', id: result.outputTableId },
      });
      return result;
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
    if (!session || session.status === 'completed' || session.status === 'idle') return;
    if (session.status === 'error') {
      throw new Error(`Conversation failed: ${session.title}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Conversation timed out after ${timeoutMs}ms`);
}

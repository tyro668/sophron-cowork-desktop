import { registerCloudSyncAction } from './cloud-sync-action';
import { registerScriptRunAction } from './script-run-action';
import { waitForSession } from './wait-for-session';
import type { ScriptPackageService } from './script-packages/service';
import type { ScriptFilesGenerator } from './script-packages/generator';
import type { AutomationStore } from './automation-store';
import type { DataPipelineStore } from '../data/data-pipeline-store';
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
  dataPipelineStore: DataPipelineStore;
  automationStore?: AutomationStore;
  dataCommandService?: DataCommandService;
  sessionManager: SessionManager;
  resolveProjectCwd?: (projectId: string) => string | null;
  resolveModelRuntimeConfig?: (
    configSetId: string
  ) => AgentRuntimeConfig | null | Promise<AgentRuntimeConfig | null>;
  sendSessionUpdate?: (session: Awaited<ReturnType<SessionManager['startSession']>>) => void;
  scriptPackages?: ScriptPackageService;
  /** Script generation agent for 执行脚本's onScriptError 'ai_repair'. */
  scriptGenerator?: ScriptFilesGenerator;
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
        ? ((await options.resolveModelRuntimeConfig?.(modelConfigSetId)) ?? undefined)
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
          permissionPolicy,
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
    type: 'data.pipeline.run',
    title: 'Run data pipeline',
    description: 'Run a saved data pipeline and emit the produced output table.',
    category: 'data',
    icon: 'database',
    version: 1,
    defaultConfig: { pipelineId: '', outputMode: 'persisted' },
    configSchema: objectSchema(
      {
        pipelineId: { type: 'string', title: 'Data pipeline' },
        outputMode: {
          type: 'string',
          title: 'Output mode',
          enum: ['persisted', 'temporary'],
          default: 'persisted',
        },
      },
      ['pipelineId']
    ),
    validate: (config) => {
      if (!String(config.pipelineId ?? '').trim()) {
        throw new Error('data.pipeline.run requires pipelineId');
      }
    },
    execute: async (config, context, node) => {
      const pipelineId = String(config.pipelineId);
      const pipeline = await options.dataPipelineStore.runPipeline(pipelineId, {
        outputMode: config.outputMode === 'temporary' ? 'temporary' : 'persisted',
      });
      const workflow = await options.dataPipelineStore.getPipelineWorkflow(pipelineId);
      const outputNode = workflow.nodes.find((workflowNode) => workflowNode.type === 'output');
      const resultTableId =
        typeof outputNode?.config.outputResultTableId === 'string'
          ? outputNode.config.outputResultTableId
          : typeof outputNode?.config.resultTableId === 'string'
            ? outputNode.config.resultTableId
            : null;
      context.emitArtifact({
        sourceNodeId: node.id,
        kind: 'data_output',
        title: pipeline.name,
        summary:
          pipeline.rowCount === null
            ? undefined
            : `${pipeline.rowCount} rows, ${pipeline.columnCount ?? 0} columns`,
        dataRef: resultTableId ? { kind: 'result_table', id: resultTableId } : undefined,
      });
      return pipeline;
    },
  });

  registry.register({
    type: 'cloud.table.process',
    title: 'Process cloud/local table',
    description:
      'Run a generated data pipeline with runtime input/output bindings without LLM tokens.',
    category: 'data',
    icon: 'database',
    version: 1,
    defaultConfig: {
      pipelineId: '',
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
        pipelineId: { type: 'string', title: 'Data pipeline' },
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
      ['pipelineId', 'source', 'output']
    ),
    validate: (config) => {
      if (!options.dataCommandService) {
        throw new Error('cloud.table.process requires DataCommandService');
      }
      if (!String(config.pipelineId ?? '').trim()) {
        throw new Error('cloud.table.process requires pipelineId');
      }
      if (!config.source || typeof config.source !== 'object') {
        throw new Error('cloud.table.process requires source');
      }
      if ((config.output as { location?: string } | undefined)?.location !== 'local') {
        throw new Error('schedule.cloudSync.useOutputAction');
      }
      if (!config.output || typeof config.output !== 'object') {
        throw new Error('cloud.table.process requires output');
      }
    },
    execute: async (config, context, node) => {
      if ((config.output as { location?: string } | undefined)?.location !== 'local')
        throw new Error('schedule.cloudSync.useOutputAction');
      if (!options.dataCommandService) {
        throw new Error('cloud.table.process requires DataCommandService');
      }
      context.log({
        level: 'info',
        message: 'Running generated data pipeline without model tokens',
        details: { tokenUsage: 0 },
      });
      const result = await options.dataCommandService.runGeneratedPipeline({
        pipelineId: String(config.pipelineId),
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
        title: result.pipeline.name,
        summary:
          result.pipeline.rowCount === null
            ? 'Generated data pipeline completed with 0 model tokens'
            : `${result.pipeline.rowCount} rows, ${result.pipeline.columnCount ?? 0} columns, 0 model tokens`,
        dataRef: { kind: 'result_table', id: result.resultTableId },
      });
      return result;
    },
  });

  registry.register({
    type: 'data.raw.preview',
    title: 'Preview input table',
    category: 'data',
    icon: 'table',
    version: 1,
    defaultConfig: { rawTableId: '', limit: 20 },
    configSchema: objectSchema(
      {
        rawTableId: { type: 'string', title: 'Input table' },
        limit: { type: 'integer', title: 'Rows', default: 20 },
      },
      ['rawTableId']
    ),
    execute: async (config, context, node) => {
      const preview = await options.dataPipelineStore.previewRawTable({
        id: String(config.rawTableId),
        limit: Number(config.limit) || 20,
      });
      context.emitArtifact({
        sourceNodeId: node.id,
        kind: 'table',
        title: 'Input preview',
        summary: `${preview.rows.length} preview rows`,
        content: JSON.stringify(preview.rows),
        dataRef: { kind: 'raw_table', id: String(config.rawTableId) },
      });
      return preview;
    },
  });

  registry.register({
    type: 'data.result.preview',
    title: 'Preview output table',
    category: 'data',
    icon: 'table',
    version: 1,
    defaultConfig: { resultTableId: '', limit: 20 },
    configSchema: objectSchema(
      {
        resultTableId: { type: 'string', title: 'Output table' },
        limit: { type: 'integer', title: 'Rows', default: 20 },
      },
      ['resultTableId']
    ),
    execute: async (config, context, node) => {
      const preview = await options.dataPipelineStore.previewRawTable({
        id: String(config.resultTableId),
        limit: Number(config.limit) || 20,
      });
      context.emitArtifact({
        sourceNodeId: node.id,
        kind: 'table',
        title: 'Output preview',
        summary: `${preview.rows.length} preview rows`,
        content: JSON.stringify(preview.rows),
        dataRef: { kind: 'result_table', id: String(config.resultTableId) },
      });
      return preview;
    },
  });

  registerCloudSyncAction(registry, options.dataCommandService, options.automationStore);
  if (options.scriptPackages) {
    registerScriptRunAction(registry, {
      scripts: options.scriptPackages,
      commands: options.dataCommandService,
      store: options.automationStore,
      generator: options.scriptGenerator,
      now,
    });
  }
  return registry;
}

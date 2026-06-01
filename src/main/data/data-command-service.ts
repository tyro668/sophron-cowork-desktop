import type { DataTaskStore } from './data-task-store';
import {
  compilePrepWorkflowToFlow,
  exportPrepWorkflowDsl,
  parsePrepDsl,
  parsePrepOperatorDsl,
  type PrepDiagnostic,
} from '../../shared/prep-dsl';
import type {
  DataCleaningTask,
  DataInputTablePreview,
  DataRunTaskInput,
  DataTaskWorkflow,
  DataWorkflowEdge,
  DataWorkflowEdgeInput,
  DataWorkflowNode,
  DataWorkflowNodeInput,
  DataWorkflowSaveInput,
} from '../../renderer/types';
import {
  DataCommandError,
  type ApplyOperatorDslCommand,
  type ApplyWorkflowDslCommand,
  type ConfigureInputOperatorCommand,
  type ConfigureOutputOperatorCommand,
  type CreateInputTableCommand,
  type CreateOutputTableCommand,
  type CreateTaskCommand,
  type ExportWorkflowDslCommand,
  type GetRunResultCommand,
  type GetTaskWorkflowCommand,
  type InputTableResult,
  type ListInputTablesInput,
  type ListInputTablesResult,
  type ListOutputTablesResult,
  type ListTasksResult,
  type OutputTableResult,
  type PreviewTableCommand,
  type PreviewTableResult,
  type RunResult,
  type RunTaskCommand,
  type RunTaskResult,
  type TaskResult,
  type TextResult,
  type UpdateInputTableCommand,
  type UpdateOutputTableCommand,
  type UpdateTaskCommand,
  type WorkflowResult,
  type WorkflowSaveShape,
} from './data-command-types';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 100;

interface WorkflowResourceBindings {
  inputTableId?: string;
  inputAlias?: string;
  outputTableId?: string;
}

export class DataCommandService {
  constructor(private readonly store: DataTaskStore) {}

  async listInputTables(input: ListInputTablesInput = {}): Promise<ListInputTablesResult> {
    const window = listWindow(input.limit, input.offset);
    const dashboard = await this.store.getDashboard({
      query: input.query,
      includeSummary: false,
      includeTasks: false,
      includeDatasets: true,
      includeOutputTables: false,
      datasetSourceKind: input.sourceKind ?? 'all',
      datasetLimit: window.limit,
      datasetOffset: window.offset,
    });
    return {
      inputTables: dashboard.datasets,
      total: dashboard.totalDatasets,
      ...window,
    };
  }

  async createInputTable(input: CreateInputTableCommand): Promise<InputTableResult> {
    const sourcePath = normalizeSourcePathInput(input);
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueInputTableName(name);
    }

    try {
      const inputTable = await this.store.importDataset({
        filePath: sourcePath,
        name,
        sourceKind: input.sourceKind,
        config: input.config,
      });
      const preview = await this.previewIfRequested(inputTable.id, input.previewRows);
      return { inputTable, preview };
    } catch (error) {
      throw toCommandError(error, 'FILE_ACCESS_DENIED');
    }
  }

  async updateInputTable(input: UpdateInputTableCommand): Promise<InputTableResult> {
    const existing = await this.store.getInputTableRecord(input.id);
    if (!existing) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Input table not found: ${input.id}`);
    }
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueInputTableName(name, input.id);
    }
    const sourcePath = input.filePath || input.folderPath;
    try {
      const inputTable = await this.store.updateDataset({
        id: input.id,
        name,
        filePath: sourcePath,
        sourceKind: input.sourceKind,
        config: input.config,
      });
      const preview = await this.previewIfRequested(inputTable.id, input.previewRows);
      return { inputTable, preview };
    } catch (error) {
      throw toCommandError(error, sourcePath ? 'FILE_ACCESS_DENIED' : 'INVALID_ARGUMENT');
    }
  }

  async listOutputTables(input: ListInputTablesInput = {}): Promise<ListOutputTablesResult> {
    const window = listWindow(input.limit, input.offset);
    const dashboard = await this.store.getDashboard({
      query: input.query,
      includeSummary: false,
      includeTasks: false,
      includeDatasets: false,
      includeOutputTables: true,
      outputLimit: window.limit,
      outputOffset: window.offset,
    });
    return {
      outputTables: dashboard.outputTables,
      total: dashboard.totalOutputTables,
      ...window,
    };
  }

  async createOutputTable(input: CreateOutputTableCommand = {}): Promise<OutputTableResult> {
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueOutputTableName(name);
    }
    if (input.sourceInputTableId) {
      await this.requireInputTable(input.sourceInputTableId);
    }

    const created = await this.store.createOutputTable({ name });
    const outputTable = input.sourceInputTableId
      ? await this.store.updateOutputTable({
          id: created.id,
          sourceDatasetId: input.sourceInputTableId,
        })
      : created;
    const preview = outputTable.rowCount > 0 ? await this.previewDataset(outputTable.id) : undefined;
    return { outputTable, preview };
  }

  async updateOutputTable(input: UpdateOutputTableCommand): Promise<OutputTableResult> {
    const existing = await this.store.getOutputTableRecord(input.id);
    if (!existing) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Output table not found: ${input.id}`);
    }
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueOutputTableName(name, input.id);
    }
    if (input.sourceInputTableId) {
      await this.requireInputTable(input.sourceInputTableId);
    }
    const outputTable = await this.store.updateOutputTable({
      id: input.id,
      name,
      sourceDatasetId: input.sourceInputTableId,
    });
    const preview = outputTable.rowCount > 0 ? await this.previewDataset(outputTable.id) : undefined;
    return { outputTable, preview };
  }

  async previewTable(input: PreviewTableCommand): Promise<PreviewTableResult> {
    if (input.tableKind === 'input') {
      await this.requireInputTable(input.id);
    } else {
      await this.requireOutputTable(input.id);
    }
    return {
      tableKind: input.tableKind,
      id: input.id,
      preview: await this.previewDataset(input.id, input.limit, input.offset),
    };
  }

  async listTasks(input: ListInputTablesInput = {}): Promise<ListTasksResult> {
    const window = listWindow(input.limit, input.offset);
    const dashboard = await this.store.getDashboard({
      query: input.query,
      includeSummary: false,
      includeTasks: true,
      includeDatasets: false,
      includeOutputTables: false,
      taskLimit: window.limit,
      taskOffset: window.offset,
    });
    return {
      tasks: dashboard.tasks,
      total: dashboard.totalTasks,
      ...window,
    };
  }

  async createTask(input: CreateTaskCommand): Promise<TaskResult> {
    const name = normalizeRequiredName(input.name, 'Task name is required');
    await this.ensureUniqueTaskName(name);
    if (input.sourceInputTableId) {
      await this.requireInputTable(input.sourceInputTableId);
    }
    if (input.outputTableId) {
      await this.requireOutputTable(input.outputTableId);
    }
    try {
      return {
        task: await this.store.createTask({
          name,
          sourcePath: input.sourcePath,
          sourceDatasetId: input.sourceInputTableId ?? null,
          outputTableId: input.outputTableId ?? null,
        }),
      };
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }

  async updateTask(input: UpdateTaskCommand): Promise<TaskResult> {
    await this.requireTask(input.id);
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueTaskName(name, input.id);
    }
    try {
      return { task: await this.store.updateTask({ id: input.id, name }) };
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }

  async getTaskWorkflow(input: GetTaskWorkflowCommand): Promise<WorkflowResult> {
    return { workflow: await this.store.getTaskWorkflow(input.taskId) };
  }

  async applyWorkflowDsl(input: ApplyWorkflowDslCommand): Promise<WorkflowResult> {
    await this.requireTask(input.taskId);
    const compiled = await this.compileWorkflowDsl(input.dsl, {
      inputTableId: input.inputTableId,
      inputAlias: input.inputAlias,
      outputTableId: input.outputTableId,
    });
    const errors = diagnosticsWithSeverity(compiled.diagnostics, 'error');
    if (errors.length > 0 && !input.dryRun) {
      throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(errors), {
        diagnostics: compiled.diagnostics,
      });
    }

    if (input.dryRun) {
      return {
        workflow: await this.toWorkflowPreview(input.taskId, compiled.workflow),
        diagnostics: compiled.diagnostics,
        dryRun: true,
      };
    }

    const workflow = await this.store.saveTaskWorkflow(input.taskId, compiled.workflow);
    return { workflow, diagnostics: compiled.diagnostics };
  }

  async exportWorkflowDsl(input: ExportWorkflowDslCommand): Promise<TextResult> {
    const workflow = await this.store.getTaskWorkflow(input.taskId);
    return { text: exportPrepWorkflowDsl(workflow.nodes, workflow.edges) };
  }

  async configureInputOperator(input: ConfigureInputOperatorCommand): Promise<WorkflowResult> {
    const workflow = await this.store.getTaskWorkflow(input.taskId);
    const inputTable = await this.requireInputTable(input.inputTableId);
    const node = findWorkflowNode(workflow, input.nodeId);
    if (node.type !== 'input_source') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow node is not an input operator: ${input.nodeId}`
      );
    }

    const alias = sanitizeAlias(input.alias) || stringConfigValue(node.config.alias) || 'source';
    const nextWorkflow = updateWorkflowNode(workflow, input.nodeId, {
      config: {
        ...node.config,
        source: 'dataset',
        datasetId: inputTable.id,
        inputTableName: inputTable.name,
        alias,
        dsl: `input source dataset "${escapeDslString(inputTable.id)}" as ${alias}`,
      },
    });

    return this.saveOrPreview(input.taskId, nextWorkflow, Boolean(input.dryRun));
  }

  async applyOperatorDsl(input: ApplyOperatorDslCommand): Promise<WorkflowResult> {
    const workflow = await this.store.getTaskWorkflow(input.taskId);
    const node = findWorkflowNode(workflow, input.nodeId);
    if (node.type === 'input_source' || node.type === 'output') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'Use data_configure_input_operator or data_configure_output_operator for input/output nodes'
      );
    }
    if (input.operatorType && input.operatorType !== node.type) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Operator type mismatch: node is ${node.type}, request is ${input.operatorType}`
      );
    }

    const parsed = parsePrepOperatorDsl(input.dsl, node.type);
    const errors = diagnosticsWithSeverity(parsed.diagnostics, 'error');
    if ((errors.length > 0 || !parsed.operator) && !input.dryRun) {
      throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(errors), {
        diagnostics: parsed.diagnostics,
      });
    }
    const nextWorkflow = parsed.operator
      ? updateWorkflowNode(workflow, input.nodeId, {
          label: parsed.operator.label ?? node.label,
          config: parsed.operator.config,
        })
      : toWorkflowSaveShape(workflow);

    return this.saveOrPreview(input.taskId, nextWorkflow, Boolean(input.dryRun), parsed.diagnostics);
  }

  async configureOutputOperator(input: ConfigureOutputOperatorCommand): Promise<WorkflowResult> {
    const workflow = await this.store.getTaskWorkflow(input.taskId);
    const node = findWorkflowNode(workflow, input.nodeId);
    if (node.type !== 'output') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow node is not an output operator: ${input.nodeId}`
      );
    }

    const mode = input.mode === 'append' ? 'append' : 'replace';
    let nextConfig: Record<string, unknown>;
    if (input.outputStrategy === 'auto' || (!input.outputTableId && input.outputTableName)) {
      const outputName = normalizeRequiredName(
        input.outputTableName ?? '',
        'Output table name is required for auto output'
      );
      nextConfig = {
        ...node.config,
        outputStrategy: 'auto',
        outputTableName: outputName,
        destination: 'duckdb_table',
        mode,
      };
    } else {
      const outputTableId = normalizeRequiredName(
        input.outputTableId ?? '',
        'Output table id is required'
      );
      const outputTable = await this.requireOutputTable(outputTableId);
      nextConfig = {
        ...node.config,
        outputStrategy: 'existing',
        outputDatasetId: outputTable.id,
        outputTableId: outputTable.id,
        outputTableName: outputTable.name,
        table: outputTable.tableName,
        destination: 'duckdb_table',
        mode,
      };
    }

    const nextWorkflow = updateWorkflowNode(workflow, input.nodeId, { config: nextConfig });
    return this.saveOrPreview(input.taskId, nextWorkflow, Boolean(input.dryRun));
  }

  async runTask(input: RunTaskCommand): Promise<RunTaskResult> {
    await this.requireTask(input.taskId);
    const outputMode = input.mode === 'persisted' ? 'persisted' : 'temporary';
    let compiled: { workflow: WorkflowSaveShape; diagnostics: PrepDiagnostic[] } | null = null;
    if (input.workflowDsl) {
      compiled = await this.compileWorkflowDsl(input.workflowDsl, {
        inputTableId: input.inputTableId,
        inputAlias: input.inputAlias,
        outputTableId: input.outputTableId,
      });
      const errors = diagnosticsWithSeverity(compiled.diagnostics, 'error');
      if (errors.length > 0) {
        throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(errors), {
          diagnostics: compiled.diagnostics,
        });
      }
      if (input.saveWorkflow) {
        await this.store.saveTaskWorkflow(input.taskId, compiled.workflow);
      }
    }

    const runInput: DataRunTaskInput = { outputMode };
    if (compiled && !input.saveWorkflow) {
      runInput.workflow = compiled.workflow;
    }

    try {
      const task = await this.store.runTask(input.taskId, runInput);
      const preview = await this.previewTaskOutput(
        input.taskId,
        task,
        input.previewRows,
        compiled?.workflow
      );
      return {
        task,
        preview,
        diagnostics: compiled?.diagnostics,
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async getRunResult(input: GetRunResultCommand): Promise<RunResult> {
    const task = await this.requireTask(input.taskId);
    const preview = await this.previewTaskOutput(input.taskId, task, input.previewRows, undefined, input.offset);
    return { task, preview };
  }

  private async compileWorkflowDsl(
    dsl: string,
    bindings: WorkflowResourceBindings = {}
  ): Promise<{
    workflow: WorkflowSaveShape;
    diagnostics: PrepDiagnostic[];
  }> {
    if (looksLikeJson(dsl)) {
      return {
        workflow: { nodes: [], edges: [] },
        diagnostics: [
          {
            severity: 'error',
            code: 'invalidDslFormat',
            message:
              'Workflow DSL must be text prep DSL, not JSON. Example: input source dataset "<inputTableId>" as src | derive [new_field] = expression | output table "Result" mode replace',
          },
        ],
      };
    }
    const parsed = parsePrepDsl(dsl);
    const diagnostics = [...parsed.diagnostics];
    if (!parsed.ast) {
      return { workflow: { nodes: [], edges: [] }, diagnostics };
    }
    const compiled = compilePrepWorkflowToFlow(parsed.ast);
    diagnostics.push(...compiled.diagnostics);
    const workflow = await this.applyWorkflowResourceBindings(
      {
        nodes: compiled.nodes,
        edges: compiled.edges,
      },
      bindings
    );
    return {
      workflow,
      diagnostics,
    };
  }

  private async applyWorkflowResourceBindings(
    workflow: WorkflowSaveShape,
    bindings: WorkflowResourceBindings
  ): Promise<WorkflowSaveShape> {
    let nodes = workflow.nodes.map((node) => ({ ...node, config: { ...(node.config ?? {}) } }));
    if (bindings.inputTableId) {
      const inputTable = await this.requireInputTable(bindings.inputTableId);
      const inputNode = nodes.find((node) => node.type === 'input_source');
      if (!inputNode) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Workflow has no input_source node to bind inputTableId'
        );
      }
      const alias =
        sanitizeAlias(bindings.inputAlias) ||
        stringConfigValue(inputNode.config?.alias) ||
        'src';
      nodes = nodes.map((node) =>
        node.id === inputNode.id
          ? {
              ...node,
              config: {
                ...(node.config ?? {}),
                source: 'dataset',
                datasetId: inputTable.id,
                inputTableName: inputTable.name,
                alias,
                dsl: `input source dataset "${escapeDslString(inputTable.id)}" as ${alias}`,
              },
            }
          : node
      );
    }

    if (bindings.outputTableId) {
      const outputTable = await this.requireOutputTable(bindings.outputTableId);
      const outputNode = nodes.find((node) => node.type === 'output');
      if (!outputNode) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Workflow has no output node to bind outputTableId'
        );
      }
      const mode = stringConfigValue(outputNode.config?.mode) || 'replace';
      nodes = nodes.map((node) =>
        node.id === outputNode.id
          ? {
              ...node,
              config: {
                ...(node.config ?? {}),
                outputStrategy: 'existing',
                outputDatasetId: outputTable.id,
                outputTableId: outputTable.id,
                outputTableName: outputTable.name,
                table: outputTable.tableName,
                destination: 'duckdb_table',
                mode,
                dsl: `output table "${escapeDslString(outputTable.name)}" mode ${mode}`,
              },
            }
          : node
      );
    }

    return { nodes, edges: workflow.edges };
  }

  private async saveOrPreview(
    taskId: string,
    workflow: WorkflowSaveShape,
    dryRun: boolean,
    diagnostics: PrepDiagnostic[] = []
  ): Promise<WorkflowResult> {
    if (dryRun) {
      return {
        workflow: await this.toWorkflowPreview(taskId, workflow),
        diagnostics,
        dryRun,
      };
    }
    return {
      workflow: await this.store.saveTaskWorkflow(taskId, workflow),
      diagnostics,
    };
  }

  private async toWorkflowPreview(
    taskId: string,
    workflow: WorkflowSaveShape
  ): Promise<DataTaskWorkflow> {
    const task = await this.requireTask(taskId);
    return {
      task,
      nodes: workflow.nodes.map((node): DataWorkflowNode => ({
        id: node.id,
        taskId,
        type: node.type,
        label: node.label,
        x: node.x,
        y: node.y,
        config: node.config ?? {},
        createdAt: 0,
        updatedAt: 0,
      })),
      edges: workflow.edges.map((edge): DataWorkflowEdge => ({
        id: edge.id,
        taskId,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourceHandle: edge.sourceHandle ?? 'output',
        targetHandle: edge.targetHandle ?? 'input',
        createdAt: 0,
      })),
    };
  }

  private async previewTaskOutput(
    taskId: string,
    task: DataCleaningTask,
    previewRows?: number,
    runtimeWorkflow?: WorkflowSaveShape,
    offset?: number
  ): Promise<DataInputTablePreview | undefined> {
    const limit = previewLimit(previewRows);
    if (task.sourceDatasetId) {
      try {
        return await this.previewDataset(task.sourceDatasetId, limit, offset);
      } catch {
        // Fall back to output node cache below.
      }
    }

    const runtimeOutputNode = runtimeWorkflow?.nodes.find((node) => node.type === 'output');
    if (runtimeOutputNode) {
      return this.store.previewWorkflowNode({
        taskId,
        nodeId: runtimeOutputNode.id,
        nodeType: runtimeOutputNode.type,
        nodeConfig: runtimeOutputNode.config,
        limit,
        offset,
      });
    }

    try {
      const workflow = await this.store.getTaskWorkflow(taskId);
      const outputNode = workflow.nodes.find((node) => node.type === 'output');
      if (outputNode) {
        return await this.store.previewWorkflowNode({
          taskId,
          nodeId: outputNode.id,
          nodeType: outputNode.type,
          nodeConfig: outputNode.config,
          limit,
          offset,
        });
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private async previewIfRequested(
    id: string,
    previewRows?: number
  ): Promise<DataInputTablePreview | undefined> {
    if (!previewRows || previewRows <= 0) {
      return undefined;
    }
    return this.previewDataset(id, previewRows);
  }

  private async previewDataset(
    id: string,
    limit?: number,
    offset?: number
  ): Promise<DataInputTablePreview> {
    return this.store.previewDataset({
      id,
      limit: previewLimit(limit),
      offset: previewOffset(offset),
    });
  }

  private async requireTask(id: string): Promise<DataCleaningTask> {
    const task = await this.store.getTaskRecord(id);
    if (!task) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Data task not found: ${id}`);
    }
    return task;
  }

  private async requireInputTable(id: string) {
    const inputTable = await this.store.getInputTableRecord(id);
    if (!inputTable) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Input table not found: ${id}`);
    }
    return inputTable;
  }

  private async requireOutputTable(id: string) {
    const outputTable = await this.store.getOutputTableRecord(id);
    if (!outputTable) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Output table not found: ${id}`);
    }
    return outputTable;
  }

  private async ensureUniqueInputTableName(name: string, excludeId?: string): Promise<void> {
    const existing = await this.findExactInputTableByName(name, excludeId);
    if (existing) {
      throw new DataCommandError('RESOURCE_ALREADY_EXISTS', `Input table already exists: ${name}`, {
        id: existing.id,
        name: existing.name,
      });
    }
  }

  private async ensureUniqueOutputTableName(name: string, excludeId?: string): Promise<void> {
    const result = await this.listOutputTables({ query: name, limit: MAX_LIST_LIMIT });
    const existing = result.outputTables.find(
      (item) => item.id !== excludeId && item.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      throw new DataCommandError('RESOURCE_ALREADY_EXISTS', `Output table already exists: ${name}`, {
        id: existing.id,
        name: existing.name,
      });
    }
  }

  private async ensureUniqueTaskName(name: string, excludeId?: string): Promise<void> {
    const result = await this.listTasks({ query: name, limit: MAX_LIST_LIMIT });
    const existing = result.tasks.find(
      (item) => item.id !== excludeId && item.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      throw new DataCommandError('RESOURCE_ALREADY_EXISTS', `Data task already exists: ${name}`, {
        id: existing.id,
        name: existing.name,
      });
    }
  }

  private async findExactInputTableByName(name: string, excludeId?: string) {
    const result = await this.listInputTables({ query: name, limit: MAX_LIST_LIMIT });
    return result.inputTables.find(
      (item) => item.id !== excludeId && item.name.toLowerCase() === name.toLowerCase()
    );
  }
}

function listWindow(
  limit: number | undefined,
  offset: number | undefined
): { limit: number; offset: number } {
  return {
    limit: clampInteger(limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT),
    offset: Math.max(0, Math.floor(Number(offset) || 0)),
  };
}

function previewLimit(limit: number | undefined): number {
  return clampInteger(limit, DEFAULT_PREVIEW_LIMIT, 1, MAX_PREVIEW_LIMIT);
}

function previewOffset(offset: number | undefined): number {
  return Math.max(0, Math.floor(Number(offset) || 0));
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(Number(value))));
}

function normalizeSourcePathInput(input: CreateInputTableCommand): string {
  const sourcePath = input.filePath || input.folderPath;
  if (!sourcePath?.trim()) {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      'filePath or folderPath is required to create an input table'
    );
  }
  return sourcePath.trim();
}

function normalizeOptionalName(name: string | undefined): string | undefined {
  const normalized = name?.trim();
  return normalized || undefined;
}

function normalizeRequiredName(name: string, message: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new DataCommandError('INVALID_ARGUMENT', message);
  }
  return normalized;
}

function findWorkflowNode(workflow: DataTaskWorkflow, nodeId: string): DataWorkflowNode {
  const node = workflow.nodes.find((item) => item.id === nodeId);
  if (!node) {
    const available = workflow.nodes
      .map((item) => `${item.id} (${item.type})`)
      .join(', ');
    throw new DataCommandError(
      'RESOURCE_NOT_FOUND',
      `Workflow node not found: ${nodeId}${
        available ? `. Available nodes: ${available}` : '. The workflow has no saved nodes.'
      }`
    );
  }
  return node;
}

function updateWorkflowNode(
  workflow: DataTaskWorkflow,
  nodeId: string,
  updates: Partial<Pick<DataWorkflowNodeInput, 'label' | 'config'>>
): DataWorkflowSaveInput {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: updates.label && node.id === nodeId ? updates.label : node.label,
      x: node.x,
      y: node.y,
      config: node.id === nodeId ? updates.config ?? node.config : node.config,
    })),
    edges: workflow.edges.map(toWorkflowEdgeInput),
  };
}

function toWorkflowSaveShape(workflow: DataTaskWorkflow): DataWorkflowSaveInput {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      x: node.x,
      y: node.y,
      config: node.config,
    })),
    edges: workflow.edges.map(toWorkflowEdgeInput),
  };
}

function toWorkflowEdgeInput(edge: DataWorkflowEdge): DataWorkflowEdgeInput {
  return {
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  };
}

function diagnosticsWithSeverity(
  diagnostics: PrepDiagnostic[],
  severity: PrepDiagnostic['severity']
): PrepDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === severity);
}

function summarizeDiagnostics(diagnostics: PrepDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return 'DSL validation failed';
  }
  return diagnostics
    .slice(0, 3)
    .map((diagnostic) => {
      const location =
        diagnostic.line || diagnostic.column
          ? ` at ${diagnostic.line ?? '?'}:${diagnostic.column ?? '?'}`
          : '';
      return `${diagnostic.code ?? diagnostic.severity}${location}: ${diagnostic.message}`;
    })
    .join('\n');
}

function sanitizeAlias(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized) ? normalized : '';
}

function escapeDslString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stringConfigValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function toCommandError(error: unknown, fallbackCode: DataCommandError['code']): DataCommandError {
  if (error instanceof DataCommandError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/source|file|folder|path|unsupported|does not exist/i.test(message) && fallbackCode === 'FILE_ACCESS_DENIED') {
    return new DataCommandError('FILE_ACCESS_DENIED', message);
  }
  if (/not found|does not exist|not exist/i.test(message)) {
    return new DataCommandError('RESOURCE_NOT_FOUND', message);
  }
  return new DataCommandError(fallbackCode, message || 'Data command failed');
}

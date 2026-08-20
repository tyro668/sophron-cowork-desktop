import {
  exportPrepWorkflowDsl,
  parsePrepOperatorDsl,
  type PrepDiagnostic,
} from '../../shared/prep-dsl';
import type { DataTaskStore } from './data-task-store';
import {
  DataCommandError,
  type ApplyOperatorDslCommand,
  type ApplyWorkflowDslCommand,
  type ConfigureInputOperatorCommand,
  type ConfigureOutputOperatorCommand,
  type ExportWorkflowDslCommand,
  type GetTaskWorkflowCommand,
  type TextResult,
  type WorkflowResult,
  type WorkflowSaveShape,
} from './data-command-types';
import { DataCommandLockCoordinator } from './data-command-lock-coordinator';
import { DataCommandResources } from './data-command-resources';
import {
  diagnosticsWithSeverity,
  escapeDslString,
  findWorkflowNode,
  normalizeRequiredName,
  sanitizeAlias,
  stringConfigValue,
  summarizeDiagnostics,
  toWorkflowSaveShape,
  updateWorkflowNode,
} from './data-command-utils';
import { WorkflowDslCompiler } from './workflow-dsl-compiler';
import { WorkflowPreviewService } from './workflow-preview-service';

export class WorkflowAuthoringCommandService {
  constructor(
    private readonly store: DataTaskStore,
    private readonly resources: DataCommandResources,
    private readonly locks: DataCommandLockCoordinator,
    private readonly compiler: WorkflowDslCompiler,
    private readonly preview: WorkflowPreviewService
  ) {}

  async getTaskWorkflow(input: GetTaskWorkflowCommand): Promise<WorkflowResult> {
    return { workflow: await this.store.getTaskWorkflow(input.taskId) };
  }

  async applyWorkflowDsl(input: ApplyWorkflowDslCommand): Promise<WorkflowResult> {
    return this.locks.withKeyedLock(`task:${input.taskId}`, () =>
      this.applyWorkflowDslUnlocked(input)
    );
  }

  async exportWorkflowDsl(input: ExportWorkflowDslCommand): Promise<TextResult> {
    const workflow = await this.store.getTaskWorkflow(input.taskId);
    return { text: exportPrepWorkflowDsl(workflow.nodes, workflow.edges) };
  }

  async configureInputOperator(input: ConfigureInputOperatorCommand): Promise<WorkflowResult> {
    return this.locks.withKeyedLock(`task:${input.taskId}`, () =>
      this.configureInputOperatorUnlocked(input)
    );
  }

  async applyOperatorDsl(input: ApplyOperatorDslCommand): Promise<WorkflowResult> {
    return this.locks.withKeyedLock(`task:${input.taskId}`, () =>
      this.applyOperatorDslUnlocked(input)
    );
  }

  async configureOutputOperator(input: ConfigureOutputOperatorCommand): Promise<WorkflowResult> {
    return this.locks.withKeyedLock(`task:${input.taskId}`, () =>
      this.configureOutputOperatorUnlocked(input)
    );
  }

  private async applyWorkflowDslUnlocked(input: ApplyWorkflowDslCommand): Promise<WorkflowResult> {
    await this.resources.requireTask(input.taskId);
    const compiled = await this.compiler.compileWorkflowDsl(input.dsl, {
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
        workflow: await this.preview.toWorkflowPreview(input.taskId, compiled.workflow),
        diagnostics: compiled.diagnostics,
        dryRun: true,
      };
    }
    return {
      workflow: await this.store.saveTaskWorkflow(input.taskId, compiled.workflow),
      diagnostics: compiled.diagnostics,
    };
  }

  private async configureInputOperatorUnlocked(
    input: ConfigureInputOperatorCommand
  ): Promise<WorkflowResult> {
    const workflow = await this.store.getTaskWorkflow(input.taskId);
    const inputTable = await this.resources.requireInputTable(input.inputTableId);
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

  private async applyOperatorDslUnlocked(input: ApplyOperatorDslCommand): Promise<WorkflowResult> {
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
    return this.saveOrPreview(
      input.taskId,
      nextWorkflow,
      Boolean(input.dryRun),
      parsed.diagnostics
    );
  }

  private async configureOutputOperatorUnlocked(
    input: ConfigureOutputOperatorCommand
  ): Promise<WorkflowResult> {
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
      const outputTable = await this.resources.requireOutputTable(outputTableId);
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
    return this.saveOrPreview(
      input.taskId,
      updateWorkflowNode(workflow, input.nodeId, { config: nextConfig }),
      Boolean(input.dryRun)
    );
  }

  private async saveOrPreview(
    taskId: string,
    workflow: WorkflowSaveShape,
    dryRun: boolean,
    diagnostics: PrepDiagnostic[] = []
  ): Promise<WorkflowResult> {
    if (dryRun) {
      return {
        workflow: await this.preview.toWorkflowPreview(taskId, workflow),
        diagnostics,
        dryRun,
      };
    }
    return { workflow: await this.store.saveTaskWorkflow(taskId, workflow), diagnostics };
  }
}

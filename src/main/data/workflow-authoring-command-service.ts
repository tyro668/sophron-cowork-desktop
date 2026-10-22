import { exportWorkflowJflow, parseJflowStep } from '../../shared/jflow';
import type { WorkflowDiagnostic } from '../../shared/workflow-diagnostics';
import { WORKFLOW_PLAN_VERSION, type WorkflowPlanDiagnostic } from '../../shared/workflow-plan';
import { WORKFLOW_OPERATOR_TYPE_SET, WORKFLOW_OPERATOR_TYPES } from './store/workflow-model';
import type { DataPipelineStore } from './data-pipeline-store';
import type { DataWorkflowOperatorType } from '../../shared/contracts';
import {
  DataCommandError,
  type ApplyOperatorDslCommand,
  type ApplyWorkflowDslCommand,
  type ApplyWorkflowPlanCommand,
  type ConfigureInputOperatorCommand,
  type ConfigureOutputOperatorCommand,
  type ExportWorkflowDslCommand,
  type GetPipelineWorkflowCommand,
  type GetWorkflowCapabilityManifestCommand,
  type TextResult,
  type WorkflowResult,
  type WorkflowSaveShape,
} from './data-command-types';
import { DataCommandLockCoordinator } from './data-command-lock-coordinator';
import { DataCommandResources } from './data-command-resources';
import {
  diagnosticsWithSeverity,
  findWorkflowNode,
  normalizeRequiredName,
  sanitizeAlias,
  stringConfigValue,
  summarizeDiagnostics,
  toWorkflowSaveShape,
  updateWorkflowNode,
} from './data-command-utils';
import { toWorkflowDiagnostic, WorkflowDslCompiler } from './workflow-dsl-compiler';

/** Workflow → jflow text; throws with the exporter's first error when a node is not expressible. */
export function exportWorkflowJflowText(
  workflow: Pick<WorkflowSaveShape, 'nodes' | 'edges'>,
  pipelineName?: string
): string {
  const exported = exportWorkflowJflow(
    workflow.nodes.map((node) => ({ ...node, config: node.config ?? {} })),
    workflow.edges,
    { pipelineName }
  );
  const error = exported.diagnostics.find((item) => item.severity === 'error');
  if (error) throw new DataCommandError('VALIDATION_FAILED', error.message);
  return exported.text;
}
import { WorkflowPreviewService } from './workflow-preview-service';
import { buildWorkflowCapabilityManifest } from './workflow/workflow-capability-manifest';

export class WorkflowAuthoringCommandService {
  constructor(
    private readonly store: DataPipelineStore,
    private readonly resources: DataCommandResources,
    private readonly locks: DataCommandLockCoordinator,
    private readonly compiler: WorkflowDslCompiler,
    private readonly preview: WorkflowPreviewService
  ) {}

  async getPipelineWorkflow(input: GetPipelineWorkflowCommand): Promise<WorkflowResult> {
    return { workflow: await this.store.getPipelineWorkflow(input.pipelineId) };
  }

  async getWorkflowCapabilityManifest(input: GetWorkflowCapabilityManifestCommand = {}) {
    const inputs = await Promise.all(
      (input.rawTableIds ?? []).map(async (id) => {
        const table = await this.resources.requireRawTable(id);
        const columns = await this.store.getTableColumnSnapshot(table.tableName);
        return {
          id: table.id,
          name: table.name,
          columns: columns.map((column) => ({ name: column.name, type: column.type })),
        };
      })
    );
    const outputs = await Promise.all(
      (input.resultTableIds ?? []).map(async (id) => {
        const table = await this.resources.requireResultTable(id);
        const columns = await this.store.getTableColumnSnapshot(table.tableName);
        return {
          id: table.id,
          name: table.name,
          physicalTable: table.tableName,
          columns: columns.map((column) => ({ name: column.name, type: column.type })),
        };
      })
    );
    return buildWorkflowCapabilityManifest({
      ...(input.rawTableIds?.length ? { inputs } : {}),
      ...(input.resultTableIds?.length ? { outputs } : {}),
    });
  }

  async applyWorkflowDsl(input: ApplyWorkflowDslCommand): Promise<WorkflowResult> {
    return this.locks.withKeyedLock(`pipeline:${input.pipelineId}`, () =>
      this.applyWorkflowDslUnlocked(input)
    );
  }

  async exportWorkflowDsl(input: ExportWorkflowDslCommand): Promise<TextResult> {
    const workflow = await this.store.getPipelineWorkflow(input.pipelineId);
    const pipeline = await this.resources.requirePipeline(input.pipelineId);
    return { text: exportWorkflowJflowText(workflow, pipeline.name) };
  }

  async configureInputOperator(input: ConfigureInputOperatorCommand): Promise<WorkflowResult> {
    return this.locks.withKeyedLock(`pipeline:${input.pipelineId}`, () =>
      this.configureInputOperatorUnlocked(input)
    );
  }

  async applyOperatorDsl(input: ApplyOperatorDslCommand): Promise<WorkflowResult> {
    return this.locks.withKeyedLock(`pipeline:${input.pipelineId}`, () =>
      this.applyOperatorDslUnlocked(input)
    );
  }

  async configureOutputOperator(input: ConfigureOutputOperatorCommand): Promise<WorkflowResult> {
    return this.locks.withKeyedLock(`pipeline:${input.pipelineId}`, () =>
      this.configureOutputOperatorUnlocked(input)
    );
  }

  async applyWorkflowPlan(input: ApplyWorkflowPlanCommand): Promise<WorkflowResult> {
    return this.locks.withKeyedLock(`pipeline:${input.pipelineId}`, () =>
      this.applyWorkflowPlanUnlocked(input)
    );
  }

  private async applyWorkflowPlanUnlocked(
    input: ApplyWorkflowPlanCommand
  ): Promise<WorkflowResult> {
    const pipeline = await this.resources.requirePipeline(input.pipelineId);
    const diagnostics: WorkflowPlanDiagnostic[] = [];
    const shape = normalizeSubmittedPlan(input.plan, diagnostics);
    if (!shape) {
      throw new DataCommandError('PLAN_VALIDATION_FAILED', summarizeDiagnostics(diagnostics), {
        diagnostics,
      });
    }
    const bound = await this.compiler.applyWorkflowResourceBindings(shape, {
      inputs: input.inputResources,
      resultTableId: input.resultTableId,
    });
    for (const node of bound.nodes) {
      if (node.type !== 'input') continue;
      const source = stringConfigValue(node.config?.source);
      if (source === 'rawTable' && !stringConfigValue(node.config?.rawTableId)) {
        diagnostics.push({
          severity: 'error',
          code: 'inputBindingMissing',
          message: `input source "${stringConfigValue(node.config?.alias) || node.id}" has source 'rawTable' but no bound table id — bind it via resources.inputs["${stringConfigValue(node.config?.alias) || node.id}"]`,
          nodeId: node.id,
        });
      }
      if (source === 'pipeline' && !pipeline.sourcePath) {
        diagnostics.push({
          severity: 'error',
          code: 'inputSourceMissing',
          message: `input source "${stringConfigValue(node.config?.alias) || node.id}" reads the pipeline source file but this pipeline has none`,
          nodeId: node.id,
        });
      }
    }
    // Config diagnostics come from validateWorkflowPlanForPipeline (the shared
    // preflight now includes them) — do not add them here a second time.
    diagnostics.push(
      ...(await this.store.validateWorkflowPlanForPipeline(input.pipelineId, bound))
    );
    const errors = diagnosticsWithSeverity(diagnostics, 'error');
    let dsl: string | undefined;
    if (errors.length === 0) {
      try {
        dsl = exportWorkflowJflowText(bound);
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code: 'dslExportFailed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const finalErrors = diagnosticsWithSeverity(diagnostics, 'error');
    if (finalErrors.length > 0 && !input.dryRun) {
      throw new DataCommandError('PLAN_VALIDATION_FAILED', summarizeDiagnostics(finalErrors), {
        diagnostics,
      });
    }
    if (input.dryRun) {
      return {
        workflow: await this.preview.toWorkflowPreview(input.pipelineId, bound),
        diagnostics,
        dryRun: true,
        dsl,
      };
    }
    return {
      workflow: await this.store.savePipelineWorkflow(input.pipelineId, bound),
      diagnostics,
      dsl,
    };
  }

  private async applyWorkflowDslUnlocked(input: ApplyWorkflowDslCommand): Promise<WorkflowResult> {
    await this.resources.requirePipeline(input.pipelineId);
    const compiled = await this.compiler.compileWorkflowDsl(input.dsl, {
      rawTableId: input.rawTableId,
      inputAlias: input.inputAlias,
      inputs: input.inputResources,
      resultTableId: input.resultTableId,
    });
    const planDiagnostics = await this.store.validateWorkflowPlanForPipeline(
      input.pipelineId,
      compiled.workflow
    );
    // compileWorkflowDsl already ran buildWorkflowPlan + graph rules — drop
    // exact repeats (same code/node/message) so repair loops see each issue once.
    const dedupKey = (item: {
      severity: string;
      code?: string;
      message: string;
      nodeId?: string;
    }) => `${item.severity}|${item.code ?? ''}|${item.nodeId ?? ''}|${item.message}`;
    const seen = new Set(compiled.diagnostics.map(dedupKey));
    const diagnostics = [
      ...compiled.diagnostics,
      ...planDiagnostics.filter((item) => !seen.has(dedupKey(item))),
    ];
    const errors = diagnosticsWithSeverity(diagnostics, 'error');
    if (errors.length > 0 && !input.dryRun) {
      throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(errors), {
        diagnostics,
      });
    }
    let dsl: string | undefined;
    if (errors.length === 0) {
      try {
        dsl = exportWorkflowJflowText(compiled.workflow);
      } catch {
        dsl = undefined;
      }
    }
    if (input.dryRun) {
      return {
        workflow: await this.preview.toWorkflowPreview(input.pipelineId, compiled.workflow),
        diagnostics,
        dryRun: true,
        dsl,
      };
    }
    return {
      workflow: await this.store.savePipelineWorkflow(input.pipelineId, compiled.workflow),
      diagnostics,
      dsl,
    };
  }

  private async configureInputOperatorUnlocked(
    input: ConfigureInputOperatorCommand
  ): Promise<WorkflowResult> {
    const workflow = await this.store.getPipelineWorkflow(input.pipelineId);
    const rawTable = await this.resources.requireRawTable(input.rawTableId);
    const node = findWorkflowNode(workflow, input.nodeId);
    if (node.type !== 'input') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow node is not an input operator: ${input.nodeId}`
      );
    }
    const alias = sanitizeAlias(input.alias) || stringConfigValue(node.config.alias) || 'source';
    const config = { ...node.config };
    delete config.incrementalBy;
    const nextWorkflow = updateWorkflowNode(workflow, input.nodeId, {
      config: {
        ...config,
        source: 'rawTable',
        rawTableId: rawTable.id,
        rawTableName: rawTable.name,
        alias,
        ref: { uri: `local:raw/${rawTable.id}`, name: rawTable.name },
      },
    });
    return this.saveOrPreview(input.pipelineId, nextWorkflow, Boolean(input.dryRun));
  }

  private async applyOperatorDslUnlocked(input: ApplyOperatorDslCommand): Promise<WorkflowResult> {
    const workflow = await this.store.getPipelineWorkflow(input.pipelineId);
    const node = findWorkflowNode(workflow, input.nodeId);
    if (node.type === 'input' || node.type === 'output') {
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
    const parsed = parseJflowStep(input.dsl, { expectedType: node.type });
    const stepDiagnostics = parsed.diagnostics.map(toWorkflowDiagnostic(input.dsl));
    const errors = diagnosticsWithSeverity(stepDiagnostics, 'error');
    if ((errors.length > 0 || !parsed.config) && !input.dryRun) {
      throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(errors), {
        diagnostics: stepDiagnostics,
      });
    }
    const nextWorkflow = parsed.config
      ? updateWorkflowNode(workflow, input.nodeId, { config: parsed.config })
      : toWorkflowSaveShape(workflow);
    return this.saveOrPreview(
      input.pipelineId,
      nextWorkflow,
      Boolean(input.dryRun),
      stepDiagnostics
    );
  }

  private async configureOutputOperatorUnlocked(
    input: ConfigureOutputOperatorCommand
  ): Promise<WorkflowResult> {
    const workflow = await this.store.getPipelineWorkflow(input.pipelineId);
    const node = findWorkflowNode(workflow, input.nodeId);
    if (node.type !== 'output') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow node is not an output operator: ${input.nodeId}`
      );
    }
    if (
      input.mode !== undefined &&
      input.mode !== 'replace' &&
      input.mode !== 'append' &&
      input.mode !== 'error_if_exists' &&
      input.mode !== 'merge'
    ) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Unsupported output mode "${input.mode}"; expected replace, append, error_if_exists, or merge`
      );
    }
    if (
      input.schemaPolicy !== undefined &&
      input.schemaPolicy !== 'extend' &&
      input.schemaPolicy !== 'strict' &&
      input.schemaPolicy !== 'ignore'
    ) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Unsupported output schema policy "${input.schemaPolicy}"; expected extend, strict, or ignore`
      );
    }
    const mergeKeys = (input.mergeKeys ?? [])
      .map((key) => String(key ?? '').trim())
      .filter((key) => key.length > 0);
    const mode = input.mode ?? 'replace';
    if (mode === 'merge' && mergeKeys.length === 0) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'Output mode "merge" requires mergeKeys business key columns'
      );
    }
    if (mode !== 'merge' && mergeKeys.length > 0) {
      throw new DataCommandError('VALIDATION_FAILED', 'mergeKeys are only valid with mode merge');
    }
    let nextConfig: Record<string, unknown>;
    if (input.outputStrategy === 'auto' || (!input.resultTableId && input.resultTableName)) {
      const outputName = normalizeRequiredName(
        input.resultTableName ?? '',
        'Output table name is required for auto output'
      );
      nextConfig = {
        ...node.config,
        outputStrategy: 'auto',
        resultTableName: outputName,
        destination: 'duckdb_table',
        mode,
        ...(mergeKeys.length > 0 ? { mergeKeys } : {}),
        ...(input.schemaPolicy ? { schemaPolicy: input.schemaPolicy } : {}),
      };
      if (mergeKeys.length === 0) delete nextConfig.mergeKeys;
      if (!input.schemaPolicy) delete nextConfig.schemaPolicy;
    } else {
      const resultTableId = normalizeRequiredName(
        input.resultTableId ?? '',
        'Output table id is required'
      );
      const resultTable = await this.resources.requireResultTable(resultTableId);
      nextConfig = {
        ...node.config,
        outputStrategy: 'existing',
        outputResultTableId: resultTable.id,
        resultTableId: resultTable.id,
        resultTableName: resultTable.name,
        table: resultTable.tableName,
        destination: 'duckdb_table',
        mode,
        ...(mergeKeys.length > 0 ? { mergeKeys } : {}),
        ...(input.schemaPolicy ? { schemaPolicy: input.schemaPolicy } : {}),
      };
      if (mergeKeys.length === 0) delete nextConfig.mergeKeys;
      if (!input.schemaPolicy) delete nextConfig.schemaPolicy;
    }
    return this.saveOrPreview(
      input.pipelineId,
      updateWorkflowNode(workflow, input.nodeId, { config: nextConfig }),
      Boolean(input.dryRun)
    );
  }

  private async saveOrPreview(
    pipelineId: string,
    workflow: WorkflowSaveShape,
    dryRun: boolean,
    diagnostics: WorkflowDiagnostic[] = []
  ): Promise<WorkflowResult> {
    if (dryRun) {
      return {
        workflow: await this.preview.toWorkflowPreview(pipelineId, workflow),
        diagnostics,
        dryRun,
      };
    }
    return { workflow: await this.store.savePipelineWorkflow(pipelineId, workflow), diagnostics };
  }
}

const PLAN_NODE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface SubmittedPlanEnvelope {
  version?: unknown;
  nodes?: unknown;
  edges?: unknown;
}

/**
 * Normalizes a submitted constrained plan into the workflow save shape.
 * Field names are strict: nodes carry {id,type,config}; edges carry
 * {sourceNodeId,targetNodeId,sourceHandle?,targetHandle?} (source/target
 * accepted as aliases). Every problem is a stable-coded diagnostic.
 */
function normalizeSubmittedPlan(
  plan: unknown,
  diagnostics: WorkflowDiagnostic[]
): WorkflowSaveShape | null {
  const envelope = (plan ?? {}) as SubmittedPlanEnvelope;
  if (envelope.version !== WORKFLOW_PLAN_VERSION) {
    diagnostics.push({
      severity: 'error',
      code: 'invalidPlanVersion',
      message: `plan.version must be "${WORKFLOW_PLAN_VERSION}" (got ${JSON.stringify(envelope.version)})`,
    });
    return null;
  }
  if (!Array.isArray(envelope.nodes) || !Array.isArray(envelope.edges)) {
    diagnostics.push({
      severity: 'error',
      code: 'invalidPlanShape',
      message: 'plan must contain nodes[] and edges[] arrays',
    });
    return null;
  }
  const nodes: WorkflowSaveShape['nodes'] = [];
  const seenIds = new Set<string>();
  envelope.nodes.forEach((raw, index) => {
    const node = (raw ?? {}) as Record<string, unknown>;
    const id = typeof node.id === 'string' ? node.id : '';
    const type = typeof node.type === 'string' ? node.type : '';
    if (!id || !PLAN_NODE_ID.test(id)) {
      diagnostics.push({
        severity: 'error',
        code: 'invalidPlanNodeId',
        message: `nodes[${index}].id must be a non-empty identifier (got ${JSON.stringify(node.id)})`,
      });
      return;
    }
    if (seenIds.has(id)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicatePlanNodeId',
        message: `Duplicate plan node id "${id}"`,
        nodeId: id,
      } as WorkflowDiagnostic);
      return;
    }
    seenIds.add(id);
    if (!WORKFLOW_OPERATOR_TYPE_SET.has(type)) {
      diagnostics.push({
        severity: 'error',
        code: 'unsupportedPlanNodeType',
        message: `nodes[${index}] (${id}) has unsupported type "${type}"; allowed: ${WORKFLOW_OPERATOR_TYPES.join(', ')}`,
      });
      return;
    }
    nodes.push({
      id,
      type: type as DataWorkflowOperatorType,
      label: typeof node.label === 'string' && node.label.trim() ? node.label : id,
      x: typeof node.x === 'number' ? node.x : 80 + (index % 4) * 240,
      y: typeof node.y === 'number' ? node.y : 80 + Math.floor(index / 4) * 140,
      config:
        node.config && typeof node.config === 'object' && !Array.isArray(node.config)
          ? (node.config as Record<string, unknown>)
          : {},
    });
  });
  const edges: WorkflowSaveShape['edges'] = [];
  envelope.edges.forEach((raw, index) => {
    const edge = (raw ?? {}) as Record<string, unknown>;
    const sourceNodeId =
      typeof edge.sourceNodeId === 'string'
        ? edge.sourceNodeId
        : typeof edge.source === 'string'
          ? edge.source
          : '';
    const targetNodeId =
      typeof edge.targetNodeId === 'string'
        ? edge.targetNodeId
        : typeof edge.target === 'string'
          ? edge.target
          : '';
    if (!sourceNodeId || !targetNodeId) {
      diagnostics.push({
        severity: 'error',
        code: 'invalidPlanEdge',
        message: `edges[${index}] needs sourceNodeId and targetNodeId (got ${JSON.stringify(raw)})`,
      });
      return;
    }
    edges.push({
      id:
        typeof edge.id === 'string' && edge.id
          ? edge.id
          : `edge_${sourceNodeId}_${targetNodeId}_${index}`,
      sourceNodeId,
      targetNodeId,
      sourceHandle: typeof edge.sourceHandle === 'string' ? edge.sourceHandle : null,
      targetHandle: typeof edge.targetHandle === 'string' ? edge.targetHandle : null,
    });
  });
  return diagnosticsWithSeverity(diagnostics, 'error').length > 0 ? null : { nodes, edges };
}

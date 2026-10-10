/** Staged plan validation shared by save, trial-run and DSL apply. */
import { resolveSqlQuerySchemas } from '../../workflow/sql-query-schemas';
import type { DataWorkflowSaveInput } from '../../../../shared/contracts';
import {
  buildWorkflowPlan,
  validateWorkflowPlanGraph,
  validateWorkflowPlanSchemas,
  PlanColumn,
  WorkflowPlanDiagnostic,
} from '../../../../shared/workflow-plan';
import { DataStoreContext } from '../data-store-context';
import { tableNameFromId } from '../data-store-records';
import { PipelineRepository } from '../repositories/pipeline-repository';
import { WorkflowBindingResolver } from './workflow-binding-resolver';
import { WorkflowCompiler } from './workflow-compiler';

export class WorkflowValidator {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly pipelines: PipelineRepository,
    private readonly compiler: WorkflowCompiler,
    private readonly binding: WorkflowBindingResolver
  ) {}
  /**
   * Staged plan validation shared by save, trial-run and DSL apply: builds the
   * typed workflow plan, runs the shared graph rules, resolves each input
   * source's columns, then propagates schemas to check field existence, type
   * compatibility, set-op alignment, pivot outputs and deterministic ordering.
   */
  async validateWorkflowPlanForPipeline(
    id: string,
    input: DataWorkflowSaveInput
  ): Promise<WorkflowPlanDiagnostic[]> {
    return this.ctx.runExclusive(async () => {
      await this.ctx.ensureReady();
      const pipeline = await this.pipelines.requirePipeline(id);
      const { plan, diagnostics } = buildWorkflowPlan(
        { nodes: input.nodes, edges: input.edges },
        { includeConfigDiagnostics: true }
      );
      diagnostics.push(...validateWorkflowPlanGraph(plan, { profile: 'pipeline' }));

      // Multiple sinks may not resolve to the same physical target table —
      // the second write would silently overwrite the first. Resolve via the
      // same path the commit uses so outputResultTableId and table-name configs
      // compare on equal terms; nodes whose config already failed validation
      // (e.g. bad mode) are skipped to avoid duplicate noise.
      const claimedOutputTargets = new Map<string, string>();
      const erroredNodeIds = new Set(
        diagnostics
          .filter((item) => item.severity === 'error' && item.nodeId)
          .map((item) => item.nodeId as string)
      );
      const outputNodes = plan.nodes.filter(
        (node) => node.type === 'output' && node.config?.disabled !== true
      );
      for (const [index, planNode] of outputNodes.entries()) {
        if (erroredNodeIds.has(planNode.id)) continue;
        const pipelineNode = input.nodes.find((node) => node.id === planNode.id);
        if (!pipelineNode) continue;
        try {
          const target = await this.binding.resolveWorkflowOutputTarget(
            pipelineNode,
            index === 0
              ? pipeline.resultTable || tableNameFromId('clean_pipeline', pipeline.id)
              : tableNameFromId('task_sink', `${pipeline.id}_${planNode.id}`)
          );
          const targetKey = target.tableName.toLowerCase();
          const claimant = claimedOutputTargets.get(targetKey);
          if (claimant) {
            diagnostics.push({
              severity: 'error',
              code: 'outputTargetDuplicate',
              message: `Output sinks ${claimant} and ${planNode.id} resolve to the same target table "${target.tableName}"`,
              nodeId: planNode.id,
              nodeType: planNode.type,
            });
          } else {
            claimedOutputTargets.set(targetKey, planNode.id);
          }
        } catch {
          // Resolution failures are already reported as config diagnostics.
        }
      }

      const inputSchemas = new Map<string, PlanColumn[]>();
      for (const node of plan.nodes) {
        if (node.type !== 'input_source') continue;
        const columns = await this.compiler.resolveInputSourceColumnTypes(
          {
            id: node.id,
            pipelineId: pipeline.id,
            type: 'input_source',
            label: node.label ?? '',
            x: node.x ?? 0,
            y: node.y ?? 0,
            config: node.config,
            createdAt: 0,
            updatedAt: 0,
          },
          pipeline.sourcePath
        );
        if (columns) inputSchemas.set(node.id, columns);
      }
      const sqlSchemas = await resolveSqlQuerySchemas(this.ctx.connection!, plan, inputSchemas);
      diagnostics.push(...sqlSchemas.diagnostics);
      diagnostics.push(
        ...validateWorkflowPlanSchemas(plan, (node) => sqlSchemas.resolved.get(node.id) ?? null)
      );
      return diagnostics;
    }, `validateWorkflowPlan:${id}`);
  }
}

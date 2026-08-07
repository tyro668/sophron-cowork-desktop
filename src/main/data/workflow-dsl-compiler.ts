import {
  compilePrepWorkflowToFlow,
  parsePrepDsl,
  type PrepDiagnostic,
} from '../../shared/prep-dsl';
import { DataCommandError, type WorkflowSaveShape } from './data-command-types';
import { DataCommandResources } from './data-command-resources';
import {
  cloneCompiledWorkflowCandidate,
  escapeDslString,
  hashText,
  looksLikeJson,
  sanitizeAlias,
  stringConfigValue,
  type CompiledWorkflowCandidate,
} from './data-command-utils';

const WORKFLOW_CANDIDATE_CACHE_LIMIT = 100;

export interface WorkflowResourceBindings {
  inputTableId?: string;
  inputAlias?: string;
  outputTableId?: string;
}

export class WorkflowDslCompiler {
  private readonly workflowCandidateCache = new Map<string, Promise<CompiledWorkflowCandidate>>();

  constructor(private readonly resources: DataCommandResources) {}

  async compileWorkflowDsl(
    dsl: string,
    bindings: WorkflowResourceBindings = {}
  ): Promise<{ workflow: WorkflowSaveShape; diagnostics: PrepDiagnostic[] }> {
    const cacheKey = hashText(JSON.stringify({ dsl, bindings }));
    const cached = this.workflowCandidateCache.get(cacheKey);
    if (cached) {
      this.workflowCandidateCache.delete(cacheKey);
      this.workflowCandidateCache.set(cacheKey, cached);
      return cloneCompiledWorkflowCandidate(await cached);
    }
    const candidatePromise = this.compileWorkflowDslUncached(dsl, bindings);
    this.workflowCandidateCache.set(cacheKey, candidatePromise);
    while (this.workflowCandidateCache.size > WORKFLOW_CANDIDATE_CACHE_LIMIT) {
      const oldestKey = this.workflowCandidateCache.keys().next().value;
      if (oldestKey) this.workflowCandidateCache.delete(oldestKey);
    }
    try {
      return cloneCompiledWorkflowCandidate(await candidatePromise);
    } catch (error) {
      this.workflowCandidateCache.delete(cacheKey);
      throw error;
    }
  }

  async applyWorkflowResourceBindings(
    workflow: WorkflowSaveShape,
    bindings: WorkflowResourceBindings
  ): Promise<WorkflowSaveShape> {
    let nodes = workflow.nodes.map((node) => ({ ...node, config: { ...(node.config ?? {}) } }));
    if (bindings.inputTableId) {
      const inputTable = await this.resources.requireInputTable(bindings.inputTableId);
      const inputNode = nodes.find((node) => node.type === 'input_source');
      if (!inputNode) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Workflow has no input_source node to bind inputTableId'
        );
      }
      const alias =
        sanitizeAlias(bindings.inputAlias) || stringConfigValue(inputNode.config?.alias) || 'src';
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
      const outputTable = await this.resources.requireOutputTable(bindings.outputTableId);
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

  private async compileWorkflowDslUncached(
    dsl: string,
    bindings: WorkflowResourceBindings
  ): Promise<CompiledWorkflowCandidate> {
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
    if (!parsed.ast) return { workflow: { nodes: [], edges: [] }, diagnostics };
    const compiled = compilePrepWorkflowToFlow(parsed.ast);
    diagnostics.push(...compiled.diagnostics);
    return {
      workflow: await this.applyWorkflowResourceBindings(
        { nodes: compiled.nodes, edges: compiled.edges },
        bindings
      ),
      diagnostics,
    };
  }
}

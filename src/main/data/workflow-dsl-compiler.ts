import type { WorkflowDiagnostic } from '../../shared/workflow-diagnostics';
import { jflowDiagnosticToWorkflow as toWorkflowDiagnostic } from '../../shared/jflow';
import { DataCommandError, type WorkflowSaveShape } from './data-command-types';
import { DataCommandResources } from './data-command-resources';
import type { DataPipelineStore } from './data-pipeline-store';
import { compileJflowAgainstStore } from './jflow-catalog';
import {
  cloneCompiledWorkflowCandidate,
  hashText,
  looksLikeJson,
  sanitizeAlias,
  stringConfigValue,
  type CompiledWorkflowCandidate,
} from './data-command-utils';

const WORKFLOW_CANDIDATE_CACHE_LIMIT = 100;

export interface WorkflowResourceBindings {
  /** Legacy single-source binding: binds the first (or `inputAlias`-matching) input node. */
  rawTableId?: string;
  inputAlias?: string;
  /**
   * Multi-source binding: `alias -> rawTableId`. Binds every input
   * node whose `config.alias` matches a key. Unknown aliases are rejected.
   */
  inputs?: Record<string, string>;
  resultTableId?: string;
}

export class WorkflowDslCompiler {
  private readonly workflowCandidateCache = new Map<string, Promise<CompiledWorkflowCandidate>>();

  constructor(
    private readonly resources: DataCommandResources,
    private readonly store: DataPipelineStore
  ) {}

  async compileWorkflowDsl(
    dsl: string,
    bindings: WorkflowResourceBindings = {}
  ): Promise<{ workflow: WorkflowSaveShape; diagnostics: WorkflowDiagnostic[] }> {
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
    const aliasBindings = new Map<string, string>();
    if (bindings.inputs) {
      for (const [alias, tableId] of Object.entries(bindings.inputs)) {
        const normalized = sanitizeAlias(alias);
        if (!normalized || typeof tableId !== 'string' || !tableId.trim()) {
          throw new DataCommandError(
            'VALIDATION_FAILED',
            `Invalid input resource binding ${JSON.stringify(alias)} -> ${JSON.stringify(tableId)}`
          );
        }
        aliasBindings.set(normalized, tableId.trim());
      }
    }
    // Legacy rawTableId binds inputAlias (when given) or the first input node.
    if (bindings.rawTableId) {
      const alias =
        sanitizeAlias(bindings.inputAlias) ||
        stringConfigValue(nodes.find((node) => node.type === 'input')?.config?.alias) ||
        'src';
      if (!aliasBindings.has(alias)) aliasBindings.set(alias, bindings.rawTableId);
    }

    if (aliasBindings.size > 0) {
      const inputNodes = nodes.filter((node) => node.type === 'input');
      if (inputNodes.length === 0) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Workflow has no input node to bind input resources'
        );
      }
      const knownAliases = new Set(
        inputNodes.map((node) => stringConfigValue(node.config?.alias)).filter(Boolean)
      );
      const unknown = [...aliasBindings.keys()].filter((alias) => !knownAliases.has(alias));
      if (unknown.length > 0) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          `Input resource aliases not found in workflow: ${unknown.join(', ')}. Available: ${[...knownAliases].join(', ') || '(none)'}`
        );
      }
      const bound = new Map<string, Awaited<ReturnType<DataCommandResources['requireRawTable']>>>();
      for (const [alias, tableId] of aliasBindings) {
        bound.set(alias, await this.resources.requireRawTable(tableId));
      }
      nodes = nodes.map((node) => {
        if (node.type !== 'input') return node;
        const alias = stringConfigValue(node.config?.alias);
        const table = alias ? bound.get(alias) : undefined;
        if (!table) return node;
        const config = { ...(node.config ?? {}) };
        return {
          ...node,
          config: {
            ...config,
            source: 'rawTable',
            rawTableId: table.id,
            rawTableName: table.name,
            alias,
            ref: { uri: `local:raw/${table.id}`, name: table.name },
          },
        };
      });
    }

    if (bindings.resultTableId) {
      const resultTable = await this.resources.requireResultTable(bindings.resultTableId);
      const outputNode = nodes.find((node) => node.type === 'output');
      if (!outputNode) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Workflow has no output node to bind resultTableId'
        );
      }
      const mode = stringConfigValue(outputNode.config?.mode) || 'replace';
      const mergeKeys = Array.isArray(outputNode.config?.mergeKeys)
        ? outputNode.config.mergeKeys
        : [];
      nodes = nodes.map((node) =>
        node.id === outputNode.id
          ? {
              ...node,
              config: {
                ...(node.config ?? {}),
                outputStrategy: 'existing',
                outputResultTableId: resultTable.id,
                resultTableId: resultTable.id,
                resultTableName: resultTable.name,
                table: resultTable.tableName,
                destination: 'duckdb_table',
                mode,
                ...(mergeKeys.length > 0 ? { mergeKeys } : {}),
                intent: 'bound',
                ref: { uri: `local:result/${resultTable.id}`, name: resultTable.name },
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
              "Workflow DSL must be jflow text, not JSON. Example: source src = @id('local:raw/<rawTableId>')\nsrc | derive [new_field] = [a] + 1 | write @new('Result')",
          },
        ],
      };
    }
    const compiled = await compileJflowAgainstStore(this.store, dsl);
    const diagnostics = compiled.diagnostics.map(toWorkflowDiagnostic(dsl));
    if (diagnostics.some((item) => item.severity === 'error')) {
      return { workflow: { nodes: [], edges: [] }, diagnostics };
    }
    return {
      workflow: await this.applyWorkflowResourceBindings(
        { nodes: compiled.nodes as WorkflowSaveShape['nodes'], edges: compiled.edges },
        bindings
      ),
      diagnostics,
    };
  }
}

export { toWorkflowDiagnostic };

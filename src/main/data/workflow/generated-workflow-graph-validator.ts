import type { DataWorkflowNodeInput, DataWorkflowSaveInput } from '../../../shared/contracts';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import {
  buildWorkflowPlan,
  validateWorkflowPlanGraph,
  type WorkflowPlanDiagnostic,
} from '../../../shared/workflow-plan';
import { compileFilterConditionExpression } from '../operators/filter';
import { validateGeneratedOperatorConfig } from './generated-operator-config-validator';
import { AI_GENERATED_WORKFLOW_NODE_TYPE_SET } from './prep-dsl-capability-profile';

export interface GeneratedWorkflowDiagnostic extends PrepDiagnostic {
  operationId?: string;
  operatorIndex?: number;
  operationType?: string;
  functionName?: string;
  start?: number;
  end?: number;
  nodeId?: string;
  nodeType?: string;
}

/**
 * Validates the executable platform graph emitted by the AI compiler.
 *
 * Structural graph rules (edges, handles, arity, cycles, reachability) are
 * delegated to the shared workflow-plan validator so human-authored DSL
 * workflows and generated plans are checked by one implementation. The
 * generated profile additionally enforces the conservative single-input,
 * allowlisted-node-type contract, and node configs go through the stricter
 * generated-config validator.
 */
export function validateGeneratedExecutableWorkflow(
  workflow: DataWorkflowSaveInput
): GeneratedWorkflowDiagnostic[] {
  const { plan } = buildWorkflowPlan(workflow, { includeConfigDiagnostics: false });
  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const diagnostics: GeneratedWorkflowDiagnostic[] = validateWorkflowPlanGraph(plan, {
    profile: 'generated',
    allowedNodeTypes: AI_GENERATED_WORKFLOW_NODE_TYPE_SET,
  }).map((item) => attachNodeContext(item, nodeById));

  for (const node of workflow.nodes) {
    diagnostics.push(...validateNodeConfig(node));
  }

  return diagnostics;
}

function attachNodeContext(
  item: WorkflowPlanDiagnostic,
  nodeById: Map<string, DataWorkflowNodeInput>
): GeneratedWorkflowDiagnostic {
  const node = item.nodeId ? nodeById.get(item.nodeId) : undefined;
  return node ? withNodeContext(item, node) : item;
}

function validateNodeConfig(node: DataWorkflowNodeInput): GeneratedWorkflowDiagnostic[] {
  const config = node.config ?? {};
  const diagnostics: GeneratedWorkflowDiagnostic[] = validateGeneratedOperatorConfig(
    node.type,
    config
  ).map((item) =>
    withNodeContext(
      {
        ...item,
        code: item.code || 'NODE_CONFIG_INVALID',
        params: { ...(item.params ?? {}), nodeId: node.id, nodeType: node.type },
      },
      node
    )
  );

  if (node.type === 'input_source') {
    const source = stringValue(config.source);
    const hasDataset = Boolean(stringValue(config.datasetId));
    const hasFile = Boolean(stringValue(config.filePath));
    if (
      !(source === 'task' || (source === 'dataset' && hasDataset) || (source === 'file' && hasFile))
    ) {
      diagnostics.push(
        diagnostic(
          'NODE_INPUT_CONFIG_INVALID',
          `Generated input node ${node.id} is not bound to an executable source`,
          node
        )
      );
    }
  } else if (node.type === 'output') {
    if (!stringValue(config.table) && !stringValue(config.outputTableName)) {
      diagnostics.push(
        diagnostic(
          'NODE_OUTPUT_CONFIG_INVALID',
          `Generated output node ${node.id} has no output table`,
          node
        )
      );
    }
  } else if (node.type === 'filter') {
    const condition = stringValue(config.condition);
    if (!condition) {
      diagnostics.push(
        diagnostic(
          'NODE_FILTER_CONDITION_MISSING',
          `Generated filter node ${node.id} has no condition`,
          node
        )
      );
    } else {
      try {
        compileFilterConditionExpression(condition);
      } catch (error) {
        diagnostics.push(
          diagnostic(
            'NODE_FILTER_CONDITION_INVALID',
            `Generated filter node ${node.id} has an invalid condition: ${
              error instanceof Error ? error.message : String(error)
            }`,
            node
          )
        );
      }
    }
  } else if (node.type === 'calculate_field') {
    const calculations = Array.isArray(config.calculations) ? config.calculations : [];
    if (calculations.length === 0) {
      diagnostics.push(
        diagnostic(
          'NODE_CALCULATION_MISSING',
          `Generated calculate_field node ${node.id} has no calculations`,
          node
        )
      );
    }
    calculations.forEach((value, index) => {
      if (!isRecord(value) || !stringValue(value.field) || !stringValue(value.expression)) {
        diagnostics.push(
          diagnostic(
            'NODE_CALCULATION_INVALID',
            `Generated calculate_field node ${node.id} has an invalid calculation at index ${index}`,
            node
          )
        );
      }
    });
  }

  return diagnostics;
}

function diagnostic(
  code: string,
  message: string,
  node?: DataWorkflowNodeInput
): GeneratedWorkflowDiagnostic {
  const base: PrepDiagnostic = {
    severity: 'error',
    code,
    message,
    params: node ? { nodeId: node.id, nodeType: node.type } : undefined,
  };
  return node ? withNodeContext(base, node) : base;
}

function withNodeContext<T extends PrepDiagnostic>(
  diagnostic: T,
  node: DataWorkflowNodeInput
): T & GeneratedWorkflowDiagnostic {
  const origin = isRecord(node.config?.generatedOrigin) ? node.config.generatedOrigin : undefined;
  return {
    ...diagnostic,
    nodeId: node.id,
    nodeType: node.type,
    ...(origin
      ? {
          operationId: optionalString(origin.operationId),
          operatorIndex: optionalNumber(origin.operatorIndex),
          operationType: optionalString(origin.operationType),
          functionName: optionalString(origin.functionName),
          start: optionalNumber(origin.start),
          end: optionalNumber(origin.end),
          line: optionalNumber(origin.line),
          column: optionalNumber(origin.column),
        }
      : {}),
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

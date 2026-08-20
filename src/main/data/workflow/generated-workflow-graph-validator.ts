import type { DataWorkflowNodeInput, DataWorkflowSaveInput } from '../../../renderer/types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
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
 * This deliberately validates only the conservative single-input, linear/DAG
 * subset advertised to the generation model. The platform editor may support
 * richer graphs; generated workflows must not rely on those capabilities until
 * they are explicitly certified end to end.
 */
export function validateGeneratedExecutableWorkflow(
  workflow: DataWorkflowSaveInput
): GeneratedWorkflowDiagnostic[] {
  const diagnostics: GeneratedWorkflowDiagnostic[] = [];
  const nodeById = new Map<string, DataWorkflowNodeInput>();

  for (const node of workflow.nodes) {
    if (!node.id.trim()) {
      diagnostics.push(
        diagnostic('NODE_ID_MISSING', 'Generated workflow contains an unnamed node')
      );
      continue;
    }
    if (nodeById.has(node.id)) {
      diagnostics.push(
        diagnostic(
          'NODE_ID_DUPLICATE',
          `Generated workflow contains duplicate node id: ${node.id}`,
          node
        )
      );
      continue;
    }
    nodeById.set(node.id, node);
    if (!AI_GENERATED_WORKFLOW_NODE_TYPE_SET.has(node.type)) {
      diagnostics.push(
        diagnostic(
          'NODE_TYPE_UNSUPPORTED',
          `Generated workflow uses unsupported node type: ${node.type}`,
          node
        )
      );
      continue;
    }
    diagnostics.push(...validateNodeConfig(node));
  }

  const inputNodes = workflow.nodes.filter((node) => node.type === 'input_source');
  const outputNodes = workflow.nodes.filter((node) => node.type === 'output');
  if (inputNodes.length !== 1) {
    diagnostics.push(
      diagnostic(
        'NODE_GRAPH_INPUT_COUNT',
        `Generated workflow must contain exactly one input_source node; received ${inputNodes.length}`
      )
    );
  }
  if (outputNodes.length !== 1) {
    diagnostics.push(
      diagnostic(
        'NODE_GRAPH_OUTPUT_COUNT',
        `Generated workflow must contain exactly one output node; received ${outputNodes.length}`
      )
    );
  }

  const incoming = new Map<string, typeof workflow.edges>();
  const outgoing = new Map<string, typeof workflow.edges>();
  for (const edge of workflow.edges) {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    if (!source || !target) {
      diagnostics.push(
        diagnostic(
          'NODE_GRAPH_DANGLING_EDGE',
          `Generated workflow edge ${edge.id} references an unknown node`
        )
      );
      continue;
    }
    if (source.id === target.id) {
      diagnostics.push(
        diagnostic(
          'NODE_GRAPH_SELF_CYCLE',
          `Generated workflow node ${source.id} connects to itself`,
          source
        )
      );
    }
    const sourceHandle = edge.sourceHandle ?? 'output';
    if (sourceHandle !== 'output') {
      diagnostics.push(
        diagnostic(
          'NODE_GRAPH_SOURCE_HANDLE_INVALID',
          `Generated workflow edge ${edge.id} uses invalid source handle: ${sourceHandle}`,
          source
        )
      );
    }
    const targetHandle = edge.targetHandle ?? 'input';
    const expectedHandles =
      target.type === 'join' || target.type === 'set_op' ? ['left', 'right'] : ['input'];
    if (!expectedHandles.includes(targetHandle)) {
      diagnostics.push(
        diagnostic(
          'NODE_GRAPH_TARGET_HANDLE_INVALID',
          `Generated workflow edge ${edge.id} uses ${targetHandle}; ${target.type} expects ${expectedHandles.join(' or ')}`,
          target
        )
      );
    }
    incoming.set(target.id, [...(incoming.get(target.id) ?? []), edge]);
    outgoing.set(source.id, [...(outgoing.get(source.id) ?? []), edge]);
  }

  for (const node of workflow.nodes) {
    const nodeIncoming = incoming.get(node.id) ?? [];
    const nodeOutgoing = outgoing.get(node.id) ?? [];
    if (node.type === 'input_source') {
      if (nodeIncoming.length !== 0) {
        diagnostics.push(
          diagnostic(
            'NODE_GRAPH_INPUT_HAS_INCOMING',
            `Input node ${node.id} must not have incoming edges`,
            node
          )
        );
      }
    } else if (node.type === 'join' || node.type === 'set_op') {
      for (const handle of ['left', 'right']) {
        const count = nodeIncoming.filter(
          (edge) => (edge.targetHandle ?? 'input') === handle
        ).length;
        if (count !== 1) {
          diagnostics.push(
            diagnostic(
              'NODE_GRAPH_BINARY_INPUT_INVALID',
              `${node.type} node ${node.id} must have exactly one ${handle} input; received ${count}`,
              node
            )
          );
        }
      }
    } else if (nodeIncoming.length !== 1) {
      diagnostics.push(
        diagnostic(
          'NODE_GRAPH_INPUT_INVALID',
          `Generated ${node.type} node ${node.id} must have exactly one input; received ${nodeIncoming.length}`,
          node
        )
      );
    }

    if (node.type === 'output') {
      if (nodeOutgoing.length !== 0) {
        diagnostics.push(
          diagnostic(
            'NODE_GRAPH_OUTPUT_HAS_OUTGOING',
            `Output node ${node.id} must not have outgoing edges`,
            node
          )
        );
      }
    } else if (nodeOutgoing.length === 0) {
      diagnostics.push(
        diagnostic(
          'NODE_GRAPH_DISCONNECTED',
          `Generated node ${node.id} does not lead to the output`,
          node
        )
      );
    }
  }

  const input = inputNodes[0];
  if (input) {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (nodeId: string): void => {
      if (visiting.has(nodeId)) {
        diagnostics.push(
          diagnostic(
            'NODE_GRAPH_CYCLE',
            `Generated workflow contains a cycle at node: ${nodeId}`,
            nodeById.get(nodeId)
          )
        );
        return;
      }
      if (visited.has(nodeId)) return;
      visiting.add(nodeId);
      for (const edge of outgoing.get(nodeId) ?? []) visit(edge.targetNodeId);
      visiting.delete(nodeId);
      visited.add(nodeId);
    };
    visit(input.id);
    for (const node of workflow.nodes) {
      if (!visited.has(node.id)) {
        diagnostics.push(
          diagnostic(
            'NODE_GRAPH_UNREACHABLE',
            `Generated node ${node.id} is not reachable from the input`,
            node
          )
        );
      }
    }
  }

  return diagnostics;
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

function withNodeContext(
  diagnostic: PrepDiagnostic,
  node: DataWorkflowNodeInput
): GeneratedWorkflowDiagnostic {
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

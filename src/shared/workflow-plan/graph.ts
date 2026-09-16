import type { WorkflowPlan, WorkflowPlanDiagnostic, WorkflowPlanNode } from './model';

export type WorkflowPlanProfile = 'task' | 'generated';

export interface WorkflowPlanGraphOptions {
  /**
   * `generated` enforces the conservative single-input, allowlisted-node
   * profile advertised to the generation model. `task` applies the platform
   * rules: multi-source inputs are allowed and orphan/disconnected nodes are
   * reported as warnings rather than save-blocking errors.
   */
  profile: WorkflowPlanProfile;
  allowedNodeTypes?: ReadonlySet<string>;
}

const BINARY_INPUT_TYPES = new Set(['join', 'set_op']);

/**
 * Structural graph validation shared by the Prep DSL compiler, the task
 * editor save path, and the generated-workflow validator. Codes are stable:
 * the generated profile relies on the NODE_* diagnostics contract.
 */
export function validateWorkflowPlanGraph(
  plan: WorkflowPlan,
  options: WorkflowPlanGraphOptions
): WorkflowPlanDiagnostic[] {
  const generated = options.profile === 'generated';
  const diagnostics: WorkflowPlanDiagnostic[] = [];
  const nodeById = new Map<string, WorkflowPlanNode>();

  for (const node of plan.nodes) {
    if (!node.id.trim()) {
      diagnostics.push(diagnostic('NODE_ID_MISSING', 'Workflow contains an unnamed node', node));
      continue;
    }
    if (nodeById.has(node.id)) {
      diagnostics.push(
        diagnostic('NODE_ID_DUPLICATE', `Workflow contains duplicate node id: ${node.id}`, node)
      );
      continue;
    }
    nodeById.set(node.id, node);
    if (options.allowedNodeTypes && !options.allowedNodeTypes.has(node.type)) {
      diagnostics.push(
        diagnostic(
          'NODE_TYPE_UNSUPPORTED',
          `Workflow uses unsupported node type: ${node.type}`,
          node
        )
      );
    }
  }

  const inputNodes = plan.nodes.filter((node) => node.type === 'input_source');
  const outputNodes = plan.nodes.filter((node) => node.type === 'output');
  if (generated && inputNodes.length !== 1) {
    diagnostics.push(
      diagnostic(
        'NODE_GRAPH_INPUT_COUNT',
        `Generated workflow must contain exactly one input_source node; received ${inputNodes.length}`
      )
    );
  }
  if (inputNodes.length === 0) {
    diagnostics.push(
      diagnostic(
        generated ? 'NODE_GRAPH_INPUT_COUNT' : 'PLAN_GRAPH_NO_INPUT',
        'Workflow has no input_source node',
        undefined,
        // Task workflows may draft without an input source; generated ones cannot.
        generated ? 'error' : 'warning'
      )
    );
  }
  if (generated && outputNodes.length !== 1) {
    diagnostics.push(
      diagnostic(
        'NODE_GRAPH_OUTPUT_COUNT',
        `Generated workflow must contain exactly one output node; received ${outputNodes.length}`
      )
    );
  }
  if (!generated && outputNodes.length === 0) {
    // Task runs fall back to the terminal data node when no sink exists.
    diagnostics.push(
      diagnostic('PLAN_GRAPH_NO_OUTPUT', 'Workflow has no output node', undefined, 'warning')
    );
  }

  const incoming = new Map<string, WorkflowPlan['edges']>();
  const outgoing = new Map<string, WorkflowPlan['edges']>();
  for (const edge of plan.edges) {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    if (!source || !target) {
      diagnostics.push(
        diagnostic(
          'NODE_GRAPH_DANGLING_EDGE',
          `Workflow edge ${edge.id} references an unknown node`
        )
      );
      continue;
    }
    if (source.id === target.id) {
      diagnostics.push(
        diagnostic('NODE_GRAPH_SELF_CYCLE', `Workflow node ${source.id} connects to itself`, source)
      );
    }
    const sourceHandle = edge.sourceHandle ?? 'output';
    const allowedSourceHandles = source.type === 'expect' ? ['output', 'reject'] : ['output'];
    if (!allowedSourceHandles.includes(sourceHandle)) {
      diagnostics.push(
        diagnostic(
          'NODE_GRAPH_SOURCE_HANDLE_INVALID',
          `Workflow edge ${edge.id} uses invalid source handle: ${sourceHandle}`,
          source
        )
      );
    }
    const targetHandle = edge.targetHandle ?? 'input';
    const expectedHandles = BINARY_INPUT_TYPES.has(target.type) ? ['left', 'right'] : ['input'];
    if (!expectedHandles.includes(targetHandle)) {
      diagnostics.push(
        diagnostic(
          'NODE_GRAPH_TARGET_HANDLE_INVALID',
          `Workflow edge ${edge.id} uses ${targetHandle}; ${target.type} expects ${expectedHandles.join(' or ')}`,
          target
        )
      );
    }
    incoming.set(target.id, [...(incoming.get(target.id) ?? []), edge]);
    outgoing.set(source.id, [...(outgoing.get(source.id) ?? []), edge]);
  }

  for (const node of plan.nodes) {
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
    } else if (BINARY_INPUT_TYPES.has(node.type)) {
      const isolated = nodeIncoming.length === 0 && nodeOutgoing.length === 0;
      for (const handle of ['left', 'right']) {
        const count = nodeIncoming.filter(
          (edge) => (edge.targetHandle ?? 'input') === handle
        ).length;
        if (count !== 1 && (generated || !isolated)) {
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
      const isolated = nodeIncoming.length === 0 && nodeOutgoing.length === 0;
      if (generated || !isolated) {
        diagnostics.push(
          diagnostic(
            'NODE_GRAPH_INPUT_INVALID',
            `${node.type} node ${node.id} must have exactly one input; received ${nodeIncoming.length}`,
            node
          )
        );
      }
    }

    if (node.type === 'expect') {
      const hasRejectStream =
        typeof node.config?.rejectStream === 'string' && node.config.rejectStream.trim() !== '';
      const hasRejectEdge = nodeOutgoing.some(
        (edge) => (edge.sourceHandle ?? 'output') === 'reject'
      );
      if (hasRejectStream && !hasRejectEdge) {
        diagnostics.push(
          diagnostic(
            'NODE_GRAPH_REJECT_STREAM_UNCONSUMED',
            `Expect node ${node.id} declares reject stream "${String(node.config.rejectStream)}" but no edge consumes it`,
            node,
            'warning'
          )
        );
      }
      if (!hasRejectStream && hasRejectEdge) {
        diagnostics.push(
          diagnostic(
            'NODE_GRAPH_REJECT_STREAM_MISSING',
            `Expect node ${node.id} has a reject edge but no reject stream is configured`,
            node
          )
        );
      }
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
          `Node ${node.id} does not lead to the output`,
          node,
          generated ? 'error' : 'warning'
        )
      );
    }
  }

  for (const input of inputNodes) {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (nodeId: string): void => {
      if (visiting.has(nodeId)) {
        diagnostics.push(
          diagnostic(
            'NODE_GRAPH_CYCLE',
            `Workflow contains a cycle at node: ${nodeId}`,
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
    if (generated) {
      for (const node of plan.nodes) {
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
  }

  return diagnostics;
}

function diagnostic(
  code: string,
  message: string,
  node?: WorkflowPlanNode,
  severity: WorkflowPlanDiagnostic['severity'] = 'error'
): WorkflowPlanDiagnostic {
  return {
    severity,
    code,
    message,
    params: node ? { nodeId: node.id, nodeType: node.type } : undefined,
    nodeId: node?.id,
    nodeType: node?.type,
  };
}

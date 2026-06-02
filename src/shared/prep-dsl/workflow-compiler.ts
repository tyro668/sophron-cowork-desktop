import type {
  PrepDiagnostic,
  PrepOperatorAst,
  PrepWorkflowAst,
  PrepWorkflowCompileResult,
  PrepWorkflowEdgeInput,
  PrepWorkflowNodeInput,
} from './ast';
import { validatePrepWorkflow } from './validator';

export function compilePrepWorkflowToFlow(ast: PrepWorkflowAst): PrepWorkflowCompileResult {
  const diagnostics: PrepDiagnostic[] = validatePrepWorkflow(ast);
  const nodes: PrepWorkflowNodeInput[] = [];
  const edges: PrepWorkflowEdgeInput[] = [];
  const sourceIds = new Map<string, string>();

  for (const source of ast.sources) {
    const alias = getAlias(source) ?? `source_${nodes.length + 1}`;
    const id = makeNodeId('source', alias);
    sourceIds.set(alias, id);
    nodes.push(toNode(source, id, nodes.length));
  }

  let currentId = sourceIds.get(ast.mainSource) ?? nodes[0]?.id ?? '';
  ast.operators.forEach((operator, index) => {
    const id = makeNodeId(operator.type, String(index + 1));
    nodes.push(toNode(operator, id, nodes.length));
    if (operator.type === 'join' || operator.type === 'set_op') {
      edges.push({
        id: `edge_${currentId}_${id}_left`,
        sourceNodeId: currentId,
        targetNodeId: id,
        sourceHandle: 'output',
        targetHandle: 'left',
      });
      const rightInput = operator.config.rightInput;
      const rightId = typeof rightInput === 'string' ? sourceIds.get(rightInput) : undefined;
      if (rightId) {
        edges.push({
          id: `edge_${rightId}_${id}_right`,
          sourceNodeId: rightId,
          targetNodeId: id,
          sourceHandle: 'output',
          targetHandle: 'right',
        });
      }
    } else if (currentId) {
      edges.push({
        id: `edge_${currentId}_${id}`,
        sourceNodeId: currentId,
        targetNodeId: id,
        sourceHandle: 'output',
        targetHandle: 'input',
      });
    }
    currentId = id;
  });

  if (ast.output) {
    const id = makeNodeId('output', 'result');
    nodes.push(toNode(ast.output, id, nodes.length));
    if (currentId) {
      edges.push({
        id: `edge_${currentId}_${id}`,
        sourceNodeId: currentId,
        targetNodeId: id,
        sourceHandle: 'output',
        targetHandle: 'input',
      });
    }
  }

  return { nodes, edges, diagnostics };
}

function toNode(operator: PrepOperatorAst, id: string, index: number): PrepWorkflowNodeInput {
  return {
    id,
    type: operator.type,
    label: operator.label ?? operator.type,
    x: 64 + (index % 4) * 150,
    y: 72 + Math.floor(index / 4) * 64,
    config: operator.config,
  };
}

function getAlias(source: PrepOperatorAst): string | null {
  const alias = source.config.alias;
  return typeof alias === 'string' ? alias : null;
}

function makeNodeId(prefix: string, key: string): string {
  return `${prefix}_${key}`.replace(/[^A-Za-z0-9_]/g, '_');
}

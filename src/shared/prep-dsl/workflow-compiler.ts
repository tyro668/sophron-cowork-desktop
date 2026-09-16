import type {
  PrepDiagnostic,
  PrepOperatorAst,
  PrepWorkflowAst,
  PrepWorkflowCompileResult,
  PrepWorkflowEdgeInput,
  PrepWorkflowNodeInput,
} from './ast';
import { validatePrepWorkflow } from './validator';
import { buildWorkflowPlan } from '../workflow-plan/build';
import { validateWorkflowPlanGraph } from '../workflow-plan/graph';

/**
 * Lowers the workflow AST into canvas nodes+edges. Every `step` becomes a
 * chain: the step's input stream feeds the first operator, each operator feeds
 * the next, and `output` operators terminate the chain into sink nodes. Step
 * names give stable node ids (`<step>_<seq>`) and are written back into the
 * stream-producing node's config as `stepName` so export can reuse them.
 */
export function compilePrepWorkflowToFlow(ast: PrepWorkflowAst): PrepWorkflowCompileResult {
  const diagnostics: PrepDiagnostic[] = validatePrepWorkflow(ast);
  const nodes: PrepWorkflowNodeInput[] = [];
  const edges: PrepWorkflowEdgeInput[] = [];
  interface StreamProducer {
    nodeId: string;
    handle: 'output' | 'reject';
  }
  const producerByName = new Map<string, StreamProducer>();

  for (const source of ast.sources) {
    const alias = getAlias(source) ?? `source_${nodes.length + 1}`;
    const id = makeNodeId('source', alias);
    producerByName.set(alias.toLowerCase(), { nodeId: id, handle: 'output' });
    nodes.push(toNode(source, id, nodes.length));
  }

  const edgeFrom = (producer: StreamProducer, targetId: string, targetHandle: string) => ({
    id: `edge_${producer.nodeId}${producer.handle === 'reject' ? '_reject' : ''}_${targetId}_${targetHandle}`,
    sourceNodeId: producer.nodeId,
    targetNodeId: targetId,
    sourceHandle: producer.handle,
    targetHandle,
  });

  let previousStepName = ast.mainSource;
  for (const step of ast.steps) {
    const inputRef = step.input ?? previousStepName;
    let tail = inputRef ? (producerByName.get(inputRef.toLowerCase()) ?? undefined) : undefined;
    previousStepName = step.name;

    let stepOutputNodeId = '';
    let sinkSeq = 0;
    step.operators.forEach((operator, index) => {
      const isOutput = operator.type === 'output';
      sinkSeq += isOutput ? 1 : 0;
      const id = isOutput
        ? makeNodeId('output', sinkSeq > 1 ? `${step.name}_${sinkSeq}` : step.name)
        : makeNodeId(step.name, String(index + 1));
      nodes.push(toNode(operator, id, nodes.length));
      if (!isOutput) stepOutputNodeId = id;

      if (operator.type === 'join' || operator.type === 'set_op') {
        if (tail) edges.push(edgeFrom(tail, id, 'left'));
        const rightRef =
          typeof operator.config.rightInput === 'string' ? operator.config.rightInput : '';
        const rightProducer = rightRef ? producerByName.get(rightRef.toLowerCase()) : undefined;
        if (rightProducer) edges.push(edgeFrom(rightProducer, id, 'right'));
      } else if (tail) {
        edges.push(edgeFrom(tail, id, 'input'));
      }
      tail = { nodeId: id, handle: 'output' };

      // `expect ... reject to <stream>` registers the reject stream produced by
      // this node's `reject` handle so later steps can consume it.
      if (operator.type === 'expect') {
        const rejectStream =
          typeof operator.config.rejectStream === 'string'
            ? operator.config.rejectStream.trim()
            : '';
        if (rejectStream) {
          const key = rejectStream.toLowerCase();
          if (producerByName.has(key)) {
            diagnostics.push({
              severity: 'error',
              code: 'duplicateStepName',
              message: `Duplicate step or source name: ${rejectStream}`,
              params: { alias: rejectStream },
            });
          } else {
            producerByName.set(key, { nodeId: id, handle: 'reject' });
          }
        }
      }
    });

    // A step's stream binds to its last data operator; a pure-sink step
    // aliases its input stream (never the output node itself).
    producerByName.set(
      step.name.toLowerCase(),
      stepOutputNodeId
        ? { nodeId: stepOutputNodeId, handle: 'output' }
        : ((inputRef ? producerByName.get(inputRef.toLowerCase()) : undefined) ?? {
            nodeId: '',
            handle: 'output',
          })
    );
    // Persist authored step names on the stream's producing node so export
    // keeps the chain boundary; anonymous/implicit chains stay unmarked.
    if (step.named && stepOutputNodeId) {
      const node = nodes.find((item) => item.id === stepOutputNodeId);
      if (node) node.config = { ...(node.config ?? {}), stepName: step.name };
    }
  }

  for (const output of ast.outputs) {
    const destination = output.config.destination;
    if (destination === 'dataset' || destination === 'file') {
      diagnostics.push({
        severity: 'error',
        code: 'unsupportedOutputDestination',
        message: `Output destination "${destination}" is not supported in task workflows; use "output table" instead`,
        params: { value: String(destination) },
      });
    }
  }

  const { plan, diagnostics: planDiagnostics } = buildWorkflowPlan({ nodes, edges });
  diagnostics.push(...planDiagnostics);
  diagnostics.push(...validateWorkflowPlanGraph(plan, { profile: 'task' }));

  return { nodes, edges, diagnostics, plan };
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

import type {
  DataAutomationColumnSnapshot,
  DataAutomationLineageEntry,
  DataWorkflowEdgeInput,
  DataWorkflowNodeInput,
} from '../../../shared/contracts';
import { DataCommandError } from '../data-command-types';
import { DEFAULT_OPERATOR_LABELS } from '../store/workflow-model';
import { validateGeneratedOperatorConfig } from './generated-operator-config-validator';
import type {
  GeneratedWorkflowIrSemantics,
  GeneratedWorkflowOperationOrigin,
  GeneratedWorkflowPlatformOperatorDraft,
} from './workflow-model';

export interface WorkflowNodeCompilerBindings {
  inputTableId: string;
  inputAlias?: string;
  inputTableName?: string;
  outputTableName: string;
  outputTableId?: string;
  outputPhysicalTableName?: string;
  outputMode?: 'replace';
}

export interface GeneratedWorkflowOperationNodeOrigin extends GeneratedWorkflowOperationOrigin {
  nodeId: string;
  nodeType: GeneratedWorkflowPlatformOperatorDraft['type'];
}

export interface CompiledGeneratedWorkflowNodePlan {
  nodes: DataWorkflowNodeInput[];
  edges: DataWorkflowEdgeInput[];
  requiredColumns: Array<{ name: string; type?: string }>;
  expectedOutputSchema: DataAutomationColumnSnapshot[];
  lineage: DataAutomationLineageEntry[];
  operationNodeOrigins: GeneratedWorkflowOperationNodeOrigin[];
}

/**
 * Deterministically assembles an already-lowered AI semantic plan into the platform's native graph.
 *
 * Semantic lowering happens exactly once before this boundary. This compiler only binds
 * resources, validates node configs, assigns graph identity/layout, and connects edges.
 */
export function compileLoweredWorkflowToPlatformNodes({
  semantics,
  bindings,
}: {
  semantics: GeneratedWorkflowIrSemantics;
  bindings: WorkflowNodeCompilerBindings;
}): CompiledGeneratedWorkflowNodePlan {
  const inputTableId = requireBinding(bindings.inputTableId, 'inputTableId');
  const outputTableName = requireBinding(bindings.outputTableName, 'outputTableName');
  const inputAlias = sanitizeAlias(bindings.inputAlias) || 'src';
  const outputMode = 'replace';
  const originsByOperatorIndex = new Map(
    semantics.operationOrigins.map((origin) => [origin.operatorIndex, origin] as const)
  );

  semantics.platformOperators.forEach((operator, operatorIndex) =>
    assertValidLoweredOperator(operator, operatorIndex, originsByOperatorIndex.get(operatorIndex))
  );

  const sourceNode: DataWorkflowNodeInput = {
    id: makeNodeId('source', inputAlias),
    type: 'input_source',
    label: DEFAULT_OPERATOR_LABELS.input_source,
    ...nodePosition(0),
    config: withoutUndefinedProperties({
      source: 'dataset',
      datasetId: inputTableId,
      inputTableName: bindings.inputTableName,
      alias: inputAlias,
    }),
  };

  const operatorNodes = semantics.platformOperators.map((operator, operatorIndex) => {
    const origin = originsByOperatorIndex.get(operatorIndex);
    const nodeId = makeNodeId(operator.type, String(operatorIndex + 1));
    const generatedOrigin: GeneratedWorkflowOperationNodeOrigin | undefined = origin
      ? { ...origin, nodeId, nodeType: operator.type }
      : undefined;
    return {
      id: nodeId,
      type: operator.type,
      label: DEFAULT_OPERATOR_LABELS[operator.type],
      ...nodePosition(operatorIndex + 1),
      config: {
        ...operator.config,
        ...(generatedOrigin ? { generatedOrigin } : {}),
      },
    } satisfies DataWorkflowNodeInput;
  });

  const outputNode: DataWorkflowNodeInput = {
    id: makeNodeId('output', 'result'),
    type: 'output',
    label: DEFAULT_OPERATOR_LABELS.output,
    ...nodePosition(operatorNodes.length + 1),
    config: withoutUndefinedProperties({
      destination: 'duckdb_table',
      table: bindings.outputPhysicalTableName ?? outputTableName,
      mode: outputMode,
      outputStrategy: bindings.outputTableId ? 'existing' : undefined,
      outputDatasetId: bindings.outputTableId,
      outputTableId: bindings.outputTableId,
      outputTableName,
    }),
  };

  const nodes = [sourceNode, ...operatorNodes, outputNode];
  const edges = nodes.slice(1).map(
    (node, index): DataWorkflowEdgeInput => ({
      id: `edge_${nodes[index].id}_${node.id}`,
      sourceNodeId: nodes[index].id,
      targetNodeId: node.id,
      sourceHandle: 'output',
      targetHandle: 'input',
    })
  );
  const operationNodeOrigins = semantics.operationOrigins.flatMap((origin) => {
    const node = operatorNodes[origin.operatorIndex];
    return node ? [{ ...origin, nodeId: node.id, nodeType: node.type }] : [];
  });

  return {
    nodes,
    edges,
    requiredColumns: semantics.requiredColumns,
    expectedOutputSchema: semantics.expectedOutputSchema,
    lineage: semantics.lineage,
    operationNodeOrigins,
  };
}

function assertValidLoweredOperator(
  operator: GeneratedWorkflowPlatformOperatorDraft,
  operatorIndex: number,
  origin?: GeneratedWorkflowOperationOrigin
): void {
  const nodeId = makeNodeId(operator.type, String(operatorIndex + 1));
  const diagnostics = validateGeneratedOperatorConfig(operator.type, operator.config)
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => ({
      ...diagnostic,
      ...(origin ?? {}),
      nodeId,
      nodeType: operator.type,
    }));
  if (diagnostics.length === 0) return;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated workflow operator ${operatorIndex + 1} (${operator.type}) has invalid config: ${diagnostics
      .map((diagnostic) => diagnostic.message)
      .join('; ')}`,
    { diagnostics }
  );
}

function nodePosition(index: number): { x: number; y: number } {
  return {
    x: 64 + (index % 4) * 150,
    y: 72 + Math.floor(index / 4) * 64,
  };
}

function makeNodeId(prefix: string, key: string): string {
  return `${prefix}_${key}`.replace(/[^A-Za-z0-9_]/g, '_');
}

function sanitizeAlias(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  return /^[_\p{L}][_\p{L}\p{N}]*$/u.test(normalized) ? normalized : '';
}

function requireBinding(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized) return normalized;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Workflow node compiler requires a non-empty ${name} binding`
  );
}

function withoutUndefinedProperties(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
}

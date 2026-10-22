import type { DataWorkflowOperatorType } from '../../../shared/contracts';
import type { WorkflowExpressionIr, WorkflowOperationIr } from './workflow-model';

export const AI_PREP_DSL_RUNTIME_PROFILE_VERSION = 'platform-node-runtime-compat/v3' as const;

export type AiPrepDslExpressionContext =
  'filter' | 'derive' | 'derive_window' | 'aggregate' | 'pivot';
export type AiPrepDslExpressionLowering = 'direct' | 'materialize_filter_predicate';

type WorkflowIrOperationType = WorkflowOperationIr['type'];
type AiPrepDslOperationNodeType = Exclude<
  DataWorkflowOperatorType,
  'input' | 'join' | 'set_op' | 'output'
>;

export interface AiPrepDslOperationCapability {
  irType: WorkflowIrOperationType;
  nodeType: AiPrepDslOperationNodeType;
  emittedNodeTypes: readonly AiPrepDslOperationNodeType[];
  aiEnabled: boolean;
  lowering: 'direct' | 'recipe';
  runtimeContract: string;
}

/**
 * AI-owned compatibility profile for the existing platform node and SQL runtime.
 *
 * This is intentionally a conservative subset and does not redefine the Prep
 * DSL parser, node model, or SQL runtime. Every entry must be covered by black-box contract
 * tests through the generated IR -> native nodes -> DuckDB execution path.
 */
export const AI_PREP_DSL_OPERATION_CAPABILITIES = {
  filter: {
    irType: 'filter',
    nodeType: 'filter',
    emittedNodeTypes: ['filter', 'derive', 'select'],
    aiEnabled: true,
    lowering: 'recipe',
    runtimeContract:
      'Simple predicates lower directly; predicates containing casts or function calls are materialized through derive -> filter -> select except.',
  },
  sort: {
    irType: 'sort',
    nodeType: 'sort',
    emittedNodeTypes: ['sort'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Sort by one or more resolved columns with direction and null ordering.',
  },
  select: {
    irType: 'select',
    nodeType: 'select',
    emittedNodeTypes: ['select'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract:
      'Include (selection include) or exclude (selection exclude) existing columns through the select node.',
  },
  rename: {
    irType: 'rename',
    nodeType: 'rename',
    emittedNodeTypes: ['rename'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Rename one existing column and use the new name in later operations.',
  },
  derive: {
    irType: 'derive',
    nodeType: 'derive',
    emittedNodeTypes: ['derive', 'select', 'rename'],
    aiEnabled: true,
    lowering: 'recipe',
    runtimeContract:
      'Emit a calculate-field expression from the allowlisted expression IR; same-name replacement uses temporary derive/select-except/rename steps.',
  },
  derive_window: {
    irType: 'derive_window',
    nodeType: 'derive',
    emittedNodeTypes: ['derive', 'select', 'rename'],
    aiEnabled: true,
    lowering: 'recipe',
    runtimeContract:
      'Lower certified aggregate, ranking, value and offset windows with structured frames into calculate-field OVER expressions.',
  },
  cast: {
    irType: 'cast',
    nodeType: 'cast',
    emittedNodeTypes: ['cast', 'derive', 'select', 'rename'],
    aiEnabled: true,
    lowering: 'recipe',
    runtimeContract:
      'Use the native cast node for direct conversions and a derive/select-except/rename recipe for cleanup or decimal scaling.',
  },
  aggregate: {
    irType: 'aggregate',
    nodeType: 'aggregate',
    emittedNodeTypes: ['aggregate'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract:
      'Group by resolved columns and emit certified scalar aggregate metrics with validated literal parameters.',
  },
  deduplicate: {
    irType: 'deduplicate',
    nodeType: 'deduplicate',
    emittedNodeTypes: ['deduplicate'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract:
      'Deduplicate by resolved columns with optional deterministic ordering and keep-first or keep-last policy.',
  },
  missing_value: {
    irType: 'missing_value',
    nodeType: 'missing_value',
    emittedNodeTypes: ['missing_value'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract:
      'Use row dropping, literal fill, textual-sentinel cleanup, statistical fills, or forward/backward fills through validated by-column rules.',
  },
  limit: {
    irType: 'limit',
    nodeType: 'limit',
    emittedNodeTypes: ['limit'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract:
      'Use global fixed rows/percent, supported ties variants, or validated random sampling options. Per-group limits remain unavailable until the platform node contract supports them.',
  },
  pivot: {
    irType: 'pivot',
    nodeType: 'pivot',
    emittedNodeTypes: ['pivot'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract:
      'Use one pivot field with fixed non-empty values and one or more certified scalar metrics for deterministic output.',
  },
  unpivot: {
    irType: 'unpivot',
    nodeType: 'unpivot',
    emittedNodeTypes: ['unpivot'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Unpivot resolved compatible columns into name and value columns.',
  },
  unnest: {
    irType: 'unnest',
    nodeType: 'unnest',
    emittedNodeTypes: ['unnest'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract:
      'Expand a native list or JSON-array string into rows, with optional index, parent-name prefix, JSON path, and stable source ordering. JSON-object-to-columns remains platform-only because its output schema is data-dependent.',
  },
} as const satisfies {
  [T in WorkflowIrOperationType]: AiPrepDslOperationCapability & { irType: T };
};

const AI_GENERATED_WORKFLOW_BOUNDARY_NODE_TYPES = [
  'input',
  'output',
] as const satisfies readonly DataWorkflowOperatorType[];

/**
 * Platform node types that may occur in an AI-generated executable graph.
 *
 * Keep this derived from enabled capabilities so recipes cannot emit a node
 * that the generated-graph trust boundary has not explicitly certified.
 */
export const AI_GENERATED_WORKFLOW_NODE_TYPES: readonly DataWorkflowOperatorType[] = [
  ...AI_GENERATED_WORKFLOW_BOUNDARY_NODE_TYPES,
  ...new Set<DataWorkflowOperatorType>(
    Object.values(AI_PREP_DSL_OPERATION_CAPABILITIES).flatMap((capability) =>
      capability.aiEnabled ? capability.emittedNodeTypes : []
    )
  ),
];

export const AI_GENERATED_WORKFLOW_NODE_TYPE_SET: ReadonlySet<DataWorkflowOperatorType> = new Set(
  AI_GENERATED_WORKFLOW_NODE_TYPES
);

export function getAiPrepDslOperationCapability(
  type: WorkflowIrOperationType
): AiPrepDslOperationCapability {
  return AI_PREP_DSL_OPERATION_CAPABILITIES[type];
}

export function isAiPrepDslOperationEnabled(type: WorkflowIrOperationType): boolean {
  return getAiPrepDslOperationCapability(type).aiEnabled;
}

/**
 * The existing filter runtime accepts a deliberately smaller expression
 * grammar than calculate-field. Keep simple predicates direct and route richer
 * predicates through a boolean calculate-field, followed by a simple filter.
 */
export function getAiPrepDslExpressionLowering(
  expression: WorkflowExpressionIr,
  context: AiPrepDslExpressionContext
): AiPrepDslExpressionLowering {
  if (context !== 'filter') return 'direct';
  return filterExpressionNeedsMaterialization(expression)
    ? 'materialize_filter_predicate'
    : 'direct';
}

function filterExpressionNeedsMaterialization(expression: WorkflowExpressionIr): boolean {
  switch (expression.kind) {
    case 'column':
    case 'literal':
      return false;
    case 'cast':
    case 'function':
      return true;
    case 'unary':
      return filterExpressionNeedsMaterialization(expression.value);
    case 'binary':
      return (
        expression.op === 'contains' ||
        expression.op === 'not_contains' ||
        filterExpressionNeedsMaterialization(expression.left) ||
        filterExpressionNeedsMaterialization(expression.right)
      );
  }
}

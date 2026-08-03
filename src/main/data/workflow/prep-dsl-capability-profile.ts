import type { DataWorkflowOperatorType } from '../../../renderer/types';
import type { WorkflowExpressionIr, WorkflowOperationIr } from './workflow-model';

export const AI_PREP_DSL_RUNTIME_PROFILE_VERSION = 'platform-node-runtime-compat/v2' as const;

export type AiPrepDslExpressionContext = 'filter' | 'derive' | 'aggregate' | 'pivot';
export type AiPrepDslExpressionLowering = 'direct' | 'materialize_filter_predicate';

type WorkflowIrOperationType = WorkflowOperationIr['type'];
type AiPrepDslOperationNodeType = Exclude<
  DataWorkflowOperatorType,
  'input_source' | 'join' | 'set_op' | 'output'
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
    emittedNodeTypes: ['filter', 'calculate_field', 'field_select'],
    aiEnabled: true,
    lowering: 'recipe',
    runtimeContract:
      'Simple predicates lower directly; predicates containing casts or function calls are materialized through derive -> filter -> drop.',
  },
  sort: {
    irType: 'sort',
    nodeType: 'sort',
    emittedNodeTypes: ['sort'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Sort by one resolved column in ascending or descending order.',
  },
  drop: {
    irType: 'drop',
    nodeType: 'field_select',
    emittedNodeTypes: ['field_select'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Exclude existing columns through the field-select node.',
  },
  select: {
    irType: 'select',
    nodeType: 'field_select',
    emittedNodeTypes: ['field_select'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Include existing columns through the field-select node.',
  },
  rename: {
    irType: 'rename',
    nodeType: 'field_mapping',
    emittedNodeTypes: ['field_mapping'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Rename one existing column and use the new name in later operations.',
  },
  derive: {
    irType: 'derive',
    nodeType: 'calculate_field',
    emittedNodeTypes: ['calculate_field', 'field_select', 'field_mapping'],
    aiEnabled: true,
    lowering: 'recipe',
    runtimeContract:
      'Emit a calculate-field expression from the allowlisted expression IR; same-name replacement uses temporary derive/drop/map steps.',
  },
  convert_type: {
    irType: 'convert_type',
    nodeType: 'type_convert',
    emittedNodeTypes: ['type_convert', 'calculate_field', 'field_select', 'field_mapping'],
    aiEnabled: true,
    lowering: 'recipe',
    runtimeContract:
      'Use the native cast node for direct conversions and a derive/drop/map recipe for cleanup or decimal scaling.',
  },
  aggregate: {
    irType: 'aggregate',
    nodeType: 'aggregate',
    emittedNodeTypes: ['aggregate'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Group by resolved columns and emit allowlisted aggregate metrics.',
  },
  deduplicate: {
    irType: 'deduplicate',
    nodeType: 'deduplicate',
    emittedNodeTypes: ['deduplicate'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract:
      'Deduplicate by resolved columns with optional deterministic ordering; only keep-first is certified.',
  },
  missing_value: {
    irType: 'missing_value',
    nodeType: 'missing_value',
    emittedNodeTypes: ['missing_value'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Use only drop-empty-rows or validated by-column missing-value rules.',
  },
  limit: {
    irType: 'limit',
    nodeType: 'limit',
    emittedNodeTypes: ['limit'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Use validated fixed/percent limits or top-N with ordering.',
  },
  pivot: {
    irType: 'pivot',
    nodeType: 'pivot',
    emittedNodeTypes: ['pivot'],
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract:
      'Use one pivot field, fixed non-empty values and one metric for deterministic output.',
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
    runtimeContract: 'Unnest a resolved list or JSON column using validated options.',
  },
} as const satisfies {
  [T in WorkflowIrOperationType]: AiPrepDslOperationCapability & { irType: T };
};

const AI_GENERATED_WORKFLOW_BOUNDARY_NODE_TYPES = [
  'input_source',
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

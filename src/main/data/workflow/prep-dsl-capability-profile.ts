import type { WorkflowExpressionIr, WorkflowOperationIr } from './workflow-model';

export const AI_PREP_DSL_RUNTIME_PROFILE_VERSION = 'prep-runtime-compat/v1' as const;

export type AiPrepDslExpressionContext = 'filter' | 'derive' | 'aggregate' | 'pivot';
export type AiPrepDslExpressionLowering = 'direct' | 'materialize_filter_predicate';

type WorkflowOperationType = WorkflowOperationIr['type'];

export interface AiPrepDslOperationCapability {
  irType: WorkflowOperationType;
  nodeType:
    | 'filter'
    | 'sort'
    | 'field_select'
    | 'field_mapping'
    | 'calculate_field'
    | 'type_convert'
    | 'aggregate'
    | 'deduplicate'
    | 'missing_value'
    | 'limit'
    | 'pivot'
    | 'unpivot'
    | 'unnest';
  aiEnabled: boolean;
  lowering: 'direct' | 'recipe';
  runtimeContract: string;
}

/**
 * AI-owned compatibility profile for the existing Prep DSL runtime.
 *
 * This is intentionally a conservative subset and does not redefine the Prep
 * DSL parser or SQL runtime. Every entry must be covered by black-box contract
 * tests through the existing DSL -> nodes -> DuckDB execution path.
 */
export const AI_PREP_DSL_OPERATION_CAPABILITIES = {
  filter: {
    irType: 'filter',
    nodeType: 'filter',
    aiEnabled: true,
    lowering: 'recipe',
    runtimeContract:
      'Simple predicates lower directly; predicates containing casts or function calls are materialized through derive -> filter -> drop.',
  },
  sort: {
    irType: 'sort',
    nodeType: 'sort',
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Sort by one resolved column in ascending or descending order.',
  },
  drop: {
    irType: 'drop',
    nodeType: 'field_select',
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Exclude existing columns through the field-select node.',
  },
  select: {
    irType: 'select',
    nodeType: 'field_select',
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Include existing columns through the field-select node.',
  },
  rename: {
    irType: 'rename',
    nodeType: 'field_mapping',
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Rename one existing column and use the new name in later operations.',
  },
  derive: {
    irType: 'derive',
    nodeType: 'calculate_field',
    aiEnabled: true,
    lowering: 'recipe',
    runtimeContract:
      'Emit a calculate-field expression from the allowlisted expression IR; same-name replacement uses temporary derive/drop/map steps.',
  },
  convert_type: {
    irType: 'convert_type',
    nodeType: 'type_convert',
    aiEnabled: true,
    lowering: 'recipe',
    runtimeContract:
      'Use the native cast node for direct conversions and a derive/drop/map recipe for cleanup or decimal scaling.',
  },
  aggregate: {
    irType: 'aggregate',
    nodeType: 'aggregate',
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Group by resolved columns and emit allowlisted aggregate metrics.',
  },
  deduplicate: {
    irType: 'deduplicate',
    nodeType: 'deduplicate',
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Deduplicate by resolved columns with optional deterministic ordering.',
  },
  missing_value: {
    irType: 'missing_value',
    nodeType: 'missing_value',
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Use only drop-empty-rows or validated by-column missing-value rules.',
  },
  limit: {
    irType: 'limit',
    nodeType: 'limit',
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Use validated fixed/percent limits or top-N with ordering.',
  },
  pivot: {
    irType: 'pivot',
    nodeType: 'pivot',
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract:
      'Use one pivot field, fixed non-empty values and one metric for deterministic output.',
  },
  unpivot: {
    irType: 'unpivot',
    nodeType: 'unpivot',
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Unpivot resolved compatible columns into name and value columns.',
  },
  unnest: {
    irType: 'unnest',
    nodeType: 'unnest',
    aiEnabled: true,
    lowering: 'direct',
    runtimeContract: 'Unnest a resolved list or JSON column using validated options.',
  },
} as const satisfies {
  [T in WorkflowOperationType]: AiPrepDslOperationCapability & { irType: T };
};

export function getAiPrepDslOperationCapability(
  type: WorkflowOperationType
): AiPrepDslOperationCapability {
  return AI_PREP_DSL_OPERATION_CAPABILITIES[type];
}

export function isAiPrepDslOperationEnabled(type: WorkflowOperationType): boolean {
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

export type WorkflowAggregateArgumentType = 'any' | 'numeric';
export type WorkflowAggregateResultType = 'same_as_input' | 'integer' | 'decimal';

export interface WorkflowAggregateFunctionDefinition {
  /** Compatibility spellings accepted at the IR boundary, never advertised to new authors. */
  aliases: readonly string[];
  acceptsStar: boolean;
  argumentType: WorkflowAggregateArgumentType;
  resultType: WorkflowAggregateResultType;
}

/**
 * Canonical aggregate contract shared by JavaScript authoring and Workflow IR
 * validation. Keys deliberately match the existing Prep DSL/SQL function
 * spellings so downstream lowering never needs to guess at an alias.
 */
export const WORKFLOW_AGGREGATE_FUNCTION_REGISTRY = {
  sum: {
    aliases: [],
    acceptsStar: false,
    argumentType: 'numeric',
    resultType: 'same_as_input',
  },
  avg: {
    aliases: [],
    acceptsStar: false,
    argumentType: 'numeric',
    resultType: 'decimal',
  },
  min: {
    aliases: [],
    acceptsStar: false,
    argumentType: 'any',
    resultType: 'same_as_input',
  },
  max: {
    aliases: [],
    acceptsStar: false,
    argumentType: 'any',
    resultType: 'same_as_input',
  },
  count: {
    aliases: [],
    acceptsStar: true,
    argumentType: 'any',
    resultType: 'integer',
  },
  count_distinct: {
    aliases: ['countDistinct'],
    acceptsStar: false,
    argumentType: 'any',
    resultType: 'integer',
  },
} as const satisfies Record<string, WorkflowAggregateFunctionDefinition>;

export type WorkflowAggregateFunctionName = keyof typeof WORKFLOW_AGGREGATE_FUNCTION_REGISTRY;

export const WORKFLOW_AGGREGATE_FUNCTION_NAMES = new Set<string>(
  Object.keys(WORKFLOW_AGGREGATE_FUNCTION_REGISTRY)
);

const WORKFLOW_AGGREGATE_FUNCTION_ALIASES = new Map<string, WorkflowAggregateFunctionName>(
  Object.entries(WORKFLOW_AGGREGATE_FUNCTION_REGISTRY).flatMap(([canonicalName, definition]) =>
    definition.aliases.map(
      (alias) => [alias, canonicalName as WorkflowAggregateFunctionName] as const
    )
  )
);

export function normalizeWorkflowAggregateFunction(
  value: unknown
): WorkflowAggregateFunctionName | undefined {
  if (typeof value !== 'string') return undefined;
  if (WORKFLOW_AGGREGATE_FUNCTION_NAMES.has(value)) {
    return value as WorkflowAggregateFunctionName;
  }
  return WORKFLOW_AGGREGATE_FUNCTION_ALIASES.get(value);
}

export function getWorkflowAggregateFunctionDefinition(
  value: unknown
): WorkflowAggregateFunctionDefinition | undefined {
  const canonicalName = normalizeWorkflowAggregateFunction(value);
  return canonicalName ? WORKFLOW_AGGREGATE_FUNCTION_REGISTRY[canonicalName] : undefined;
}

export function getWorkflowAggregateFunctionTypeScriptType(): string {
  return Object.keys(WORKFLOW_AGGREGATE_FUNCTION_REGISTRY)
    .map((name) => JSON.stringify(name))
    .join(' | ');
}

export function getWorkflowAggregateCapabilityPrompt(): string {
  const names = Object.keys(WORKFLOW_AGGREGATE_FUNCTION_REGISTRY).join(', ');
  return `Canonical aggregate functions: ${names}. Only count may use "*"; every other aggregate requires expr(row => row["field"]). Use count_distinct, never countDistinct.`;
}

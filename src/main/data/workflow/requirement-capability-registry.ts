import { DataCommandError } from '../data-command-types';
import { normalizeWorkflowAggregateFunction } from './workflow-aggregate-registry';
import type { WorkflowIr, WorkflowOperationIr } from './workflow-model';

interface RequirementCapabilityDefinition {
  operation: WorkflowOperationIr['type'];
  description: string;
  matches(operation: WorkflowOperationIr): boolean;
}

/**
 * Requirement-analysis capabilities are intentionally finer grained than IR
 * operation names. They describe only variants certified through native nodes
 * and DuckDB, preventing a model from treating every payload of an operation as
 * equally supported.
 */
export const REQUIREMENT_CAPABILITY_REGISTRY = {
  'filter.boolean_predicate': requirementCapability(
    'filter',
    'row-dependent boolean predicates using certified expressions'
  ),
  'select.include_columns': requirementCapability(
    'select',
    'include a known set of existing columns'
  ),
  'drop.exclude_columns': requirementCapability('drop', 'drop a known set of existing columns'),
  'rename.single_column': requirementCapability('rename', 'rename an existing column'),
  'derive.scalar': requirementCapability(
    'derive',
    'derive a scalar column with certified expressions'
  ),
  'derive_window.aggregate': requirementCapability(
    'derive_window',
    'aggregate window functions with structured partitions and frames',
    (operation) => Boolean(normalizeWorkflowAggregateFunction(operation.function))
  ),
  'derive_window.ranking': requirementCapability(
    'derive_window',
    'ranking window functions',
    (operation) => RANKING_WINDOW_FUNCTIONS.has(operation.function)
  ),
  'derive_window.value_or_offset': requirementCapability(
    'derive_window',
    'first/last/nth value or lag/lead window functions',
    (operation) =>
      !normalizeWorkflowAggregateFunction(operation.function) &&
      !RANKING_WINDOW_FUNCTIONS.has(operation.function)
  ),
  'convert_type.certified': requirementCapability(
    'convert_type',
    'certified direct casts and cleanup-based conversions'
  ),
  'sort.multi_key': requirementCapability(
    'sort',
    'one or more known sort keys with direction and null ordering'
  ),
  'aggregate.scalar': requirementCapability(
    'aggregate',
    'scalar aggregate metrics grouped by direct column references'
  ),
  'deduplicate.keep_first': requirementCapability(
    'deduplicate',
    'deduplicate while keeping the first row by optional ordering',
    (operation) => operation.config.keep === 'first'
  ),
  'deduplicate.keep_last': requirementCapability(
    'deduplicate',
    'deduplicate while keeping the last row by optional ordering',
    (operation) => operation.config.keep === 'last'
  ),
  'missing.drop_rows': requirementCapability(
    'missing_value',
    'drop fully empty rows or rows null in selected columns',
    (operation) =>
      operation.config.strategy !== 'by_column' ||
      operation.config.rules.some((rule) => rule.method === 'drop')
  ),
  'missing.literal_or_sentinel': requirementCapability(
    'missing_value',
    'literal fill or convert explicit textual sentinels to null',
    (operation) =>
      operation.config.strategy === 'by_column' &&
      operation.config.rules.some(
        (rule) => rule.method === 'nullify_values' || rule.method === 'literal_fill'
      )
  ),
  'missing.statistical_fill': requirementCapability(
    'missing_value',
    'mean/median numeric fill or mode fill',
    (operation) =>
      operation.config.strategy === 'by_column' &&
      operation.config.rules.some((rule) =>
        ['mean_fill', 'median_fill', 'mode_fill'].includes(rule.method)
      )
  ),
  'missing.ordered_fill': requirementCapability(
    'missing_value',
    'forward/backward fill using source row order',
    (operation) =>
      operation.config.strategy === 'by_column' &&
      operation.config.rules.some((rule) => ['forward_fill', 'backward_fill'].includes(rule.method))
  ),
  'limit.global': requirementCapability(
    'limit',
    'global ordered/unordered row or percent limit, optionally with ties',
    (operation) => operation.config.mode === 'limit'
  ),
  'limit.random': requirementCapability(
    'limit',
    'row or percent random sampling with certified methods',
    (operation) => operation.config.mode === 'random'
  ),
  'pivot.fixed_values': requirementCapability(
    'pivot',
    'one pivot axis with fixed values and scalar metrics'
  ),
  'unpivot.columns': requirementCapability(
    'unpivot',
    'unpivot known compatible columns into name/value columns'
  ),
  'unnest.list_rows': requirementCapability(
    'unnest',
    'expand a native list or JSON-array string into rows'
  ),
} as const satisfies Record<string, RequirementCapabilityDefinition>;

export type RequirementCapabilityId = keyof typeof REQUIREMENT_CAPABILITY_REGISTRY;

export interface RequirementCapabilityContract {
  capabilityIds: RequirementCapabilityId[];
}

const RANKING_WINDOW_FUNCTIONS = new Set([
  'row_number',
  'rank',
  'dense_rank',
  'percent_rank',
  'cume_dist',
  'ntile',
]);

export function getRequirementCapabilityPrompt(
  capabilityIds?: readonly RequirementCapabilityId[]
): string {
  const selected = capabilityIds
    ? capabilityIds.map((id) => [id, REQUIREMENT_CAPABILITY_REGISTRY[id]] as const)
    : Object.entries(REQUIREMENT_CAPABILITY_REGISTRY);
  return selected.map(([id, definition]) => `${id}: ${definition.description}`).join('; ');
}

export function getRequirementCapabilityOperation(id: string): string | undefined {
  return (REQUIREMENT_CAPABILITY_REGISTRY as Record<string, RequirementCapabilityDefinition>)[id]
    ?.operation;
}

export function isRequirementCapabilityId(id: string): id is RequirementCapabilityId {
  return Object.prototype.hasOwnProperty.call(REQUIREMENT_CAPABILITY_REGISTRY, id);
}

export function createRequirementCapabilityContract(
  capabilityIds: readonly string[]
): RequirementCapabilityContract {
  const invalidCapabilityIds = capabilityIds.filter((id) => !isRequirementCapabilityId(id));
  if (invalidCapabilityIds.length > 0) {
    throw new DataCommandError(
      'ANALYSIS_STALE',
      `Requirement analysis contains unavailable capabilities: ${invalidCapabilityIds.join(', ')}`
    );
  }
  const certifiedCapabilityIds = uniqueCapabilities(
    capabilityIds.filter(isRequirementCapabilityId)
  );
  return { capabilityIds: certifiedCapabilityIds };
}

export function getRequirementCapabilityContractOperationTypes(
  contract: RequirementCapabilityContract
): WorkflowOperationIr['type'][] {
  return [
    ...new Set(contract.capabilityIds.map((id) => REQUIREMENT_CAPABILITY_REGISTRY[id].operation)),
  ];
}

/**
 * Resolve the exact certified capability variant used by a generated IR operation.
 * This is the AI-owned bridge between requirement analysis and generation; platform
 * schemas and SQL remain read-only execution contracts.
 */
export function getRequiredRequirementCapabilities(
  operation: WorkflowOperationIr
): RequirementCapabilityId[] {
  return (
    Object.entries(REQUIREMENT_CAPABILITY_REGISTRY) as Array<
      [RequirementCapabilityId, RequirementCapabilityDefinition]
    >
  )
    .filter(([, definition]) => definition.matches(operation))
    .map(([id]) => id);
}

export function validateWorkflowIrAgainstRequirementCapabilityContract(
  ir: WorkflowIr,
  contract: RequirementCapabilityContract
): void {
  const operationTypes = getRequirementCapabilityContractOperationTypes(contract);
  const allowedOperations = new Set(operationTypes);
  const declaredCapabilities = new Set(contract.capabilityIds);
  const generatedOperations = new Set(ir.operations.map((operation) => operation.type));
  const usedCapabilities = new Set<RequirementCapabilityId>();
  const diagnostics: Array<Record<string, unknown>> = [];

  for (const operation of ir.operations) {
    const location = operation.location;
    if (!allowedOperations.has(operation.type)) {
      diagnostics.push({
        severity: 'error',
        code: 'ANALYSIS_OPERATION_NOT_DECLARED',
        message: `Generated operation ${operation.type} was not approved by requirement analysis`,
        operationId: operation.operationId,
        operationType: operation.type,
        functionName: location?.functionName,
        line: location?.line,
        column: location?.column,
        repairClass: 'full_regeneration',
        repairHint: `Remove ${operation.type}; generate only analyzed operations: ${operationTypes.join(', ')}`,
      });
    }
    for (const capability of getRequiredRequirementCapabilities(operation)) {
      usedCapabilities.add(capability);
      if (declaredCapabilities.has(capability)) continue;
      diagnostics.push({
        severity: 'error',
        code: 'ANALYSIS_CAPABILITY_MISMATCH',
        message: `Generated ${operation.type} uses capability ${capability}, which was not approved by requirement analysis`,
        operationId: operation.operationId,
        operationType: operation.type,
        functionName: location?.functionName,
        line: location?.line,
        column: location?.column,
        repairClass: 'full_regeneration',
        repairHint: `Use only these analyzed capability variants: ${contract.capabilityIds.join(', ')}`,
      });
    }
  }

  for (const operationType of allowedOperations) {
    if (generatedOperations.has(operationType)) continue;
    diagnostics.push({
      severity: 'error',
      code: 'ANALYSIS_OPERATION_MISSING',
      message: `Generated workflow omitted analyzed operation ${operationType}`,
      operationType,
      repairClass: 'full_regeneration',
      repairHint: `Add the analyzed ${operationType} operation without adding unapproved operations`,
    });
  }

  for (const capabilityId of declaredCapabilities) {
    if (usedCapabilities.has(capabilityId)) continue;
    diagnostics.push({
      severity: 'error',
      code: 'ANALYSIS_CAPABILITY_UNUSED',
      message: `Generated workflow did not implement analyzed capability ${capabilityId}`,
      operationType: REQUIREMENT_CAPABILITY_REGISTRY[capabilityId].operation,
      repairClass: 'full_regeneration',
      repairHint: `Implement the approved capability ${capabilityId}: ${REQUIREMENT_CAPABILITY_REGISTRY[capabilityId].description}`,
    });
  }

  if (diagnostics.length === 0) return;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    'Generated workflow does not match the confirmed requirement-analysis capability contract',
    { diagnostics }
  );
}

function uniqueCapabilities(
  capabilities: readonly RequirementCapabilityId[]
): RequirementCapabilityId[] {
  return [...new Set(capabilities)];
}

function requirementCapability<T extends WorkflowOperationIr['type']>(
  operation: T,
  description: string,
  matches: (operation: Extract<WorkflowOperationIr, { type: T }>) => boolean = () => true
): RequirementCapabilityDefinition {
  return {
    operation,
    description,
    matches: (candidate) =>
      candidate.type === operation &&
      matches(candidate as Extract<WorkflowOperationIr, { type: T }>),
  };
}

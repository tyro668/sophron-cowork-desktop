import { DataCommandError } from '../data-command-types';

/** Workflow operation kinds a requirement can map to (jflow step families). */
export type RequirementOperationType =
  | 'filter'
  | 'select'
  | 'rename'
  | 'derive'
  | 'derive_window'
  | 'cast'
  | 'sort'
  | 'aggregate'
  | 'deduplicate'
  | 'missing_value'
  | 'limit'
  | 'pivot'
  | 'unpivot'
  | 'unnest';

interface RequirementCapabilityDefinition {
  operation: RequirementOperationType;
  description: string;
}

/**
 * Requirement-analysis capabilities. Each id names a jflow step variant certified through native
 * nodes and DuckDB; the confirmed contract scopes the generation prompt.
 */
export const REQUIREMENT_CAPABILITY_REGISTRY = {
  'filter.boolean_predicate': cap(
    'filter',
    'row-dependent boolean predicates using certified expressions'
  ),
  'select.include_columns': cap('select', 'include a known set of existing columns'),
  'select.exclude_columns': cap('select', 'drop a known set of existing columns'),
  'rename.single_column': cap('rename', 'rename an existing column'),
  'derive.scalar': cap('derive', 'derive a scalar column with certified expressions'),
  'derive_window.aggregate': cap(
    'derive_window',
    'aggregate window values (avg/sum/… over () or over (by: …)) beside every row, e.g. comparing a row or group total with the overall or per-group average'
  ),
  'derive_window.ranking': cap('derive_window', 'ranking window functions'),
  'derive_window.value_or_offset': cap(
    'derive_window',
    'first/last/nth value or lag/lead window functions'
  ),
  'cast.certified': cap('cast', 'certified direct casts and cleanup-based conversions'),
  'sort.multi_key': cap('sort', 'one or more known sort keys with direction and null ordering'),
  'aggregate.scalar': cap(
    'aggregate',
    'scalar aggregate metrics grouped by direct column references'
  ),
  'aggregate.conditional': cap(
    'aggregate',
    'conditional aggregates such as sumif / countif inside group'
  ),
  'deduplicate.keep_first': cap(
    'deduplicate',
    'deduplicate while keeping the first row by optional ordering'
  ),
  'deduplicate.keep_last': cap(
    'deduplicate',
    'deduplicate while keeping the last row by optional ordering'
  ),
  'missing.drop_rows': cap(
    'missing_value',
    'drop fully empty rows or rows null in selected columns'
  ),
  'missing.literal_or_sentinel': cap(
    'missing_value',
    'literal fill or convert explicit textual sentinels to null'
  ),
  'missing.statistical_fill': cap('missing_value', 'mean/median numeric fill or mode fill'),
  'missing.ordered_fill': cap('missing_value', 'forward/backward fill using source row order'),
  'limit.global': cap(
    'limit',
    'global ordered/unordered row or percent limit, optionally with ties'
  ),
  'limit.random': cap('limit', 'row or percent random sampling with certified methods'),
  'pivot.fixed_values': cap('pivot', 'one pivot axis with fixed values and scalar metrics'),
  'unpivot.columns': cap('unpivot', 'unpivot known compatible columns into name/value columns'),
  'unnest.list_rows': cap('unnest', 'expand a native list or JSON-array string into rows'),
} as const satisfies Record<string, RequirementCapabilityDefinition>;

export type RequirementCapabilityId = keyof typeof REQUIREMENT_CAPABILITY_REGISTRY;

export interface RequirementCapabilityContract {
  capabilityIds: RequirementCapabilityId[];
}

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
): RequirementOperationType[] {
  return [
    ...new Set(contract.capabilityIds.map((id) => REQUIREMENT_CAPABILITY_REGISTRY[id].operation)),
  ];
}

function uniqueCapabilities(
  capabilities: readonly RequirementCapabilityId[]
): RequirementCapabilityId[] {
  return [...new Set(capabilities)];
}

function cap(
  operation: RequirementOperationType,
  description: string
): RequirementCapabilityDefinition {
  return { operation, description };
}

/** Distinct operation kinds, used by the requirement-analysis prompt. */
export function getRequirementOperationTypeList(): string {
  return [
    ...new Set(Object.values(REQUIREMENT_CAPABILITY_REGISTRY).map((item) => item.operation)),
  ].join(', ');
}

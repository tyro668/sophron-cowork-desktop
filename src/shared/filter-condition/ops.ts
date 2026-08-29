import {
  isNumericDataFieldType,
  isTemporalDataFieldType,
  normalizeDataFieldType,
} from '../data-field-types';
import { isBranch, isLeaf, type FilterConditionBranch, type FilterConditionNode } from './model';
import { updateLeafInBranch } from './tree';

export interface FilterOpGroup {
  /** Stable group id, used as the dropdown group key. */
  key: string;
  items: Array<{ value: string; labelKey: string }>;
}

const ALL_OP_GROUPS: FilterOpGroup[] = [
  {
    key: 'filterGroupCompare',
    items: [
      { value: '=', labelKey: 'filterOpEq' },
      { value: '!=', labelKey: 'filterOpNeq' },
    ],
  },
  {
    key: 'filterGroupRange',
    items: [
      { value: '>', labelKey: 'filterOpGt' },
      { value: '<', labelKey: 'filterOpLt' },
      { value: '>=', labelKey: 'filterOpGte' },
      { value: '<=', labelKey: 'filterOpLte' },
      { value: 'between', labelKey: 'filterOpBetween' },
    ],
  },
  {
    key: 'filterGroupSet',
    items: [
      { value: 'in', labelKey: 'filterOpIn' },
      { value: 'not in', labelKey: 'filterOpNotIn' },
    ],
  },
  {
    key: 'filterGroupNull',
    items: [
      { value: 'is null', labelKey: 'filterOpIsNull' },
      { value: 'is not null', labelKey: 'filterOpIsNotNull' },
    ],
  },
];

const STRING_OP_GROUPS: FilterOpGroup[] = [
  {
    key: 'filterGroupCompare',
    items: [
      { value: '=', labelKey: 'filterOpEq' },
      { value: '!=', labelKey: 'filterOpNeq' },
    ],
  },
  {
    key: 'filterGroupMatch',
    items: [
      { value: 'like', labelKey: 'filterOpLike' },
      { value: 'not like', labelKey: 'filterOpNotLike' },
      { value: 'matches', labelKey: 'filterOpMatches' },
      { value: 'not matches', labelKey: 'filterOpNotMatches' },
    ],
  },
  {
    key: 'filterGroupBoundary',
    items: [
      { value: 'begin', labelKey: 'filterOpBegin' },
      { value: 'end', labelKey: 'filterOpEnd' },
    ],
  },
  {
    key: 'filterGroupSet',
    items: [
      { value: 'in', labelKey: 'filterOpIn' },
      { value: 'not in', labelKey: 'filterOpNotIn' },
    ],
  },
  {
    key: 'filterGroupNull',
    items: [
      { value: 'is null', labelKey: 'filterOpIsNull' },
      { value: 'is not null', labelKey: 'filterOpIsNotNull' },
    ],
  },
];

const BOOLEAN_OP_GROUPS: FilterOpGroup[] = [
  {
    key: 'filterGroupCompare',
    items: [{ value: '=', labelKey: 'filterOpEq' }],
  },
  {
    key: 'filterGroupNull',
    items: [
      { value: 'is null', labelKey: 'filterOpIsNull' },
      { value: 'is not null', labelKey: 'filterOpIsNotNull' },
    ],
  },
];

const TEMPORAL_OP_GROUPS: FilterOpGroup[] = [
  {
    key: 'filterGroupCompare',
    items: [
      { value: '=', labelKey: 'filterOpEq' },
      { value: '!=', labelKey: 'filterOpNeq' },
    ],
  },
  {
    key: 'filterGroupRange',
    items: [
      { value: '>', labelKey: 'filterDateGt' },
      { value: '<', labelKey: 'filterDateLt' },
      { value: '<=', labelKey: 'filterDateLte' },
      { value: '>=', labelKey: 'filterDateGte' },
      { value: 'between', labelKey: 'filterOpBetween' },
    ],
  },
  {
    key: 'filterGroupSet',
    items: [
      { value: 'in', labelKey: 'filterOpIn' },
      { value: 'not in', labelKey: 'filterOpNotIn' },
    ],
  },
  {
    key: 'filterGroupNull',
    items: [
      { value: 'is null', labelKey: 'filterOpIsNull' },
      { value: 'is not null', labelKey: 'filterOpIsNotNull' },
    ],
  },
];

export function filterOpGroupsForType(colType: string | undefined): FilterOpGroup[] {
  if (!colType) return ALL_OP_GROUPS;
  const type = normalizeDataFieldType(colType);
  if (isNumericDataFieldType(type)) return ALL_OP_GROUPS;
  if (type === 'text') return STRING_OP_GROUPS;
  if (isTemporalDataFieldType(type)) return TEMPORAL_OP_GROUPS;
  if (type === 'boolean') return BOOLEAN_OP_GROUPS;
  return ALL_OP_GROUPS;
}

export function validFilterOpsForType(colType: string | undefined): string[] {
  return filterOpGroupsForType(colType).flatMap((group) => group.items.map((item) => item.value));
}

export function firstValidFilterOp(colType: string | undefined): string {
  return validFilterOpsForType(colType)[0] ?? '=';
}

/**
 * Ops configured against one column type may become invalid after the column
 * type changes (e.g. DSL imports, upstream schema changes). Collects such
 * leaves so callers can write the corrected op back to the config instead of
 * silently displaying a different operator.
 */
function collectFilterOpFixes(
  node: FilterConditionNode,
  columnTypes: Record<string, string>,
  fixes: Array<{ leafId: string; op: string }>
): void {
  if (isLeaf(node)) {
    const colType = node.field ? columnTypes[node.field] : undefined;
    if (!colType) return;
    if (validFilterOpsForType(colType).includes(node.op)) return;
    fixes.push({ leafId: node.id, op: firstValidFilterOp(colType) });
    return;
  }
  if (isBranch(node)) node.items.forEach((item) => collectFilterOpFixes(item, columnTypes, fixes));
}

export function normalizeFilterConditionOps(
  branch: FilterConditionBranch,
  columnTypes: Record<string, string>
): { next: FilterConditionBranch; changed: boolean } {
  const fixes: Array<{ leafId: string; op: string }> = [];
  collectFilterOpFixes(branch, columnTypes, fixes);
  if (fixes.length === 0) return { next: branch, changed: false };
  let next = branch;
  for (const fix of fixes) next = updateLeafInBranch(next, fix.leafId, { op: fix.op });
  return { next, changed: true };
}

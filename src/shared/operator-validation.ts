import type { ZodIssue } from 'zod';
import type { DataWorkflowOperatorType } from './data-workflow-types';
import { getOperatorConfigValidation } from './operator-schemas';

export interface OperatorConfigNode {
  type: DataWorkflowOperatorType;
  config: Record<string, unknown>;
}

export type OperatorConfigIssueCode =
  | 'incomplete_config_rows'
  | 'sort_incomplete_field'
  | 'filter_incomplete_field'
  | 'field_mapping_incomplete_field'
  | 'field_select_missing_field'
  | 'deduplicate_incomplete_field'
  | 'limit_percent_error'
  | 'limit_incomplete_field'
  | 'pivot_incomplete_field'
  | 'join_incomplete_field'
  | 'type_convert_incomplete_field'
  | 'unpivot_incomplete_field'
  | 'unnest_incomplete_field'
  | 'calculate_field_incomplete_field'
  | 'aggregate_incomplete_field'
  | 'set_op_incomplete_field'
  | 'missing_value_incomplete_field'
  | 'expect_incomplete_field'
  | 'sql_query_invalid';

export interface OperatorConfigIssue {
  code: OperatorConfigIssueCode;
}

const OPERATOR_ISSUE_CODES: Partial<Record<DataWorkflowOperatorType, OperatorConfigIssueCode>> = {
  sort: 'sort_incomplete_field',
  filter: 'filter_incomplete_field',
  field_mapping: 'field_mapping_incomplete_field',
  field_select: 'field_select_missing_field',
  deduplicate: 'deduplicate_incomplete_field',
  limit: 'limit_incomplete_field',
  pivot: 'pivot_incomplete_field',
  join: 'join_incomplete_field',
  type_convert: 'type_convert_incomplete_field',
  unpivot: 'unpivot_incomplete_field',
  unnest: 'unnest_incomplete_field',
  calculate_field: 'calculate_field_incomplete_field',
  aggregate: 'aggregate_incomplete_field',
  set_op: 'set_op_incomplete_field',
  missing_value: 'missing_value_incomplete_field',
  expect: 'expect_incomplete_field',
  sql_query: 'sql_query_invalid',
};

const ROW_COLLECTIONS: Partial<Record<DataWorkflowOperatorType, ReadonlySet<string>>> = {
  sort: new Set(['orderBy']),
  deduplicate: new Set(['orderBy']),
  type_convert: new Set(['conversions']),
  field_mapping: new Set(['mappings']),
  aggregate: new Set(['metrics']),
  join: new Set(['conditions', 'by']),
  pivot: new Set(['on', 'using']),
  missing_value: new Set(['rules']),
  calculate_field: new Set(['calculations']),
};

function isIncompleteRowIssue(type: DataWorkflowOperatorType, issue: ZodIssue): boolean {
  const rowCollections = ROW_COLLECTIONS[type];
  if (!rowCollections) return false;
  return issue.path.some(
    (segment, index) =>
      typeof segment === 'number' &&
      index > 0 &&
      typeof issue.path[index - 1] === 'string' &&
      rowCollections.has(issue.path[index - 1] as string)
  );
}

export function getOperatorConfigIssue(node: OperatorConfigNode): OperatorConfigIssue | null {
  const validation = getOperatorConfigValidation(node.type, node.config);
  if (validation.success) return null;

  if (validation.error.issues.some((issue) => isIncompleteRowIssue(node.type, issue))) {
    return { code: 'incomplete_config_rows' };
  }
  if (
    node.type === 'limit' &&
    node.config.unit === 'percent' &&
    typeof node.config.limit === 'number' &&
    node.config.limit > 100 &&
    validation.error.issues.some((issue) => issue.path[0] === 'limit')
  ) {
    return { code: 'limit_percent_error' };
  }

  const code = OPERATOR_ISSUE_CODES[node.type];
  return code ? { code } : null;
}

import type { DataWorkflowNode } from '../../types';
import {
  getOperatorConfigIssue,
  type OperatorConfigIssueCode,
} from '../../../shared/operator-validation';

const ISSUE_MESSAGE_KEYS: Record<OperatorConfigIssueCode, string> = {
  incomplete_config_rows: 'data.workflow.formLabels.incompleteConfigRows',
  sort_incomplete_field: 'data.workflow.formLabels.sortIncompleteField',
  filter_incomplete_field: 'data.workflow.formLabels.filterIncompleteField',
  field_mapping_incomplete_field: 'data.workflow.formLabels.fieldMappingIncompleteField',
  field_select_missing_field: 'data.workflow.formLabels.fieldSelectMustSelectField',
  deduplicate_incomplete_field: 'data.workflow.formLabels.dedupIncompleteField',
  limit_percent_error: 'data.workflow.formLabels.limitPercentError',
  limit_incomplete_field: 'data.workflow.formLabels.limitIncompleteField',
  pivot_incomplete_field: 'data.workflow.formLabels.pivotIncompleteField',
  join_incomplete_field: 'data.workflow.formLabels.joinIncompleteField',
  type_convert_incomplete_field: 'data.workflow.formLabels.typeConvertIncompleteField',
  unpivot_incomplete_field: 'data.workflow.formLabels.unpivotIncompleteField',
  unnest_incomplete_field: 'data.workflow.formLabels.unnestIncompleteField',
  calculate_field_incomplete_field: 'data.workflow.formLabels.calculateFieldIncompleteField',
  aggregate_incomplete_field: 'data.workflow.formLabels.aggregateIncompleteField',
  set_op_incomplete_field: 'data.workflow.formLabels.setOpIncompleteField',
  missing_value_incomplete_field: 'data.workflow.formLabels.missingValueIncompleteField',
};

export function incompleteConfigMessageKey(node: DataWorkflowNode): string | null {
  const issue = getOperatorConfigIssue(node);
  return issue ? ISSUE_MESSAGE_KEYS[issue.code] : null;
}

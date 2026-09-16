import type { DataWorkflowNode } from '../../types';
import {
  getOperatorConfigIssue,
  type OperatorConfigIssueCode,
} from '../../../shared/operator-validation';

const ISSUE_MESSAGE_KEYS: Record<OperatorConfigIssueCode, string> = {
  incomplete_config_rows: 'data.workflow.formLabels.common.incompleteConfigRows',
  sort_incomplete_field: 'data.workflow.formLabels.sort.sortIncompleteField',
  filter_incomplete_field: 'data.workflow.formLabels.filter.filterIncompleteField',
  field_mapping_incomplete_field:
    'data.workflow.formLabels.fieldMapping.fieldMappingIncompleteField',
  field_select_missing_field: 'data.workflow.formLabels.fieldSelect.fieldSelectMustSelectField',
  deduplicate_incomplete_field: 'data.workflow.formLabels.deduplicate.dedupIncompleteField',
  limit_percent_error: 'data.workflow.formLabels.limit.limitPercentError',
  limit_incomplete_field: 'data.workflow.formLabels.limit.limitIncompleteField',
  pivot_incomplete_field: 'data.workflow.formLabels.pivot.pivotIncompleteField',
  join_incomplete_field: 'data.workflow.formLabels.join.joinIncompleteField',
  type_convert_incomplete_field: 'data.workflow.formLabels.typeConvert.typeConvertIncompleteField',
  unpivot_incomplete_field: 'data.workflow.formLabels.unpivot.unpivotIncompleteField',
  unnest_incomplete_field: 'data.workflow.formLabels.unnest.unnestIncompleteField',
  calculate_field_incomplete_field:
    'data.workflow.formLabels.calculateField.calculateFieldIncompleteField',
  aggregate_incomplete_field: 'data.workflow.formLabels.aggregate.aggregateIncompleteField',
  set_op_incomplete_field: 'data.workflow.formLabels.setOp.setOpIncompleteField',
  missing_value_incomplete_field:
    'data.workflow.formLabels.missingValue.missingValueIncompleteField',
  expect_incomplete_field: 'data.workflow.formLabels.expect.expectIncompleteField',
};

export function incompleteConfigMessageKey(node: DataWorkflowNode): string | null {
  const issue = getOperatorConfigIssue(node);
  return issue ? ISSUE_MESSAGE_KEYS[issue.code] : null;
}

import type { ComponentType } from 'react';
import type { DataWorkflowOperatorType, DataWorkflowNode } from '../../types';

// All operator forms share this interface
export interface OperatorFormProps {
  node: DataWorkflowNode;
  fieldCompletions: string[];
  otherNodes: DataWorkflowNode[];
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}

// Lazy imports — each form is loaded when first needed
// Forms will be added here as they are implemented

type FormRegistry = Partial<
  Record<DataWorkflowOperatorType, () => Promise<{ default: ComponentType<OperatorFormProps> }>>
>;

const OPERATOR_FORM_LOADERS: FormRegistry = {
  // Phase 2
  filter: () => import('./FormFilter'),
  field_select: () => import('./FormFieldSelect'),
  deduplicate: () => import('./FormDeduplicate'),
  type_convert: () => import('./FormTypeConvert'),
  sort: () => import('./FormSort'),
  field_mapping: () => import('./FormFieldMapping'),
  limit: () => import('./FormLimit'),
  // Phase 3
  calculate_field: () => import('./FormCalculateField'),
  unpivot: () => import('./FormUnpivot'),
  set_op: () => import('./FormSetOp'),
  unnest: () => import('./FormUnnest'),
  // Phase 4
  missing_value: () => import('./FormMissingValue'),
  aggregate: () => import('./FormAggregate'),
  join: () => import('./FormJoin'),
  pivot: () => import('./FormPivot'),
};

export function hasOperatorForm(type: DataWorkflowOperatorType): boolean {
  return type in OPERATOR_FORM_LOADERS;
}

export function getOperatorFormLoader(
  type: DataWorkflowOperatorType
): (() => Promise<{ default: ComponentType<OperatorFormProps> }>) | null {
  return OPERATOR_FORM_LOADERS[type] ?? null;
}

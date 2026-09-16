import {
  ArrowUpDown,
  BarChart3,
  Calculator,
  Columns3,
  Copy,
  Database,
  Droplet,
  Filter,
  GitMerge,
  Repeat2,
  ShieldCheck,
  Sigma,
  Table2,
  UploadCloud,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { DataWorkflowOperatorType } from '../../../../types';
import { OPERATOR_TYPES } from '../../../../../shared/operators';
import type { OperatorFormLoader } from '../../../workflow-forms/types';
import { WORKFLOW_SUMMARIZERS, type WorkflowSummarizer } from './workflow-summary';

/**
 * Renderer-side operator registry — the ONLY place that binds an operator type
 * to its UI facets (palette label/icon/colors, lazy form loader, node summary).
 * The `Record<DataWorkflowOperatorType, …>` key type makes a missing or extra
 * entry a compile error; cross-registry completeness is asserted in
 * src/tests/contracts/operator-registry.test.ts.
 */
export interface OperatorUiDefinition {
  type: DataWorkflowOperatorType;
  labelKey: string;
  Icon: LucideIcon;
  colorClassName: string;
  nodeClassName: string;
  /** Lazy form loader; absent for boundary nodes (input_source/output) that use binding panels. */
  form?: OperatorFormLoader;
  summarize: WorkflowSummarizer;
}

export type WorkflowOperatorCatalogItem = OperatorUiDefinition;

export const OPERATOR_UI: Record<DataWorkflowOperatorType, OperatorUiDefinition> = {
  input_source: {
    type: 'input_source',
    labelKey: 'data.workflow.operators.input_source',
    Icon: Database,
    colorClassName: 'text-success bg-success/10',
    nodeClassName: 'border-success/35 bg-success/5 text-success',
    summarize: WORKFLOW_SUMMARIZERS.input_source,
  },
  filter: {
    type: 'filter',
    labelKey: 'data.workflow.operators.filter',
    Icon: Filter,
    colorClassName: 'text-accent bg-accent/10',
    nodeClassName: 'border-accent/35 bg-accent/5 text-accent',
    form: () => import('../../../workflow-forms/FormFilter'),
    summarize: WORKFLOW_SUMMARIZERS.filter,
  },
  field_select: {
    type: 'field_select',
    labelKey: 'data.workflow.operators.field_select',
    Icon: Columns3,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
    form: () => import('../../../workflow-forms/FormFieldSelect'),
    summarize: WORKFLOW_SUMMARIZERS.field_select,
  },
  deduplicate: {
    type: 'deduplicate',
    labelKey: 'data.workflow.operators.deduplicate',
    Icon: Copy,
    colorClassName: 'text-text-secondary bg-surface-active/70',
    nodeClassName: 'border-border-muted bg-[var(--glass-card-strong)] text-text-secondary',
    form: () => import('../../../workflow-forms/FormDeduplicate'),
    summarize: WORKFLOW_SUMMARIZERS.deduplicate,
  },
  missing_value: {
    type: 'missing_value',
    labelKey: 'data.workflow.operators.missing_value',
    Icon: Droplet,
    colorClassName: 'text-warning bg-warning/10',
    nodeClassName: 'border-warning/40 bg-warning/5 text-warning',
    form: () => import('../../../workflow-forms/FormMissingValue'),
    summarize: WORKFLOW_SUMMARIZERS.missing_value,
  },
  type_convert: {
    type: 'type_convert',
    labelKey: 'data.workflow.operators.type_convert',
    Icon: Repeat2,
    colorClassName: 'text-accent bg-accent/10',
    nodeClassName: 'border-accent/35 bg-accent/5 text-accent',
    form: () => import('../../../workflow-forms/FormTypeConvert'),
    summarize: WORKFLOW_SUMMARIZERS.type_convert,
  },
  sort: {
    type: 'sort',
    labelKey: 'data.workflow.operators.sort',
    Icon: ArrowUpDown,
    colorClassName: 'text-success bg-success/10',
    nodeClassName: 'border-success/35 bg-success/5 text-success',
    form: () => import('../../../workflow-forms/FormSort'),
    summarize: WORKFLOW_SUMMARIZERS.sort,
  },
  join: {
    type: 'join',
    labelKey: 'data.workflow.operators.join',
    Icon: GitMerge,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
    form: () => import('../../../workflow-forms/FormJoin'),
    summarize: WORKFLOW_SUMMARIZERS.join,
  },
  aggregate: {
    type: 'aggregate',
    labelKey: 'data.workflow.operators.aggregate',
    Icon: Sigma,
    colorClassName: 'text-text-secondary bg-surface-active/70',
    nodeClassName: 'border-border-muted bg-[var(--glass-card-strong)] text-text-secondary',
    form: () => import('../../../workflow-forms/FormAggregate'),
    summarize: WORKFLOW_SUMMARIZERS.aggregate,
  },
  calculate_field: {
    type: 'calculate_field',
    labelKey: 'data.workflow.operators.calculate_field',
    Icon: Calculator,
    colorClassName: 'text-text-secondary bg-surface-active/70',
    nodeClassName: 'border-border-muted bg-[var(--glass-card-strong)] text-text-secondary',
    form: () => import('../../../workflow-forms/FormCalculateField'),
    summarize: WORKFLOW_SUMMARIZERS.calculate_field,
  },
  field_mapping: {
    type: 'field_mapping',
    labelKey: 'data.workflow.operators.field_mapping',
    Icon: Table2,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
    form: () => import('../../../workflow-forms/FormFieldMapping'),
    summarize: WORKFLOW_SUMMARIZERS.field_mapping,
  },
  limit: {
    type: 'limit',
    labelKey: 'data.workflow.operators.limit',
    Icon: ArrowUpDown,
    colorClassName: 'text-success bg-success/10',
    nodeClassName: 'border-success/35 bg-success/5 text-success',
    form: () => import('../../../workflow-forms/FormLimit'),
    summarize: WORKFLOW_SUMMARIZERS.limit,
  },
  pivot: {
    type: 'pivot',
    labelKey: 'data.workflow.operators.pivot',
    Icon: BarChart3,
    colorClassName: 'text-text-secondary bg-surface-active/70',
    nodeClassName: 'border-border-muted bg-[var(--glass-card-strong)] text-text-secondary',
    form: () => import('../../../workflow-forms/FormPivot'),
    summarize: WORKFLOW_SUMMARIZERS.pivot,
  },
  unpivot: {
    type: 'unpivot',
    labelKey: 'data.workflow.operators.unpivot',
    Icon: Columns3,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
    form: () => import('../../../workflow-forms/FormUnpivot'),
    summarize: WORKFLOW_SUMMARIZERS.unpivot,
  },
  set_op: {
    type: 'set_op',
    labelKey: 'data.workflow.operators.set_op',
    Icon: GitMerge,
    colorClassName: 'text-accent bg-accent/10',
    nodeClassName: 'border-accent/35 bg-accent/5 text-accent',
    form: () => import('../../../workflow-forms/FormSetOp'),
    summarize: WORKFLOW_SUMMARIZERS.set_op,
  },
  unnest: {
    type: 'unnest',
    labelKey: 'data.workflow.operators.unnest',
    Icon: Workflow,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
    form: () => import('../../../workflow-forms/FormUnnest'),
    summarize: WORKFLOW_SUMMARIZERS.unnest,
  },
  expect: {
    type: 'expect',
    labelKey: 'data.workflow.operators.expect',
    Icon: ShieldCheck,
    colorClassName: 'text-rose-500 bg-rose-500/10',
    nodeClassName: 'border-rose-500/35 bg-rose-500/5 text-rose-500',
    form: () => import('../../../workflow-forms/FormExpect'),
    summarize: WORKFLOW_SUMMARIZERS.expect,
  },
  output: {
    type: 'output',
    labelKey: 'data.workflow.operators.output',
    Icon: UploadCloud,
    colorClassName: 'text-accent bg-accent/10',
    nodeClassName: 'border-accent/35 bg-accent/5 text-accent',
    summarize: WORKFLOW_SUMMARIZERS.output,
  },
};

/** Palette-ordered list view over the registry (order = OPERATOR_TYPES). */
export const OPERATOR_CATALOG: WorkflowOperatorCatalogItem[] = OPERATOR_TYPES.map(
  (type) => OPERATOR_UI[type]
);

export function getOperatorCatalog(type: DataWorkflowOperatorType): WorkflowOperatorCatalogItem {
  return OPERATOR_UI[type];
}

export function hasOperatorForm(type: DataWorkflowOperatorType): boolean {
  return OPERATOR_UI[type]?.form !== undefined;
}

export function getOperatorFormLoader(type: DataWorkflowOperatorType): OperatorFormLoader | null {
  return OPERATOR_UI[type]?.form ?? null;
}

export function isWorkflowOperatorType(value: string): value is DataWorkflowOperatorType {
  return value in OPERATOR_UI;
}

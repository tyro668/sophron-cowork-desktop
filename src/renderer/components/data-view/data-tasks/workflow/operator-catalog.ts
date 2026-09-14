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
  Sigma,
  Table2,
  UploadCloud,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { DataWorkflowOperatorType } from '../../../../types';

export interface WorkflowOperatorCatalogItem {
  type: DataWorkflowOperatorType;
  labelKey: string;
  Icon: LucideIcon;
  colorClassName: string;
  nodeClassName: string;
}

export const OPERATOR_CATALOG: WorkflowOperatorCatalogItem[] = [
  {
    type: 'input_source',
    labelKey: 'data.workflow.operators.input_source',
    Icon: Database,
    colorClassName: 'text-success bg-success/10',
    nodeClassName: 'border-success/35 bg-success/5 text-success',
  },
  {
    type: 'filter',
    labelKey: 'data.workflow.operators.filter',
    Icon: Filter,
    colorClassName: 'text-accent bg-accent/10',
    nodeClassName: 'border-accent/35 bg-accent/5 text-accent',
  },
  {
    type: 'field_select',
    labelKey: 'data.workflow.operators.field_select',
    Icon: Columns3,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'deduplicate',
    labelKey: 'data.workflow.operators.deduplicate',
    Icon: Copy,
    colorClassName: 'text-text-secondary bg-surface-active/70',
    nodeClassName: 'border-border-muted bg-[var(--glass-card-strong)] text-text-secondary',
  },
  {
    type: 'missing_value',
    labelKey: 'data.workflow.operators.missing_value',
    Icon: Droplet,
    colorClassName: 'text-warning bg-warning/10',
    nodeClassName: 'border-warning/40 bg-warning/5 text-warning',
  },
  {
    type: 'type_convert',
    labelKey: 'data.workflow.operators.type_convert',
    Icon: Repeat2,
    colorClassName: 'text-accent bg-accent/10',
    nodeClassName: 'border-accent/35 bg-accent/5 text-accent',
  },
  {
    type: 'sort',
    labelKey: 'data.workflow.operators.sort',
    Icon: ArrowUpDown,
    colorClassName: 'text-success bg-success/10',
    nodeClassName: 'border-success/35 bg-success/5 text-success',
  },
  {
    type: 'join',
    labelKey: 'data.workflow.operators.join',
    Icon: GitMerge,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'aggregate',
    labelKey: 'data.workflow.operators.aggregate',
    Icon: Sigma,
    colorClassName: 'text-text-secondary bg-surface-active/70',
    nodeClassName: 'border-border-muted bg-[var(--glass-card-strong)] text-text-secondary',
  },
  {
    type: 'calculate_field',
    labelKey: 'data.workflow.operators.calculate_field',
    Icon: Calculator,
    colorClassName: 'text-text-secondary bg-surface-active/70',
    nodeClassName: 'border-border-muted bg-[var(--glass-card-strong)] text-text-secondary',
  },
  {
    type: 'field_mapping',
    labelKey: 'data.workflow.operators.field_mapping',
    Icon: Table2,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'limit',
    labelKey: 'data.workflow.operators.limit',
    Icon: ArrowUpDown,
    colorClassName: 'text-success bg-success/10',
    nodeClassName: 'border-success/35 bg-success/5 text-success',
  },
  {
    type: 'pivot',
    labelKey: 'data.workflow.operators.pivot',
    Icon: BarChart3,
    colorClassName: 'text-text-secondary bg-surface-active/70',
    nodeClassName: 'border-border-muted bg-[var(--glass-card-strong)] text-text-secondary',
  },
  {
    type: 'unpivot',
    labelKey: 'data.workflow.operators.unpivot',
    Icon: Columns3,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'set_op',
    labelKey: 'data.workflow.operators.set_op',
    Icon: GitMerge,
    colorClassName: 'text-accent bg-accent/10',
    nodeClassName: 'border-accent/35 bg-accent/5 text-accent',
  },
  {
    type: 'unnest',
    labelKey: 'data.workflow.operators.unnest',
    Icon: Workflow,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'output',
    labelKey: 'data.workflow.operators.output',
    Icon: UploadCloud,
    colorClassName: 'text-accent bg-accent/10',
    nodeClassName: 'border-accent/35 bg-accent/5 text-accent',
  },
];

export function getOperatorCatalog(type: DataWorkflowOperatorType): WorkflowOperatorCatalogItem {
  const item = OPERATOR_CATALOG.find((candidate) => candidate.type === type);
  if (!item) {
    throw new Error(`Unsupported workflow operator type: ${type}`);
  }
  return item;
}

export function isWorkflowOperatorType(value: string): value is DataWorkflowOperatorType {
  return OPERATOR_CATALOG.some((operator) => operator.type === value);
}

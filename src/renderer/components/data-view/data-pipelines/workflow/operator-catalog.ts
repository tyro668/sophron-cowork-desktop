import type { LucideIcon } from 'lucide-react';
import { OPERATOR_ICONS } from './operator-icons';
import type { DataWorkflowOperatorType } from '../../../../types';
import { OPERATOR_TYPES, OPERATOR_GROUPS } from '../../../../../shared/operators';
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
  /** Lazy form loader; absent for boundary nodes (input/output) that use binding panels. */
  form?: OperatorFormLoader;
  summarize: WorkflowSummarizer;
}

export type WorkflowOperatorCatalogItem = OperatorUiDefinition;

// Operators share the accent palette so the palette/canvas follow the app theme.
const OPERATOR_CHIP_CLASS = 'text-accent bg-accent-muted';
const OPERATOR_NODE_CLASS = 'border-accent/35 bg-accent-muted text-accent';

export const OPERATOR_UI: Record<DataWorkflowOperatorType, OperatorUiDefinition> = {
  input: {
    type: 'input',
    labelKey: 'data.workflow.operators.input',
    Icon: OPERATOR_ICONS.input,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    summarize: WORKFLOW_SUMMARIZERS.input,
  },
  filter: {
    type: 'filter',
    labelKey: 'data.workflow.operators.filter',
    Icon: OPERATOR_ICONS.filter,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormFilter'),
    summarize: WORKFLOW_SUMMARIZERS.filter,
  },
  select: {
    type: 'select',
    labelKey: 'data.workflow.operators.select',
    Icon: OPERATOR_ICONS.select,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormFieldSelect'),
    summarize: WORKFLOW_SUMMARIZERS.select,
  },
  deduplicate: {
    type: 'deduplicate',
    labelKey: 'data.workflow.operators.deduplicate',
    Icon: OPERATOR_ICONS.deduplicate,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormDeduplicate'),
    summarize: WORKFLOW_SUMMARIZERS.deduplicate,
  },
  missing_value: {
    type: 'missing_value',
    labelKey: 'data.workflow.operators.missing_value',
    Icon: OPERATOR_ICONS.missing_value,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormMissingValue'),
    summarize: WORKFLOW_SUMMARIZERS.missing_value,
  },
  cast: {
    type: 'cast',
    labelKey: 'data.workflow.operators.cast',
    Icon: OPERATOR_ICONS.cast,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormTypeConvert'),
    summarize: WORKFLOW_SUMMARIZERS.cast,
  },
  sort: {
    type: 'sort',
    labelKey: 'data.workflow.operators.sort',
    Icon: OPERATOR_ICONS.sort,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormSort'),
    summarize: WORKFLOW_SUMMARIZERS.sort,
  },
  join: {
    type: 'join',
    labelKey: 'data.workflow.operators.join',
    Icon: OPERATOR_ICONS.join,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormJoin'),
    summarize: WORKFLOW_SUMMARIZERS.join,
  },
  aggregate: {
    type: 'aggregate',
    labelKey: 'data.workflow.operators.aggregate',
    Icon: OPERATOR_ICONS.aggregate,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormAggregate'),
    summarize: WORKFLOW_SUMMARIZERS.aggregate,
  },
  derive: {
    type: 'derive',
    labelKey: 'data.workflow.operators.derive',
    Icon: OPERATOR_ICONS.derive,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormCalculateField'),
    summarize: WORKFLOW_SUMMARIZERS.derive,
  },
  rename: {
    type: 'rename',
    labelKey: 'data.workflow.operators.rename',
    Icon: OPERATOR_ICONS.rename,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormFieldMapping'),
    summarize: WORKFLOW_SUMMARIZERS.rename,
  },
  limit: {
    type: 'limit',
    labelKey: 'data.workflow.operators.limit',
    Icon: OPERATOR_ICONS.limit,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormLimit'),
    summarize: WORKFLOW_SUMMARIZERS.limit,
  },
  pivot: {
    type: 'pivot',
    labelKey: 'data.workflow.operators.pivot',
    Icon: OPERATOR_ICONS.pivot,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormPivot'),
    summarize: WORKFLOW_SUMMARIZERS.pivot,
  },
  unpivot: {
    type: 'unpivot',
    labelKey: 'data.workflow.operators.unpivot',
    Icon: OPERATOR_ICONS.unpivot,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormUnpivot'),
    summarize: WORKFLOW_SUMMARIZERS.unpivot,
  },
  set_op: {
    type: 'set_op',
    labelKey: 'data.workflow.operators.set_op',
    Icon: OPERATOR_ICONS.set_op,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormSetOp'),
    summarize: WORKFLOW_SUMMARIZERS.set_op,
  },
  unnest: {
    type: 'unnest',
    labelKey: 'data.workflow.operators.unnest',
    Icon: OPERATOR_ICONS.unnest,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormUnnest'),
    summarize: WORKFLOW_SUMMARIZERS.unnest,
  },
  expect: {
    type: 'expect',
    labelKey: 'data.workflow.operators.expect',
    Icon: OPERATOR_ICONS.expect,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormExpect'),
    summarize: WORKFLOW_SUMMARIZERS.expect,
  },
  sql: {
    type: 'sql',
    labelKey: 'data.workflow.operators.sql',
    Icon: OPERATOR_ICONS.sql,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    form: () => import('../../../workflow-forms/FormSqlQuery'),
    summarize: WORKFLOW_SUMMARIZERS.sql,
  },
  output: {
    type: 'output',
    labelKey: 'data.workflow.operators.output',
    Icon: OPERATOR_ICONS.output,
    colorClassName: OPERATOR_CHIP_CLASS,
    nodeClassName: OPERATOR_NODE_CLASS,
    summarize: WORKFLOW_SUMMARIZERS.output,
  },
};

/** Palette-ordered list view over the registry (order = OPERATOR_TYPES). */
export const OPERATOR_CATALOG: WorkflowOperatorCatalogItem[] = OPERATOR_TYPES.map(
  (type) => OPERATOR_UI[type]
);

/** Category membership comes from the kernel registry, never a separate UI list. */
export const OPERATOR_CATALOG_GROUPS = OPERATOR_GROUPS.map(({ category, operatorTypes }) => ({
  category,
  operators: operatorTypes.map((type) => OPERATOR_UI[type]),
}));

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

import type { DataWorkflowNode } from '../../types';

export function hasInvalidSortConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'sort') return false;
  const keys = Array.isArray(node.config.keys) ? node.config.keys : [];
  return (
    keys.length === 0 ||
    keys.some(
      (key) =>
        !key ||
        typeof key !== 'object' ||
        typeof (key as { field?: unknown }).field !== 'string' ||
        !(key as { field: string }).field.trim()
    )
  );
}

export function hasInvalidFilterConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'filter') return false;
  const condition = typeof node.config.condition === 'string' ? node.config.condition.trim() : '';
  return condition.length === 0;
}

export function hasInvalidFieldMappingConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'field_mapping') return false;
  const mappings = Array.isArray(node.config.mappings) ? node.config.mappings : [];
  return (
    mappings.length === 0 ||
    mappings.some((mapping) => {
      if (!mapping || typeof mapping !== 'object') return true;
      const entry = mapping as Record<string, unknown>;
      const source = typeof entry.source === 'string' ? entry.source.trim() : '';
      const mode = typeof entry.targetMode === 'string' ? entry.targetMode : '';
      const target =
        mode === 'prefix' || mode === 'suffix' || mode === 'rename'
          ? typeof entry.targetValue === 'string'
            ? entry.targetValue.trim()
            : ''
          : typeof entry.target === 'string'
            ? entry.target.trim()
            : '';
      return !source || !target;
    })
  );
}

export function hasInvalidFieldSelectConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'field_select') return false;
  const columns = Array.isArray(node.config.columns) ? node.config.columns : [];
  return (
    columns.length === 0 || columns.some((column) => typeof column !== 'string' || !column.trim())
  );
}

export function hasInvalidDeduplicateConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'deduplicate') return false;
  const columns = Array.isArray(node.config.columns) ? node.config.columns : [];
  const orderBy = Array.isArray(node.config.orderBy) ? node.config.orderBy : [];
  const usesAllColumns = node.config.strategy === 'all_columns';
  return (
    (!usesAllColumns && columns.length === 0) ||
    columns.some((column) => typeof column !== 'string' || !column.trim()) ||
    orderBy.some(
      (key) =>
        !key ||
        typeof key !== 'object' ||
        typeof (key as { field?: unknown }).field !== 'string' ||
        !(key as { field: string }).field.trim()
    )
  );
}

export function hasInvalidLimitPercent(node: DataWorkflowNode): boolean {
  return (
    node.type === 'limit' &&
    node.config.unit === 'percent' &&
    typeof node.config.limit === 'number' &&
    node.config.limit > 100
  );
}

export function hasInvalidLimitConfig(node: DataWorkflowNode): boolean {
  return node.type === 'limit' && typeof node.config.limit !== 'number';
}

export function hasInvalidPivotConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'pivot') return false;
  const on = Array.isArray(node.config.on) ? node.config.on : [];
  const using = Array.isArray(node.config.using) ? node.config.using : [];
  const hasEmptyOn = on.some(
    (axis) =>
      !axis ||
      typeof axis !== 'object' ||
      typeof (axis as { field?: unknown }).field !== 'string' ||
      !(axis as { field: string }).field.trim()
  );
  const hasEmptyUsing = using.some(
    (metric) =>
      !metric ||
      typeof metric !== 'object' ||
      typeof (metric as { function?: unknown }).function !== 'string' ||
      !(metric as { function: string }).function.trim() ||
      typeof (metric as { expression?: unknown }).expression !== 'string' ||
      !(metric as { expression: string }).expression.trim()
  );
  return on.length === 0 || using.length === 0 || hasEmptyOn || hasEmptyUsing;
}

function isIncompleteJoinCondition(condition: unknown): boolean {
  if (!condition || typeof condition !== 'object') return true;
  const { left, right } = condition as { left?: unknown; right?: unknown };
  return typeof left !== 'string' || !left.trim() || typeof right !== 'string' || !right.trim();
}

export function hasInvalidJoinConditionConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'join') return false;
  const joinType = String(node.config.joinType ?? 'left');
  if (joinType === 'cross') return false;
  if (joinType === 'asof') {
    const asof =
      node.config.asof && typeof node.config.asof === 'object'
        ? (node.config.asof as Record<string, unknown>)
        : {};
    const leftTime = typeof asof.leftTime === 'string' ? asof.leftTime.trim() : '';
    const rightTime = typeof asof.rightTime === 'string' ? asof.rightTime.trim() : '';
    if (!leftTime || !rightTime) return true;
    const by = Array.isArray(asof.by) ? asof.by : [];
    return by.some(isIncompleteJoinCondition);
  }
  const conditions = Array.isArray(node.config.conditions) ? node.config.conditions : [];
  return conditions.length === 0 || conditions.some(isIncompleteJoinCondition);
}

export function hasInvalidTypeConvertConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'type_convert') return false;
  const conversions = Array.isArray(node.config.conversions) ? node.config.conversions : [];
  return (
    conversions.length === 0 ||
    conversions.some(
      (conversion) =>
        !conversion ||
        typeof conversion !== 'object' ||
        typeof (conversion as { column?: unknown }).column !== 'string' ||
        !(conversion as { column: string }).column.trim()
    )
  );
}

export function hasInvalidUnpivotConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'unpivot') return false;
  const columns = Array.isArray(node.config.columns) ? node.config.columns : [];
  return (
    columns.length === 0 || columns.some((column) => typeof column !== 'string' || !column.trim())
  );
}

export function hasInvalidUnnestConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'unnest') return false;
  const column = typeof node.config.column === 'string' ? node.config.column.trim() : '';
  if (!column) return true;
  const isJson = node.config.sourceKind === 'json';
  if (!isJson) {
    const alias = typeof node.config.alias === 'string' ? node.config.alias.trim() : '';
    if (!alias) return true;
  }
  if (!isJson && node.config.withIndex !== undefined) {
    const withIndex = typeof node.config.withIndex === 'string' ? node.config.withIndex.trim() : '';
    if (!withIndex) return true;
  }
  return false;
}

export function hasInvalidCalculateFieldConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'calculate_field') return false;
  const calculations = Array.isArray(node.config.calculations) ? node.config.calculations : [];
  if (calculations.length === 0) return true;
  return calculations.some((calculation) => {
    if (!calculation || typeof calculation !== 'object') return true;
    const entry = calculation as Record<string, unknown>;
    const type = typeof entry.type === 'string' ? entry.type : 'row';
    if (type === 'cross') return false;
    const field = typeof entry.field === 'string' ? entry.field.trim() : '';
    const expression = typeof entry.expression === 'string' ? entry.expression.trim() : '';
    return !field || !expression;
  });
}

export function hasInvalidAggregateConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'aggregate') return false;
  const metrics = Array.isArray(node.config.metrics) ? node.config.metrics : [];
  return (
    metrics.length === 0 ||
    metrics.some((metric) => {
      if (!metric || typeof metric !== 'object') return true;
      const entry = metric as Record<string, unknown>;
      const expression = typeof entry.expression === 'string' ? entry.expression.trim() : '';
      const alias = typeof entry.alias === 'string' ? entry.alias.trim() : '';
      return !expression || !alias;
    })
  );
}

export function hasInvalidSetOpConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'set_op') return false;
  const rightInput =
    typeof node.config.rightInput === 'string' ? node.config.rightInput.trim() : '';
  return !rightInput;
}

export function hasInvalidMissingValueConfig(node: DataWorkflowNode): boolean {
  if (node.type !== 'missing_value') return false;
  const strategy = typeof node.config.strategy === 'string' ? node.config.strategy : 'by_column';
  if (strategy === 'drop_empty_rows' || strategy === 'drop_rows_by_nulls') {
    return false;
  }
  const rules = Array.isArray(node.config.rules) ? node.config.rules : [];
  if (rules.length === 0) return true;
  return rules.some((rule) => {
    if (!rule || typeof rule !== 'object') return true;
    const entry = rule as Record<string, unknown>;
    const column = typeof entry.column === 'string' ? entry.column.trim() : '';
    if (!column) return true;
    const method = typeof entry.method === 'string' ? entry.method : 'literal_fill';
    if (method === 'nullify_values') {
      const values = Array.isArray(entry.values) ? entry.values : [];
      if (values.length === 0) return true;
    }
    if (method === 'literal_fill') {
      if (entry.value === undefined || entry.value === null || entry.value === '') return true;
    }
    return false;
  });
}

type ConfigGuard = (node: DataWorkflowNode) => boolean;

const INCOMPLETE_CONFIG_GUARDS: Array<{ check: ConfigGuard; messageKey: string }> = [
  { check: hasInvalidSortConfig, messageKey: 'data.workflow.formLabels.sortIncompleteField' },
  { check: hasInvalidFilterConfig, messageKey: 'data.workflow.formLabels.filterIncompleteField' },
  {
    check: hasInvalidFieldMappingConfig,
    messageKey: 'data.workflow.formLabels.fieldMappingIncompleteField',
  },
  {
    check: hasInvalidFieldSelectConfig,
    messageKey: 'data.workflow.formLabels.fieldSelectMustSelectField',
  },
  {
    check: hasInvalidDeduplicateConfig,
    messageKey: 'data.workflow.formLabels.dedupIncompleteField',
  },
  { check: hasInvalidLimitPercent, messageKey: 'data.workflow.formLabels.limitPercentError' },
  { check: hasInvalidLimitConfig, messageKey: 'data.workflow.formLabels.limitIncompleteField' },
  { check: hasInvalidPivotConfig, messageKey: 'data.workflow.formLabels.pivotIncompleteField' },
  {
    check: hasInvalidJoinConditionConfig,
    messageKey: 'data.workflow.formLabels.joinIncompleteField',
  },
  {
    check: hasInvalidTypeConvertConfig,
    messageKey: 'data.workflow.formLabels.typeConvertIncompleteField',
  },
  { check: hasInvalidUnpivotConfig, messageKey: 'data.workflow.formLabels.unpivotIncompleteField' },
  { check: hasInvalidUnnestConfig, messageKey: 'data.workflow.formLabels.unnestIncompleteField' },
  {
    check: hasInvalidCalculateFieldConfig,
    messageKey: 'data.workflow.formLabels.calculateFieldIncompleteField',
  },
  {
    check: hasInvalidAggregateConfig,
    messageKey: 'data.workflow.formLabels.aggregateIncompleteField',
  },
  { check: hasInvalidSetOpConfig, messageKey: 'data.workflow.formLabels.setOpIncompleteField' },
  {
    check: hasInvalidMissingValueConfig,
    messageKey: 'data.workflow.formLabels.missingValueIncompleteField',
  },
];

export function incompleteConfigMessageKey(node: DataWorkflowNode): string | null {
  return INCOMPLETE_CONFIG_GUARDS.find(({ check }) => check(node))?.messageKey ?? null;
}

import {
  isCompleteAggregateMetric,
  isCompleteCalculation,
  isCompleteFieldMapping,
  isCompleteJoinCondition,
  isCompleteMissingValueRule,
  isCompletePivotAxis,
  isCompletePivotMetric,
  isCompleteSortKey,
  isCompleteTypeConversion,
} from './operator-completeness';
import type { DataWorkflowOperatorType } from './data-workflow-types';

export interface OperatorConfigNode {
  type: DataWorkflowOperatorType;
  config: Record<string, unknown>;
}

function hasInvalidSortConfig(node: OperatorConfigNode): boolean {
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

function hasInvalidFilterConfig(node: OperatorConfigNode): boolean {
  if (node.type !== 'filter') return false;
  const condition = typeof node.config.condition === 'string' ? node.config.condition.trim() : '';
  return condition.length === 0;
}

function hasInvalidFieldMappingConfig(node: OperatorConfigNode): boolean {
  if (node.type !== 'field_mapping') return false;
  const mappings = Array.isArray(node.config.mappings) ? node.config.mappings : [];
  return (
    mappings.length === 0 ||
    mappings.some((mapping) => {
      if (!mapping || typeof mapping !== 'object') return true;
      const entry = mapping as Record<string, unknown>;
      const source = typeof entry.source === 'string' ? entry.source.trim() : '';
      const mode = typeof entry.targetMode === 'string' ? entry.targetMode : '';
      const target = typeof entry.targetValue === 'string' ? entry.targetValue.trim() : '';
      if (mode !== 'prefix' && mode !== 'suffix' && mode !== 'rename') return true;
      return !source || !target;
    })
  );
}

function hasInvalidFieldSelectConfig(node: OperatorConfigNode): boolean {
  if (node.type !== 'field_select') return false;
  const columns = Array.isArray(node.config.columns) ? node.config.columns : [];
  return (
    columns.length === 0 || columns.some((column) => typeof column !== 'string' || !column.trim())
  );
}

function hasInvalidDeduplicateConfig(node: OperatorConfigNode): boolean {
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

function hasInvalidLimitPercent(node: OperatorConfigNode): boolean {
  return (
    node.type === 'limit' &&
    node.config.unit === 'percent' &&
    typeof node.config.limit === 'number' &&
    node.config.limit > 100
  );
}

function hasInvalidLimitConfig(node: OperatorConfigNode): boolean {
  return node.type === 'limit' && typeof node.config.limit !== 'number';
}

function hasInvalidPivotConfig(node: OperatorConfigNode): boolean {
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

function hasInvalidJoinConditionConfig(node: OperatorConfigNode): boolean {
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

function hasInvalidTypeConvertConfig(node: OperatorConfigNode): boolean {
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

function hasInvalidUnpivotConfig(node: OperatorConfigNode): boolean {
  if (node.type !== 'unpivot') return false;
  const columns = Array.isArray(node.config.columns) ? node.config.columns : [];
  return (
    columns.length === 0 || columns.some((column) => typeof column !== 'string' || !column.trim())
  );
}

function hasInvalidUnnestConfig(node: OperatorConfigNode): boolean {
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

function hasInvalidCalculateFieldConfig(node: OperatorConfigNode): boolean {
  if (node.type !== 'calculate_field') return false;
  const calculations = Array.isArray(node.config.calculations) ? node.config.calculations : [];
  if (calculations.length === 0) return true;
  return calculations.some((calculation) => !isCompleteCalculation(calculation));
}

function hasInvalidAggregateConfig(node: OperatorConfigNode): boolean {
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

function hasInvalidSetOpConfig(node: OperatorConfigNode): boolean {
  if (node.type !== 'set_op') return false;
  const rightInput =
    typeof node.config.rightInput === 'string' ? node.config.rightInput.trim() : '';
  return !rightInput;
}

function hasInvalidMissingValueConfig(node: OperatorConfigNode): boolean {
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

/**
 * 检查 9 个条目式算子是否存在"数组非空但含不完整条目"。
 * 仅当条目数组已存在（用户已添加行）但其中存在不完整条目时返回 true；
 * 数组缺失或为空属于"缺少必需配置"，由现有 hasInvalid*Config 处理。
 */
function hasIncompleteConfigRows(node: OperatorConfigNode): boolean {
  switch (node.type) {
    case 'sort': {
      const keys = Array.isArray(node.config.keys) ? node.config.keys : [];
      return keys.length > 0 && keys.some((key) => !isCompleteSortKey(key));
    }
    case 'deduplicate': {
      // columns 是原子选择列表，由 hasInvalidDeduplicateConfig 处理；这里只检查 orderBy 条目。
      const orderBy = Array.isArray(node.config.orderBy) ? node.config.orderBy : [];
      return orderBy.length > 0 && orderBy.some((key) => !isCompleteSortKey(key));
    }
    case 'type_convert': {
      const conversions = Array.isArray(node.config.conversions) ? node.config.conversions : [];
      return conversions.length > 0 && conversions.some((c) => !isCompleteTypeConversion(c));
    }
    case 'field_mapping': {
      const mappings = Array.isArray(node.config.mappings) ? node.config.mappings : [];
      return mappings.length > 0 && mappings.some((m) => !isCompleteFieldMapping(m));
    }
    case 'aggregate': {
      const metrics = Array.isArray(node.config.metrics) ? node.config.metrics : [];
      return metrics.length > 0 && metrics.some((m) => !isCompleteAggregateMetric(m));
    }
    case 'join': {
      const joinType = String(node.config.joinType ?? 'left');
      if (joinType === 'cross') return false;
      if (joinType === 'asof') {
        // ASOF 只检查非空 asof.by，忽略普通 conditions。
        // asof.by 缺失或为空是合法可选条件；leftTime/rightTime 由 hasInvalidJoinConditionConfig 处理。
        const asof =
          node.config.asof && typeof node.config.asof === 'object'
            ? (node.config.asof as Record<string, unknown>)
            : {};
        const by = Array.isArray(asof.by) ? asof.by : [];
        return by.length > 0 && by.some((c) => !isCompleteJoinCondition(c));
      }
      // 普通 join 只检查 conditions，忽略 asof.by。
      const conditions = Array.isArray(node.config.conditions) ? node.config.conditions : [];
      return conditions.length > 0 && conditions.some((c) => !isCompleteJoinCondition(c));
    }
    case 'pivot': {
      const on = Array.isArray(node.config.on) ? node.config.on : [];
      const using = Array.isArray(node.config.using) ? node.config.using : [];
      return (
        (on.length > 0 && on.some((axis) => !isCompletePivotAxis(axis))) ||
        (using.length > 0 && using.some((metric) => !isCompletePivotMetric(metric)))
      );
    }
    case 'missing_value': {
      const strategy =
        typeof node.config.strategy === 'string' ? node.config.strategy : 'by_column';
      if (strategy === 'drop_empty_rows' || strategy === 'drop_rows_by_nulls') return false;
      const rules = Array.isArray(node.config.rules) ? node.config.rules : [];
      return rules.length > 0 && rules.some((rule) => !isCompleteMissingValueRule(rule));
    }
    case 'calculate_field': {
      const calculations = Array.isArray(node.config.calculations) ? node.config.calculations : [];
      return calculations.length > 0 && calculations.some((c) => !isCompleteCalculation(c));
    }
    default:
      return false;
  }
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
  | 'missing_value_incomplete_field';

export interface OperatorConfigIssue {
  code: OperatorConfigIssueCode;
}

type ConfigGuard = (node: OperatorConfigNode) => boolean;

const INVALID_CONFIG_GUARDS: ReadonlyArray<{
  check: ConfigGuard;
  code: OperatorConfigIssueCode;
}> = [
  { check: hasInvalidSortConfig, code: 'sort_incomplete_field' },
  { check: hasInvalidFilterConfig, code: 'filter_incomplete_field' },
  { check: hasInvalidFieldMappingConfig, code: 'field_mapping_incomplete_field' },
  { check: hasInvalidFieldSelectConfig, code: 'field_select_missing_field' },
  { check: hasInvalidDeduplicateConfig, code: 'deduplicate_incomplete_field' },
  { check: hasInvalidLimitPercent, code: 'limit_percent_error' },
  { check: hasInvalidLimitConfig, code: 'limit_incomplete_field' },
  { check: hasInvalidPivotConfig, code: 'pivot_incomplete_field' },
  { check: hasInvalidJoinConditionConfig, code: 'join_incomplete_field' },
  { check: hasInvalidTypeConvertConfig, code: 'type_convert_incomplete_field' },
  { check: hasInvalidUnpivotConfig, code: 'unpivot_incomplete_field' },
  { check: hasInvalidUnnestConfig, code: 'unnest_incomplete_field' },
  { check: hasInvalidCalculateFieldConfig, code: 'calculate_field_incomplete_field' },
  { check: hasInvalidAggregateConfig, code: 'aggregate_incomplete_field' },
  { check: hasInvalidSetOpConfig, code: 'set_op_incomplete_field' },
  { check: hasInvalidMissingValueConfig, code: 'missing_value_incomplete_field' },
];

export function getOperatorConfigIssue(node: OperatorConfigNode): OperatorConfigIssue | null {
  if (hasIncompleteConfigRows(node)) return { code: 'incomplete_config_rows' };
  const code = INVALID_CONFIG_GUARDS.find(({ check }) => check(node))?.code;
  return code ? { code } : null;
}

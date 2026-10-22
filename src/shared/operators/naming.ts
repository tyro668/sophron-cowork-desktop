import type { DataWorkflowOperatorType } from './definition';

/**
 * One table aligning the three names of every operator: plan/JSON `type`,
 * Prep DSL keyword(s), and the UI label (zh). Published in the capability
 * manifest and shown as palette tooltips so users and agents can map them.
 */
export const OPERATOR_NAMING: Record<
  DataWorkflowOperatorType,
  { dsl: readonly string[]; zh: string; en: string }
> = {
  input_source: { dsl: ['input'], zh: '输入', en: 'Input' },
  filter: { dsl: ['filter'], zh: '筛选', en: 'Filter' },
  field_select: { dsl: ['select', 'drop'], zh: '字段选择', en: 'Select fields' },
  deduplicate: { dsl: ['deduplicate'], zh: '去重', en: 'Deduplicate' },
  missing_value: { dsl: ['missing value'], zh: '缺失值处理', en: 'Missing values' },
  type_convert: { dsl: ['cast'], zh: '类型转换', en: 'Convert types' },
  sort: { dsl: ['sort by'], zh: '排序', en: 'Sort' },
  join: { dsl: ['join'], zh: '表连接', en: 'Join' },
  aggregate: { dsl: ['aggregate'], zh: '聚合', en: 'Aggregate' },
  calculate_field: { dsl: ['derive'], zh: '计算字段', en: 'Calculated field' },
  field_mapping: { dsl: ['map', 'rename'], zh: '字段映射', en: 'Rename fields' },
  limit: { dsl: ['limit', 'top', 'sample'], zh: '限制行数', en: 'Limit rows' },
  pivot: { dsl: ['pivot'], zh: '透视', en: 'Pivot' },
  unpivot: { dsl: ['unpivot'], zh: '反透视', en: 'Unpivot' },
  set_op: { dsl: ['union', 'intersect', 'except'], zh: '集合操作', en: 'Set operation' },
  unnest: { dsl: ['unnest', 'explode json'], zh: '嵌套展开', en: 'Unnest' },
  expect: { dsl: ['expect'], zh: '质量断言', en: 'Expect' },
  sql_query: { dsl: ['sql'], zh: 'SQL', en: 'SQL' },
  output: { dsl: ['output'], zh: '输出', en: 'Output' },
};

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
  input: { dsl: ['input'], zh: '输入', en: 'Input' },
  filter: { dsl: ['filter'], zh: '筛选', en: 'Filter' },
  select: { dsl: ['select'], zh: '字段选择', en: 'Select' },
  deduplicate: { dsl: ['deduplicate'], zh: '去重', en: 'Deduplicate' },
  missing_value: { dsl: ['missing_value'], zh: '缺失值处理', en: 'Missing values' },
  cast: { dsl: ['cast'], zh: '类型转换', en: 'Cast' },
  sort: { dsl: ['sort'], zh: '排序', en: 'Sort' },
  join: { dsl: ['join'], zh: '表连接', en: 'Join' },
  aggregate: { dsl: ['aggregate'], zh: '聚合', en: 'Aggregate' },
  derive: { dsl: ['derive'], zh: '计算字段', en: 'Derive' },
  rename: { dsl: ['rename'], zh: '重命名', en: 'Rename' },
  limit: { dsl: ['limit'], zh: '限制行数', en: 'Limit' },
  pivot: { dsl: ['pivot'], zh: '透视', en: 'Pivot' },
  unpivot: { dsl: ['unpivot'], zh: '反透视', en: 'Unpivot' },
  // Set operations keep the SQL set keywords as their statement keyword.
  set_op: { dsl: ['union', 'intersect', 'except'], zh: '集合操作', en: 'Set operation' },
  unnest: { dsl: ['unnest'], zh: '嵌套展开', en: 'Unnest' },
  expect: { dsl: ['expect'], zh: '质量断言', en: 'Expect' },
  sql: { dsl: ['sql'], zh: 'SQL', en: 'SQL' },
  output: { dsl: ['output'], zh: '输出', en: 'Output' },
};

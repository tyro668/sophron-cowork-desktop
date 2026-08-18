/**
 * 条目式算子完整性判断（纯逻辑，不依赖 React / Electron / 主进程服务）。
 *
 * 供三类调用方复用：
 * - Prep DSL formatter：过滤不完整条目，只格式化完整条目；
 * - renderer guard：检查原始 config 是否存在不完整条目；
 * - 测试：验证 formatter 与 guard 规则一致。
 *
 * 完整性按算子语义判断（缺省有默认值的属性不算不完整），不判断重复字段、
 * 非法类型、范围越界等语义错误（由 schema / 专项 guard 处理）。
 */

export function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Sort 排序项：field 必填，direction 缺省 asc，nulls 可选。 */
export function isCompleteSortKey(entry: unknown): boolean {
  return isObject(entry) && hasNonEmptyString(entry.field);
}

/** Join 连接条件：左右字段必填，operator 缺省 `=`。 */
export function isCompleteJoinCondition(entry: unknown): boolean {
  return isObject(entry) && hasNonEmptyString(entry.left) && hasNonEmptyString(entry.right);
}

/** TypeConvert 转换条目：column 必填，type 缺省 text，其余可选。 */
export function isCompleteTypeConversion(entry: unknown): boolean {
  return isObject(entry) && hasNonEmptyString(entry.column);
}

/** FieldMapping 映射条目：source 与有效 target 必填（按 targetMode 决定 target 来源）。 */
export function isCompleteFieldMapping(entry: unknown): boolean {
  if (!isObject(entry) || !hasNonEmptyString(entry.source)) return false;
  const mode = typeof entry.targetMode === 'string' ? entry.targetMode : '';
  if (mode === 'rename' || mode === 'prefix' || mode === 'suffix') {
    return hasNonEmptyString(entry.targetValue);
  }
  return hasNonEmptyString(entry.target);
}

/** Aggregate 指标：function、expression、alias 均必填。 */
export function isCompleteAggregateMetric(entry: unknown): boolean {
  return (
    isObject(entry) &&
    hasNonEmptyString(entry.function) &&
    hasNonEmptyString(entry.expression) &&
    hasNonEmptyString(entry.alias)
  );
}

/** Pivot 轴：field 必填，values 可选。 */
export function isCompletePivotAxis(entry: unknown): boolean {
  return isObject(entry) && hasNonEmptyString(entry.field);
}

/** Pivot 指标：function 与 expression 必填，alias 可选。 */
export function isCompletePivotMetric(entry: unknown): boolean {
  return (
    isObject(entry) && hasNonEmptyString(entry.function) && hasNonEmptyString(entry.expression)
  );
}

/** MissingValue 规则：column 必填，其余字段按 method 条件判断。 */
export function isCompleteMissingValueRule(entry: unknown): boolean {
  if (!isObject(entry) || !hasNonEmptyString(entry.column)) return false;
  const method = typeof entry.method === 'string' ? entry.method : 'literal_fill';
  if (method === 'nullify_values') {
    return Array.isArray(entry.values) && entry.values.length > 0;
  }
  if (method === 'literal_fill') {
    const value = entry.value;
    return value !== undefined && value !== null && value !== '';
  }
  return true;
}

/**
 * CalculateField 计算条目：field 与 expression 必填。
 */
export function isCompleteCalculation(entry: unknown): boolean {
  if (!isObject(entry) || !hasNonEmptyString(entry.field)) return false;
  return hasNonEmptyString(entry.expression);
}

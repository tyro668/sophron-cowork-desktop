/**
 * Whitelisted expression functions — the only callables an expression may use.
 * Each entry declares arity, result type and Chinese aliases; aliases compile to
 * the canonical DuckDB name, unknown names are rejected (no SQL passthrough).
 */
import type { ExprType } from './types';

export type FunctionKind = 'scalar' | 'aggregate' | 'window';
export type FunctionCategory = 'date' | 'math' | 'text' | 'null' | 'type' | 'aggregate' | 'window';

/** Result rule: a fixed type, or derived from the arguments. */
export type ReturnRule = ExprType | 'arg0' | 'arg1' | 'widen' | 'avg' | 'sum';

export interface ExpressionFunction {
  name: string;
  aliases: readonly string[];
  category: FunctionCategory;
  kind: FunctionKind;
  minArgs: number;
  maxArgs: number;
  returns: ReturnRule;
  /** Short Chinese description for the editor catalog / AI reference. */
  zh: string;
  /** Allowed without parentheses, e.g. current_date. */
  bare?: boolean;
}

const VAR = 64;

function fn(
  name: string,
  category: FunctionCategory,
  kind: FunctionKind,
  [minArgs, maxArgs]: [number, number],
  returns: ReturnRule,
  zh: string,
  aliases: string[] = [],
  bare = false
): ExpressionFunction {
  return { name, category, kind, minArgs, maxArgs, returns, zh, aliases, bare };
}

export const EXPRESSION_FUNCTIONS: readonly ExpressionFunction[] = [
  // date / time
  fn('year', 'date', 'scalar', [1, 1], 'integer', '取年份', ['年']),
  fn('quarter', 'date', 'scalar', [1, 1], 'integer', '取季度', ['季度']),
  fn('month', 'date', 'scalar', [1, 1], 'integer', '取月份', ['月']),
  fn('week', 'date', 'scalar', [1, 1], 'integer', '取周数', ['周']),
  fn('day', 'date', 'scalar', [1, 1], 'integer', '取日', ['日']),
  fn('dayofweek', 'date', 'scalar', [1, 1], 'integer', '星期几（0=周日）', ['星期']),
  fn('hour', 'date', 'scalar', [1, 1], 'integer', '取小时', ['小时']),
  fn('minute', 'date', 'scalar', [1, 1], 'integer', '取分钟', ['分钟']),
  fn('second', 'date', 'scalar', [1, 1], 'integer', '取秒', ['秒']),
  fn('date_diff', 'date', 'scalar', [3, 3], 'integer', '两个日期的差值', ['日期差']),
  fn('datediff', 'date', 'scalar', [3, 3], 'integer', '两个日期的差值（同 date_diff）'),
  fn('date_part', 'date', 'scalar', [2, 2], 'integer', '取日期的指定部分', ['日期部分']),
  fn('date_trunc', 'date', 'scalar', [2, 2], 'arg1', '截断到年/月/日等', ['日期截断']),
  fn('date_add', 'date', 'scalar', [2, 2], 'arg0', '日期加间隔', ['日期加']),
  fn('make_date', 'date', 'scalar', [3, 3], 'date', '由年月日构造日期', ['构造日期']),
  fn('last_day', 'date', 'scalar', [1, 1], 'date', '当月最后一天', ['月末']),
  fn('strftime', 'date', 'scalar', [2, 2], 'text', '日期格式化为文本', ['格式化日期']),
  fn('strptime', 'date', 'scalar', [2, 2], 'datetime', '按格式把文本解析为日期时间', ['解析日期']),
  fn('current_date', 'date', 'scalar', [0, 0], 'date', '今天', ['今天'], true),
  fn('current_timestamp', 'date', 'scalar', [0, 0], 'datetime', '当前时间', [], true),
  fn('now', 'date', 'scalar', [0, 0], 'datetime', '当前时间', ['现在']),
  fn('today', 'date', 'scalar', [0, 0], 'date', '今天'),
  // math
  fn('abs', 'math', 'scalar', [1, 1], 'arg0', '绝对值', ['绝对值']),
  fn('round', 'math', 'scalar', [1, 2], 'arg0', '四舍五入到指定小数位', ['四舍五入']),
  fn('ceil', 'math', 'scalar', [1, 1], 'arg0', '向上取整', ['向上取整']),
  fn('ceiling', 'math', 'scalar', [1, 1], 'arg0', '向上取整'),
  fn('floor', 'math', 'scalar', [1, 1], 'arg0', '向下取整', ['向下取整']),
  fn('trunc', 'math', 'scalar', [1, 2], 'arg0', '截断小数', ['截断']),
  fn('pow', 'math', 'scalar', [2, 2], 'float', '乘方', ['幂']),
  fn('power', 'math', 'scalar', [2, 2], 'float', '乘方'),
  fn('sqrt', 'math', 'scalar', [1, 1], 'float', '平方根', ['平方根']),
  fn('exp', 'math', 'scalar', [1, 1], 'float', 'e 的乘方'),
  fn('ln', 'math', 'scalar', [1, 1], 'float', '自然对数'),
  fn('log', 'math', 'scalar', [1, 2], 'float', '对数'),
  fn('log10', 'math', 'scalar', [1, 1], 'float', '常用对数'),
  fn('mod', 'math', 'scalar', [2, 2], 'widen', '取余数', ['取余']),
  fn('sign', 'math', 'scalar', [1, 1], 'integer', '正负号', ['符号']),
  fn('greatest', 'math', 'scalar', [1, VAR], 'widen', '多个值中的最大值', ['较大值']),
  fn('least', 'math', 'scalar', [1, VAR], 'widen', '多个值中的最小值', ['较小值']),
  // text
  fn('upper', 'text', 'scalar', [1, 1], 'text', '转大写', ['大写']),
  fn('lower', 'text', 'scalar', [1, 1], 'text', '转小写', ['小写']),
  fn('trim', 'text', 'scalar', [1, 2], 'text', '去掉首尾空格', ['去空格']),
  fn('ltrim', 'text', 'scalar', [1, 2], 'text', '去掉开头空格'),
  fn('rtrim', 'text', 'scalar', [1, 2], 'text', '去掉结尾空格'),
  fn('length', 'text', 'scalar', [1, 1], 'integer', '文本长度', ['长度']),
  fn('substr', 'text', 'scalar', [2, 3], 'text', '截取子串', ['截取']),
  fn('substring', 'text', 'scalar', [2, 3], 'text', '截取子串'),
  fn('left', 'text', 'scalar', [2, 2], 'text', '取左边 N 个字符', ['左取']),
  fn('right', 'text', 'scalar', [2, 2], 'text', '取右边 N 个字符', ['右取']),
  fn('split_part', 'text', 'scalar', [3, 3], 'text', '按分隔符拆分后取第 N 段', ['拆分']),
  fn('concat', 'text', 'scalar', [1, VAR], 'text', '拼接文本', ['拼接']),
  fn('concat_ws', 'text', 'scalar', [2, VAR], 'text', '用分隔符拼接', ['分隔拼接']),
  fn('contains', 'text', 'scalar', [2, 2], 'boolean', '是否包含', ['包含']),
  fn('starts_with', 'text', 'scalar', [2, 2], 'boolean', '是否以…开头', ['开头是']),
  fn('ends_with', 'text', 'scalar', [2, 2], 'boolean', '是否以…结尾', ['结尾是']),
  fn('strpos', 'text', 'scalar', [2, 2], 'integer', '子串位置', ['位置']),
  fn('replace', 'text', 'scalar', [3, 3], 'text', '替换文本', ['替换']),
  fn('regexp_replace', 'text', 'scalar', [3, 4], 'text', '正则替换', ['正则替换']),
  fn('regexp_extract', 'text', 'scalar', [2, 3], 'text', '正则提取', ['正则提取']),
  fn('regexp_matches', 'text', 'scalar', [2, 3], 'boolean', '是否匹配正则', ['正则匹配']),
  fn('lpad', 'text', 'scalar', [3, 3], 'text', '左侧补齐', ['左补齐']),
  fn('rpad', 'text', 'scalar', [3, 3], 'text', '右侧补齐', ['右补齐']),
  fn('reverse', 'text', 'scalar', [1, 1], 'text', '反转文本', ['反转']),
  fn('repeat', 'text', 'scalar', [2, 2], 'text', '重复文本', ['重复']),
  // null handling
  fn('coalesce', 'null', 'scalar', [1, VAR], 'widen', '返回第一个非空值', ['空值替换']),
  fn('ifnull', 'null', 'scalar', [2, 2], 'widen', '为空时取替代值', ['若空']),
  fn('nullif', 'null', 'scalar', [2, 2], 'arg0', '两值相等时返回空', ['相等为空']),
  // type
  fn('typeof', 'type', 'scalar', [1, 1], 'text', '值的类型名'),
  // aggregates
  fn('sum', 'aggregate', 'aggregate', [1, 1], 'sum', '求和', ['求和']),
  fn('avg', 'aggregate', 'aggregate', [1, 1], 'avg', '平均值', ['平均']),
  fn('mean', 'aggregate', 'aggregate', [1, 1], 'avg', '平均值'),
  fn('min', 'aggregate', 'aggregate', [1, 1], 'arg0', '最小值', ['最小']),
  fn('max', 'aggregate', 'aggregate', [1, 1], 'arg0', '最大值', ['最大']),
  fn('count', 'aggregate', 'aggregate', [0, 1], 'integer', '计数', ['计数']),
  fn('median', 'aggregate', 'aggregate', [1, 1], 'arg0', '中位数', ['中位数']),
  fn('mode', 'aggregate', 'aggregate', [1, 1], 'arg0', '众数', ['众数']),
  fn('stddev', 'aggregate', 'aggregate', [1, 1], 'float', '标准差', ['标准差']),
  fn('stddev_samp', 'aggregate', 'aggregate', [1, 1], 'float', '样本标准差'),
  fn('stddev_pop', 'aggregate', 'aggregate', [1, 1], 'float', '总体标准差'),
  fn('var_pop', 'aggregate', 'aggregate', [1, 1], 'float', '总体方差', ['方差']),
  fn('var_samp', 'aggregate', 'aggregate', [1, 1], 'float', '样本方差'),
  fn('variance', 'aggregate', 'aggregate', [1, 1], 'float', '方差'),
  fn('product', 'aggregate', 'aggregate', [1, 1], 'float', '连乘'),
  fn('bool_and', 'aggregate', 'aggregate', [1, 1], 'boolean', '全部为真'),
  fn('bool_or', 'aggregate', 'aggregate', [1, 1], 'boolean', '任一为真'),
  fn('quantile_cont', 'aggregate', 'aggregate', [2, 2], 'float', '连续分位数', ['分位数']),
  fn('string_agg', 'aggregate', 'aggregate', [1, 2], 'text', '拼接分组内文本', ['文本汇总']),
  fn('first', 'aggregate', 'aggregate', [1, 1], 'arg0', '第一个值'),
  fn('last', 'aggregate', 'aggregate', [1, 1], 'arg0', '最后一个值'),
  fn('any_value', 'aggregate', 'aggregate', [1, 1], 'arg0', '任意一个值'),
  // window
  fn('row_number', 'window', 'window', [0, 0], 'integer', '行号', ['行号']),
  fn('rank', 'window', 'window', [0, 0], 'integer', '排名（并列跳号）', ['排名']),
  fn('dense_rank', 'window', 'window', [0, 0], 'integer', '密集排名', ['密集排名']),
  fn('percent_rank', 'window', 'window', [0, 0], 'float', '百分比排名'),
  fn('cume_dist', 'window', 'window', [0, 0], 'float', '累积分布'),
  fn('ntile', 'window', 'window', [1, 1], 'integer', '分桶编号', ['分桶']),
  fn('lag', 'window', 'window', [1, 3], 'arg0', '前 N 行的值', ['上一行']),
  fn('lead', 'window', 'window', [1, 3], 'arg0', '后 N 行的值', ['下一行']),
  fn('first_value', 'window', 'window', [1, 1], 'arg0', '窗口第一个值', ['首值']),
  fn('last_value', 'window', 'window', [1, 1], 'arg0', '窗口最后一个值', ['末值']),
  fn('nth_value', 'window', 'window', [2, 2], 'arg0', '窗口第 N 个值'),
];

const BY_NAME = new Map<string, ExpressionFunction>();
for (const entry of EXPRESSION_FUNCTIONS) {
  BY_NAME.set(entry.name, entry);
  for (const alias of entry.aliases) BY_NAME.set(alias, entry);
}

/** Resolve a canonical name or Chinese alias (case-insensitive for ASCII). */
export function lookupExpressionFunction(name: string): ExpressionFunction | undefined {
  return BY_NAME.get(name) ?? BY_NAME.get(name.toLowerCase());
}

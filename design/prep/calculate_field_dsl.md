# 计算字段领域函数 DSL 设计

## 1. 文档目标

本文档定义计算字段（`calculate_field` 算子）的**完整 DSL 表达**，覆盖 8 个场景的全部函数。

- 明确每个函数的 DSL 形态与**原生 / 封装**状态；
- 统一领域函数的语法、语义、校验与诊断；
- 作为 AI 生成、DSL 导入导出、图形化配置回填的共同依据。

这些能力不新增工作流算子，均通过 `calculate_field` 算子的公共 DSL 关键字 `derive` 表达。
领域函数负责描述业务意图，编译器负责将其展开为 DuckDB SQL表达式。
本文档只规定公共 DSL，不规定编译后 SQL 的具体文本形式。

## 2. 设计原则

核心原则：不为了拆分而拆分，而是为了表达业务意图和简化表达式而拆分。

### 2.1 领域函数名规范

- 如果原本DSL中包含功能函数名，尽量保留原函数名，避免复杂的函数名；
- 不同场景下的同名函数，通过前缀区分，比如sum函数，group_sum表示这是组内指标，cumulative_sum表示这是累计。
- 若函数名在自由计算（expression）场景中已作为原生函数存在（如 `sum`），则该场景下的同名聚合必须加前缀，避免与自由表达式中的裸函数名冲突；
- 复杂的功能，如果原本DSL中不包含函数名，则抽象为新函数；
- 函数名选取描述该功能的函数名组中最被规范使用的一个，保证可用性和可解释性；
- 同场景下领域函数名尽量保持一致性。

### 2.2 领域函数表达式规范

- 领域函数内部不得暴露 `CASE`、`extract`、`SELECT`等底层 SQL 组合；
- 力求在形式最简单和高度可解释性中达到平衡，避免使用复杂的 SQL 表达式；
- 复杂表达式必须封装为新的领域函数；
- `over(partition by [字段名列表])` 描述业务分组；
- `over(order by ['字段名' 'asc' | 'desc'])` 描述排序字段及排序方向；
- 其余附加语句由各种场景决定，比如时间累计场景中，需要描述时间范围；滑动窗口场景中，需要描述窗口大小。
- 窗口 frame 子句（`rows`/`range`/`groups` 及边界）属于场景附加语句，不视为 `CASE`/`extract` 一类的底层 SQL 组合，无需封装为领域函数。

### 2.3 领域函数参数规范

- 领域函数参数采用固定位置参数，不引入 `date =>`、`grain =>` 等额外符号；
- 解析器必须按函数签名校验参数数量和参数类型；
- 参数列表存放必须填写、类型确定、个数确定的参数，不能包含高度开放性的参数。比如时间累计场景中，要求必填的参数中包含用于排序的时间字段，因为这个字段必填、唯一且类型确定；而其他场景中排序统一放后面over (order by)，不放在参数中。
- 时间累计场景的聚合参数（`aggregate`，如 `sum([销售额])`）虽属开放性参数，但它是该场景的固定语义组成部分，予以豁免。

### 2.4 规范化输出

- 字段引用遵循主 DSL 文档的方括号规则；
- 字符串字面量统一使用双引号；
- 关键字和函数名统一使用小写；
- 排序方向显式写出：显式选中的方向写出 `asc` / `desc`，未选择（默认）asc 省略；
- 解析器可以兼容已存在的旧语法，但导出器只能生成规范形式。

## 3. 自由表达式（expression）

自由计算不对应领域函数，表达式直接写在 `derive` 右侧。通过「右侧根节点不是场景函数」
识别为自由表达式场景。自由表达式不生成领域函数，但可以包含总 DSL 表达式体系允许的
标量、条件和原生窗口表达式。

```text
derive [利润率] = [利润] / [销售额]
derive [月份] = month([日期])
derive [绝对值] = abs([金额])
derive [窗口求和] = sum([金额]) over()
```

自由表达式可以使用标量函数、条件表达式及合法窗口表达式，但**禁止裸聚合函数**，
与总 DSL 规范一致（`sum`、`avg`、`count` 等聚合函数只有带 `over(...)` 时
才可作为窗口聚合出现在 `derive`）。时间累计函数中的聚合参数属于领域函数签名的
一部分，不视为自由表达式中的裸聚合。

```text
derive [x] = abs([金额])                        # 合法
derive [x] = sum([金额])                        # 非法：裸聚合
derive [x] = sum([金额]) over()                 # 合法：窗口聚合
derive [x] = year_to_date(sum([金额]), [日期])  # 合法：领域函数聚合参数
```

## 4. 公共语法

### 4.1 场景分类

覆盖全部 8 个场景（含原生与封装）：

```text
type CalculationScene =
  | 'expression'          # 自由计算：derive [x] = <表达式>，不对应领域函数，通过"右侧根节点不是场景函数"识别
  | 'group_metric'        # 组内指标
  | 'ranking'             # 排名与序号
  | 'cumulative'          # 累计
  | 'offset'              # 前后行
  | 'moving_window'       # 滑动窗口
  | 'period_compare'      # 周期对比
  | 'time_accumulation';  # 时间累计
```

```ebnf
# 通用语法
derive [x]=功能函数([参数列表]) over(partition by [字段名列表] order by [字段名列表] (frame_clause))

# DSL表达式
dsl_expr := fn_call "(" args ")" over_clause
over_clause := "over" "(" ["partition" "by" field_ref_list]
                              ["order" "by" sort_key ("," sort_key)*]
                              [frame_clause] ")"

partition_over_clause := "over" "(" "partition" "by" field_ref_list ")"
ordered_over_clause   := "over" "(" ["partition" "by" field_ref_list]
                                 "order" "by" sort_key ("," sort_key)* ")"

sort_key     := field_ref ["asc" | "desc"]
frame_clause := frame_type "between" frame_bound "and" frame_bound ["exclude" frame_exclude]
frame_type   := "rows" | "range" | "groups"
frame_bound  := "unbounded preceding" | "unbounded following" | "current row"
              | positive_integer ("preceding" | "following")
              | "interval" positive_integer interval_unit ("preceding" | "following")
frame_exclude:= "current row" | "group" | "ties" | "no others"
interval_unit:= "\"day\"" | "\"week\"" | "\"month\"" | "\"quarter\"" | "\"year\""
```

### 4.2 图形化配置 → DSL 正向映射

| 场景       | UI 功能                | 生成函数                                                                                                                                                                                                                                                                                                                                                               | 分组 | 排序     | frame |
| ---------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------- | ----- |
| 自由表达式 | —                      | 不生成领域函数                                                                                                                                                                                                                                                                                                                                                         | —    | —        | —     |
| 组内指标   | 求和 / 占比 / 去重计数 | `group_sum(value)`、`group_avg(value)`、`group_min(value)`、`group_max(value)`、`group_median(value)`、`group_stddev(value)`、`group_var(value)`、`group_mode(value)`、`group_bool_and(value)`、`group_bool_or(value)`、`group_count(value \| *)`、`group_quantile_cont(value, q)`、`group_string_agg(value, delimiter)`、`percentage(value)`、`count_distinct(value)` | 可选 | 禁止     | 禁止  |
| 排名与序号 | 排名 / 分桶            | `row_number()`、`rank()`、`dense_rank()`、`percent_rank()`、`cume_dist()`、`ntile(buckets)`                                                                                                                                                                                                                                                                            | 可选 | 必填     | 禁止  |
| 累计       | 求和                   | `cumulative_sum(value)`、`cumulative_avg(value)`、`cumulative_count(value)`、`cumulative_min(value)`、`cumulative_max(value)`、`cumulative_product(value)`                                                                                                                                                                                                             | 可选 | 必填     | 内置  |
| 前后行     | 上一行 / 偏移差        | `lag(value [, offset])`、`lead(value [, offset])`、`first_value(value)`、`last_value(value)`、`nth_value(value, n)`、`offset_difference(value, offset)`、`offset_rate(value, offset)`                                                                                                                                                                                  | 可选 | 必填     | 禁止  |
| 滑动窗口   | 平均                   | `moving_sum(value)`、`moving_avg(value)`、`moving_count(value)`、`moving_min(value)`、`moving_max(value)`                                                                                                                                                                                                                                                              | 可选 | 必填     | 必填  |
| 周期对比   | 同比值 / 环比          | `previous_value(value, order_field)`、`previous_difference(value, order_field)`、`previous_rate(value, order_field)`、`year_over_year_value(value, date_field, grain)`、`year_over_year_difference(value, date_field, grain)`、`year_over_year_rate(value, date_field, grain)`                                                                                         | 可选 | 函数参数 | 禁止  |
| 时间累计   | 年累计                 | `year_to_date(aggregate, date_field [, fiscal_start_month])`、`quarter_to_date(aggregate, date_field)`、`month_to_date(aggregate, date_field)`、`week_to_date(aggregate, date_field)`、`rolling_time(aggregate, date_field, size, unit)`                                                                                                                               | 可选 | 函数参数 | 内置  |

- 「分组」「排序」「frame」列的取值：可选 / 必填 / 禁止 / 内置 / 函数参数。
- 「内置」表示该场景的 frame 由函数语义固定（如累计固定为 `rows between unbounded preceding and current row`），用户不可配置；
- 「函数参数」表示排序字段由函数的位置参数承载（如周期对比的日期、时间累计的日期）。

### 4.3 唯一规范化输出规则

图形化配置生成 DSL 时，必须产出唯一规范结果：

1. 函数名和关键字一律小写；
2. 字符串字面量统一使用双引号；
3. 排序方向显式写出：显式选中的方向写出 `asc` / `desc`，未选择（默认）asc 省略；
4. 分组为空时只省略 `partition by`；仅当该场景同时没有排序和 frame 时，才省略整个 `over(...)`；
5. 多排序字段保持 UI 配置顺序；
6. frame 固定顺序输出：`<type> between <start> and <end> [exclude <exclude>]`；
7. 不生成底层 `case` / `lag` / `extract` 展开表达式。

各场景在无分组时的 over 行为：

| 场景       | 无分组时                                                 |
| ---------- | -------------------------------------------------------- |
| 自由表达式 | 由表达式本身决定；普通表达式无 over，窗口表达式保留 over |
| 组内指标   | 省略整个 over(...)                                       |
| 排名与序号 | 保留 over(order by ...)                                  |
| 累计       | 保留 over(order by ...)                                  |
| 前后行     | 保留 over(order by ...)                                  |
| 滑动窗口   | 保留排序和 frame                                         |
| 周期对比   | 可以省略整个 over(...)                                   |
| 时间累计   | 可以省略整个 over(...)                                   |

各场景的具体语法与约束见 §5-§11。

## 5. 组内指标（group_metric）

> **状态**：📝 封装（已设计待实现）。
>
> - 加 `group_` 前缀：`group_sum`、`group_avg`、`group_min`、`group_max`、`group_median`、
>   `group_stddev`、`group_var`、`group_mode`、`group_bool_and`、`group_bool_or`、
>   `group_count`、`group_quantile_cont`、`group_string_agg`
> - 场景独有（不加前缀）：`percentage`、`count_distinct`

组内指标对分区内的值做整体聚合，不依赖行序。`over(...)` 只允许 `partition by`，
禁止 `order by`，因为组内指标不依赖行序。

**DSL范式为**：

```text
# partition by 可选，参数由函数决定
derive [x]=group_指标函数([参数字段]，参数2) over(partition by [字段名列表] )
```

### 函数签名

```text
group_sum(value) / group_avg(value) / group_min(value) / group_max(value)
group_median(value) / group_stddev(value) / group_var(value) / group_mode(value)
group_bool_and(value) / group_bool_or(value)
group_count(value | *)
group_quantile_cont(value, q)
group_string_agg(value, delimiter)
percentage(value)
count_distinct(value)
```

### 示例

```text
derive [销售额] = group_sum([销售额]) over(partition by [区域])
derive [行数] = group_count(*) over(partition by [区域])
derive [拼接名称] = group_string_agg([name], ", ") over(partition by [区域])
derive [分位数] = group_quantile_cont([amount], 0.5) over(partition by [区域])
derive [销售额占比] = percentage([销售额]) over(partition by [区域])
derive [客户数] = count_distinct([客户]) over(partition by [区域], [产品])
```

### 语义

- `group_sum`/`group_avg`/`group_min`/`group_max`：分组聚合；
- `group_median`/`group_stddev`/`group_var`/`group_mode`：统计指标；
- `group_bool_and`/`group_bool_or`：逻辑聚合；
- `group_count`：计数，支持 `*`；
- `group_quantile_cont(value, q)`：连续分位数，`q` 为 0 到 1 的数；
- `group_string_agg(value, delimiter)`：按分隔符拼接；
- `percentage(value)`：当前行的值占分区总和的占比；
- `count_distinct(value)`：分区内 `value` 的去重计数；
- 未声明 `over(...)` 时，全表视为一个分区。

### 约束

- 函数名加 `group_` 前缀，用于区分其他场景下的同名聚合；
- `value` 为字段引用或标量表达式；
- `over(...)` 只能包含 `partition by`，禁止 `order by`、窗口边界或排除规则；
- `percentage` / `count_distinct` 只接受一个 `value` 参数。

## 6. 排名与序号（ranking）

> **状态**：⚪ 全部保持原生（确认不封装）。

排名函数为分区内行分配序号或排名，依赖排序后的行序。

**DSL范式为**：

```text
# partition by 可选，参数由函数决定是否必填，Direction 可选asc或desc，不填默认asc
derive [x]=排名函数(参数) over(partition by [字段名列表] order by [字段名列表] Direction )
```

### 函数签名

```text
row_number()
rank()
dense_rank()
percent_rank()
cume_dist()
ntile(buckets)
```

### DSL 形态

```text
rank() over(partition by [region] order by [amount] desc, [date])
ntile(4) over(order by [amount] desc)
row_number() over(partition by [region] order by [date])
```

### 语义

- `row_number`：唯一行号；
- `rank`：排名，相同值并列且跳号；
- `dense_rank`：密集排名，不跳号；
- `percent_rank`：百分比排名；
- `cume_dist`：累计分布；
- `ntile(buckets)`：均匀分桶，返回桶号。

### 约束

- `over(...)` 必须包含 `order by`，且至少一个排序字段；
- `partition by` 可选；
- `ntile` 的桶数为正整数。

## 7. 累计（cumulative）

> **状态**：📝 封装（已设计待实现），统一封装为 `cumulative_*` 函数（`cumulative_sum`、`cumulative_avg` 等）。

累计函数从分区首行开始，逐行累加到当前行。累计推进顺序由 `over(... order by ...)` 决定，
窗口边界固定为「首行到当前行」。

### DSL范式为：

```text
# partition by 可选，ORDER BY 必选，Direction 可选asc或desc，不填默认asc
derive [x]=cumulative_指标函数([参数字段]) over(partition by [字段名列表] order by [字段名列表] Direction )
```

### 函数签名

```text
cumulative_sum(value)
cumulative_avg(value)
cumulative_count(value)
cumulative_min(value)
cumulative_max(value)
cumulative_product(value)
```

### 示例

```text
derive [累计销售额] = cumulative_sum([销售额]) over(partition by [区域] order by [日期])
derive [累计行数] = cumulative_count(*) over(partition by [区域] order by [日期])
derive [累计连乘] = cumulative_product([系数]) over(order by [日期] desc)
```

### 语义

- 分区内按 `over(... order by ...)` 排序后，从分区首行逐行累计到当前行；
- `cumulative_sum` 累计求和；`cumulative_avg` 累计平均；`cumulative_min`/`cumulative_max`
  到当前行为止的最小 / 最大值；`cumulative_count` 累计行数；`cumulative_product` 累计连乘；
- 窗口边界固定为 `rows between unbounded preceding and current row`，用户不得配置；
- 未声明 `partition by` 时，全表视为一个分区。

### 约束

- `value` 只允许字段引用或 `*`，不允许标量表达式；
- 只有 `cumulative_count` 允许 `*`；
- `over(...)` 必须包含 `order by`，且至少一个排序字段；
- `over(...)` 可以包含 `partition by`，也可以省略；
- `over(...)` 不得包含窗口边界或排除规则。

## 8. 前后行（offset）

> **状态**：📝 封装（已设计待实现）。
>
> - ⚠ 待实现：设计文档用 `offset_difference`，注册表内部历史需要同步修正；
> - ⚠ 待修正：`last_value` 的生成表达式需显式声明完整分区窗口边界。

偏移函数依赖排序后的行序决定偏移目标，读取当前行之前或之后的记录，或窗口内首尾、第 N 行取值。

### 函数签名

取窗口内位置值：

```text
lag(value [, offset])
lead(value [, offset])
first_value(value)
last_value(value)
nth_value(value, n)
```

偏移差值 / 差率：

```text
offset_difference(value, offset)
offset_rate(value, offset)
```

### 示例

```text
derive [上一条销售额] = lag([销售额]) over(partition by [区域] order by [日期])
derive [下一条销售额] = lead([销售额], 2) over(partition by [区域] order by [日期])
derive [首笔销售额] = first_value([销售额]) over(partition by [区域] order by [日期])
derive [末笔销售额] = last_value([销售额]) over(partition by [区域] order by [日期])
derive [第N笔销售额] = nth_value([销售额], 3) over(partition by [区域] order by [日期])
```

```text
derive [销售额偏移差] =
  offset_difference([销售额], 2)
  over(partition by [区域] order by [金额] desc, [日期])
```

```text
derive [销售额偏移率] =
  offset_rate([销售额], 2)
  over(partition by [区域] order by [日期])
```

### 语义

- 分组内按 `over(... order by ...)` 排序后，以物理行序计算偏移；
- `lag(value [, offset])`：分区内向前第 `offset` 行的值，`offset` 缺省为 1；
- `lead(value [, offset])`：向后第 `offset` 行的值，`offset` 缺省为 1；
- `first_value`：分区内第一行值；
- `last_value`：目标为分区内最后一行值（**当前实现待修正**，见 §15.2 待办）；
- `nth_value(value, n)`：分区内第 `n` 行值；
- `offset_difference(value, offset)`：当前值减偏移行值；
- `offset_rate(value, offset)`：当前值减偏移行值，再除以偏移行值；
- 偏移行不存在时（分区前 `offset` 行或不足 `n` 行）返回 `NULL`；
- `offset_rate` 偏移行值为零时返回 `NULL`；
- 未声明 `partition by` 时，全表视为一个分区。

### 约束

- `value` 可以是字段引用或标量表达式；
- `offset`、`n` 必须是正整数；
- `lag` / `lead` 的第二个参数缺省为 1，省略时只传一个参数；
- `over(...)` 必须包含 `order by`，且至少一个排序字段；
- `over(...)` 可以包含 `partition by`，也可以省略；
- `over(...)` 不得包含窗口边界或排除规则。

## 9. 滑动窗口（moving_window）

> **状态**：📝 封装（已设计待实现），统一封装为 `moving_*` 函数（`moving_sum`、`moving_avg` 等）。
> frame 作为场景附加子句参与 DSL，不做进一步领域化。

滑动窗口函数在自定义窗口内计算聚合，frame 为完整自定义窗口。

### 函数签名

```text
moving_sum(value)
moving_avg(value)
moving_count(value)
moving_min(value)
moving_max(value)
```

### DSL 形态

```text
moving_avg([销售额]) over(partition by [区域] order by [日期] rows between 1 preceding and current row)
moving_sum([销售额]) over(order by [日期] range between interval 7 "day" preceding and current row)
moving_avg([销售额]) over(order by [日期] rows between 2 preceding and 2 following exclude current row)
moving_sum([销售额]) over(partition by [区域] order by [日期] rows between unbounded preceding and current row)
moving_count([销售额]) over(order by [日期] rows between 1 preceding and unbounded following)
```

### 语义

- 分区内按 `over(... order by ...)` 排序后，在自定义 frame 内计算聚合；
- frame 支持 `rows` / `range` / `groups` 三种类型；
- frame 边界支持 `unbounded preceding`、`unbounded following`、`current row` 三种特殊边界，分别为第一行、最后一行、当前行；
- frame 边界支持 `n preceding/following` 的一般形式，表示前 N 行、后 N 行；
- `range` 可带时间单位 `interval n unit preceding/following`；
- 可带 `exclude current row` / `group` / `ties`。

### 约束

- `value` 为字段引用或 `*`（仅 `moving_count` 支持 `*`）；
- `over(...)` 必须包含 `order by`；
- `over(...)` 可以包含 `partition by`，也可以省略；
- `RANGE` 偏移需恰好 1 个排序字段；
- frame 子句（`rows`/`range`/`groups` 及边界）作为场景附加子句参与 DSL，边界词汇统一使用 `unbounded preceding` / `unbounded following`。

## 10. 周期对比（period_compare）

> **状态**：✅ 已实现。

周期对比函数与历史同期数据比较，排序字段固定为单个日期参数。

### 函数签名

```text
previous_value(value, order_field)
previous_difference(value, order_field)
previous_rate(value, order_field)
year_over_year_value(value, date_field, grain)
year_over_year_difference(value, date_field, grain)
year_over_year_rate(value, date_field, grain)
```

### 示例

```text
derive [上一期销售额] = previous_value([销售额], [日期])
derive [销售额环比增量] = previous_difference([销售额], [日期]) over(partition by [区域], [产品])
derive [销售额环比增长率] = previous_rate([销售额], [日期]) over(partition by [区域])
derive [去年同期销售额] = year_over_year_value([销售额], [日期], "month") over(partition by [区域])
derive [销售额同比增长率] = year_over_year_rate([销售额], [日期], "month") over(partition by [区域])
```

### 周期粒度

| 值          | 同期匹配键       |
| ----------- | ---------------- |
| `"year"`    | 上一年           |
| `"quarter"` | 上一年相同季度   |
| `"month"`   | 上一年相同月份   |
| `"week"`    | 上一年相同周序号 |
| `"day"`     | 上一年相同月日   |

### 语义

- `previous_*`：分组内按 `order_field` 升序后的上一条记录；第一条返回 `NULL`；
- `year_over_year_*`：同期记录与当前记录严格相差一年；同期不存在返回 `NULL`；
- `previous_difference` / `year_over_year_difference`：当前值减同期值；
- `previous_rate` / `year_over_year_rate`：差值除以同期值，同期值为零返回 `NULL`；
- 未声明 `over(...)` 时，全表视为一个业务分组。

### 约束

- 日期 / 排序参数必须是单个日期或时间字段引用；
- `grain` 必须是受支持的双引号字符串字面量；
- `over(...)` 只能包含 `partition by`；
- 同一「业务分组 + 年份 + 周期粒度」组合必须唯一，歧义数据执行必须失败（`AMBIGUOUS_PERIOD_ROWS`，**待实现**）。

## 11. 时间累计（time_accumulation）

> **状态**：✅ 已实现。

时间累计函数按时间周期累计。

### 函数签名

```text
year_to_date(aggregate, date_field [, fiscal_start_month])
quarter_to_date(aggregate, date_field)
month_to_date(aggregate, date_field)
week_to_date(aggregate, date_field)
rolling_time(aggregate, date_field, size, unit)
```

### 示例

```text
derive [年累计销售额] = year_to_date(sum([销售额]), [日期]) over(partition by [区域])
derive [财年累计销售额] = year_to_date(sum([销售额]), [日期], 4) over(partition by [区域])
derive [近7天销售额] = rolling_time(sum([销售额]), [日期], 7, "day") over(partition by [区域])
```

### 允许的聚合参数

```text
sum(expr) / avg(expr) / count(expr) / count(*) / count(distinct field_ref)
min(expr) / max(expr)
```

### 语义

- 按 `date_field` 升序计算；
- `*_to_date`：从当前周期首行累计到当前行，周期变化时重新开始；
- `rolling_time`：时间范围 `[当前时间 - size unit, 当前时间]`，使用日期值范围而非物理行数；
- `fiscal_start_month` 只改变 `year_to_date` 的年度边界；
- 未声明 `over(...)` 时，全表视为一个业务分组。

### 约束

- `aggregate` 必须是直接聚合调用，遵循允许的聚合参数白名单；
- `date_field` 必须是单个日期或时间字段引用；
- `fiscal_start_month` 只能用于 `year_to_date`，必须是 1 到 12 的整数；
- `size` 必须是正整数字面量；
- `unit` 必须是 `"day"`、`"week"`、`"month"`、`"quarter"` 或 `"year"`；
- `over(...)` 只能包含 `partition by`。

## 12. 校验层次

### 12.1 语法校验

解析阶段必须检查：

- 函数名是否受支持；
- 括号、逗号和 `over(...)` 结构是否完整；
- 参数数量是否与函数签名完全一致；
- 字段参数是否是完整字段引用；
- 枚举参数是否是受支持的双引号字符串字面量；
- 数值参数是否是合法整数字面量。

### 12.2 Schema 语义校验

已知上游 schema 时必须检查：

- 引用字段是否存在；
- 日期参数是否为日期或时间类型；
- 聚合函数参数是否满足函数要求；
- 目标字段是新增还是覆盖。

表达式结果类型不在 DSL 输入层推断，交由数据库执行和结果 schema 推导。

### 12.3 数据语义校验

只有执行时才能判断的条件包括：

- 同比周期是否存在重复记录；
- 排序字段是否存在无法稳定排序的重复值；
- 数据库是否支持当前字段类型上的聚合计算。

不满足领域函数确定性要求时必须显式失败，不得静默选择任意记录或自动改变计算方式。

## 13. 稳定诊断

建议为领域函数增加以下诊断代码：

| 诊断代码                       | 含义                                                 |
| ------------------------------ | ---------------------------------------------------- |
| `UNKNOWN_CALCULATION_FUNCTION` | 不支持的计算字段领域函数                             |
| `INVALID_ARGUMENT_COUNT`       | 参数数量不符合函数签名                               |
| `INVALID_ARGUMENT_TYPE`        | 参数形式或类型不符合要求                             |
| `INVALID_PERIOD_GRAIN`         | 不支持的同比周期粒度                                 |
| `INVALID_INTERVAL_UNIT`        | 不支持的滚动时间单位                                 |
| `INVALID_FISCAL_START_MONTH`   | 财年起始月不是 1 到 12 的整数                        |
| `TEMPORAL_FIELD_REQUIRED`      | 日期参数不是日期或时间字段                           |
| `AGGREGATE_ARGUMENT_REQUIRED`  | 时间累计首个参数不是直接聚合调用                     |
| `UNSUPPORTED_AGGREGATION`      | 聚合函数不在白名单中                                 |
| `INVALID_DOMAIN_WINDOW_OVER`   | 领域函数的 `over(...)` 包含非法子句                  |
| `AMBIGUOUS_PERIOD_ROWS`        | 同一业务分组和周期存在多条同比候选记录（**待实现**） |
| `OFFSET_REQUIRES_ORDER`        | 偏移函数的 `over(...)` 缺少 `order by`               |
| `OFFSET_VALUE_REQUIRED`        | 偏移函数缺少 `value` 参数                            |
| `INVALID_OFFSET_VALUE`         | 偏移函数的偏移量不是正整数                           |
| `CUMULATIVE_REQUIRES_ORDER`    | 累计函数的 `over(...)` 缺少 `order by`               |
| `INVALID_CUMULATIVE_VALUE`     | 累计函数的 `value` 不是字段引用或 `*`                |
| `GROUP_METRIC_VALUE_REQUIRED`  | 组内指标函数缺少 `value` 参数                        |
| `MOVING_REQUIRES_ORDER`        | 滑动窗口函数的 `over(...)` 缺少 `order by`           |
| `INVALID_MOVING_VALUE`         | 滑动窗口函数的 `value` 不是字段引用或 `*`            |

领域函数解析失败时不得将其作为普通未知函数透传给 DuckDB。

## 14. 落地范围

实现本文档时需要同步修改完整调用链：

1. 表达式 tokenizer 和 parser；
2. 领域函数 AST 或等价结构化表示；
3. `calculate_field` parser 和 exporter；
4. 参数、schema 和数据语义 validator；
5. DuckDB SQL 编译器；
6. 图形化配置与 DSL 双向转换；
7. 运行时 DSL reference；
8. parser、exporter、编译和 DuckDB 集成测试。

在上述链路未完成前，不应将领域函数标记为可执行 DSL，也不应使用底层展开 SQL 替代规范 DSL
进行保存。

## 15. 待办与待讨论事项

### 15.1 待办：分析场景表达式隔离

后续需要实现以下约束：

- 分析场景函数必须独占 `derive` 右侧表达式；
- 不允许分析场景函数参与四则运算；
- 不允许使用标量函数包裹分析场景函数；
- 不允许在一条计算中混合多个分析场景函数；
- 对上述输入返回稳定诊断，不将其透传至 DuckDB。

该约束用于保证每个分析场景具有明确的数据分析目的，并支持规范 DSL 无损恢复到图形化配置区。

### 15.2 待办：累计、组内指标、滑动窗口和偏移领域 DSL 落地

- 实现 `cumulative_*` 领域函数的解析、规范化、配置回填和执行展开；
- 实现 `group_*` 前缀的组内指标函数（`group_sum`、`group_avg` 等），以及
  `percentage`、`count_distinct` 的领域函数解析、规范化、回填与展开；
- 实现 `moving_*` 滑动窗口函数（`moving_sum`、`moving_avg` 等）的解析、规范化、
  回填与执行展开；
- 统一 `offset_difference` 与内部历史名称 `offset_diff`；
- 实现 `offset_difference`、`offset_rate` 的规范 DSL 双向转换；
- 修正 `last_value` 的完整分区窗口边界（显式声明
  `rows between unbounded preceding and unbounded following`），并增加 DuckDB 回归测试；
- 完成前，对应章节仅表示目标设计，不表示当前运行时能力。

### 15.3 待办：同比周期唯一性检测

- 实现 `AMBIGUOUS_PERIOD_ROWS` 检测：同一「业务分组 + 年份 + 周期粒度」存在多条记录时执行失败；
- 完成前不得将该检测作为已实现能力对外承诺。

### 15.4 待讨论：限定字段引用

领域函数中的 `[source].[field]` 是否应受支持尚未确定，需要讨论以下方案：

- 明确禁止限定字段，并在 DSL 解析阶段返回错误；或
- 保留完整来源和字段名称，使规范化、配置回填及执行均支持限定引用。

在方案确定前，不扩展限定字段能力，也不将当前行为作为稳定公共契约。

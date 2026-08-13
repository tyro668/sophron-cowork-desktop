# 计算字段领域函数 DSL 设计

## 1. 文档目标

本文档补充 `data-task-operator-dsl.md` 中尚未覆盖的计算字段领域函数设计，范围包括：

- 累计到当前行（`cumulative_sum`/`cumulative_avg`/`cumulative_count`/`cumulative_min`/`cumulative_max`/`cumulative_product`）；
- 偏移取值、差值和增长率（`lag`/`lead`/`first_value`/`last_value`/`nth_value` 与差值、差率）；
- 上一期取值、差值和增长率；
- 同比取值、差值和增长率；
- 年、季、月、周累计；
- 按时间范围滚动计算。

这些能力不新增工作流算子，仍通过 `calculate_field` 算子的公共 DSL 关键字 `derive`
表达。领域函数负责描述业务意图，编译器负责将其展开为 DuckDB 窗口表达式。

本文档只规定公共 DSL，不规定编译后 SQL 的具体文本形式。

## 2. 设计原则

### 2.1 使用领域函数表达业务意图

公共 DSL 不直接暴露由 `CASE`、`lag`、`extract` 和 `OVER` 组合而成的底层 SQL。例如：

```text
derive [去年同期销售额] = year_over_year_value([销售额], [日期], "month")
```

编译器可以在内部将其展开为 DuckDB 可执行的窗口表达式，但导出 DSL 时必须恢复为领域函数。

### 2.2 使用固定位置参数

领域函数采用固定位置参数，不引入 `date =>`、`grain =>` 等额外符号。解析器必须按函数签名
校验参数数量和参数类型。

### 2.3 分离函数语义和业务分组

- 函数参数描述计算值、日期字段、周期和聚合方式。
- 可选的 `over(partition by ...)` 只描述业务分组。
- 排序方向和窗口范围由领域函数定义，用户不重复配置。

排序承载规则按函数家族区分：

- 周期对比和时间累计的排序字段固定为单个日期参数，写在函数参数内，
  因此它们的 `over(...)` 只允许 `partition by`。
- 偏移函数和累计函数依赖排序后的行序决定偏移目标或累计推进顺序，
  排序字段个数和方向不固定，因此由 `over(... order by ...)` 承载，
  `over(...)` 必带 `order by`，`partition by` 可选。

### 2.4 规范化输出

- 字段引用遵循主 DSL 文档的方括号规则。
- 字符串字面量统一使用双引号。
- 关键字和函数名统一使用小写。
- 解析器可以兼容已存在的旧语法，但导出器只能生成本文档规定的规范形式。

## 3. 公共语法

```ebnf
domain_window_expr := cumulative_expr
                    | offset_expr
                    | previous_expr
                    | year_over_year_expr
                    | to_date_expr
                    | rolling_time_expr

partition_over_clause := "over" "(" "partition" "by" field_ref_list ")"

ordered_over_clause := "over" "(" ["partition" "by" field_ref_list]
                       "order" "by" sort_key ("," sort_key)* ")"

sort_key := field_ref ["asc" | "desc"]

cumulative_expr := cumulative_function
                   "(" value_arg ")"
                   ordered_over_clause

cumulative_function := "cumulative_sum"
                     | "cumulative_avg"
                     | "cumulative_count"
                     | "cumulative_min"
                     | "cumulative_max"
                     | "cumulative_product"

value_arg := field_ref | "*"

offset_expr := offset_function
               "(" scalar_expr ["," positive_integer] ")"
               ordered_over_clause

offset_function := "lag"
                 | "lead"
                 | "first_value"
                 | "last_value"
                 | "nth_value"
                 | "offset_difference"
                 | "offset_rate"

previous_expr := previous_function
                 "(" scalar_expr "," field_ref ")"
                 partition_over_clause?

previous_function := "previous_value"
                   | "previous_difference"
                   | "previous_rate"

year_over_year_expr := year_over_year_function
                       "(" scalar_expr "," field_ref "," period_grain ")"
                       partition_over_clause?

year_over_year_function := "year_over_year_value"
                         | "year_over_year_difference"
                         | "year_over_year_rate"

period_grain := "\"year\""
              | "\"quarter\""
              | "\"month\""
              | "\"week\""
              | "\"day\""

to_date_expr := to_date_function
                "(" aggregate_call "," field_ref ["," fiscal_start_month] ")"
                partition_over_clause?

to_date_function := "year_to_date"
                  | "quarter_to_date"
                  | "month_to_date"
                  | "week_to_date"

rolling_time_expr := "rolling_time"
                     "(" aggregate_call "," field_ref ","
                     positive_integer "," interval_unit ")"
                     partition_over_clause?

interval_unit := "\"day\""
               | "\"week\""
               | "\"month\""
               | "\"quarter\""
               | "\"year\""

fiscal_start_month := positive_integer
```

语法之外还必须执行本文档后续章节规定的语义校验。

## 4. 累计函数

> **待实现**：本节定义的是目标 DSL。当前领域 DSL 解析器尚未识别
> `cumulative_sum`、`cumulative_avg`、`cumulative_count`、`cumulative_min`、
> `cumulative_max` 和 `cumulative_product`。在解析、规范化、图形化回填和执行展开链路
> 完成前，不得将这些函数作为当前可执行 DSL 对外发布。

累计函数从分区首行开始，逐行累加到当前行。累计的推进顺序由
`over(... order by ...)` 决定，窗口边界固定为「首行到当前行」。

### 4.1 函数签名

```text
cumulative_sum(value)
cumulative_avg(value)
cumulative_count(value)
cumulative_min(value)
cumulative_max(value)
cumulative_product(value)
```

### 4.2 示例

```text
derive [累计销售额] =
  cumulative_sum([销售额])
  over(partition by [区域] order by [日期])
```

```text
derive [累计行数] =
  cumulative_count(*)
  over(partition by [区域] order by [日期])
```

```text
derive [累计连乘] =
  cumulative_product([系数])
  over(order by [日期] desc)
```

### 4.3 语义

- 分区内按 `over(... order by ...)` 声明的排序升序（或 `desc`）排列后，
  从分区首行逐行累计到当前行。
- `cumulative_sum` 返回累计求和；`cumulative_avg` 返回累计平均；
  `cumulative_min` / `cumulative_max` 返回到当前行为止的最小 / 最大值；
  `cumulative_count` 返回累计行数；`cumulative_product` 返回累计连乘。
- 窗口边界固定为 `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`，用户不得配置。
- `value` 只允许字段引用或 `*`，不允许标量表达式。
- 只有 `cumulative_count` 允许 `*`。
- 未声明 `partition by` 时，全表视为一个分区。

### 4.4 约束

- `value` 必须是单个字段引用或 `*`，不允许标量表达式。
- `cumulative_count` 的 `value` 可以是 `*` 或字段引用，其余函数必须是字段引用。
- `over(...)` 必须包含 `order by`，且至少一个排序字段。
- `over(...)` 可以包含 `partition by`，也可以省略。
- `over(...)` 不得包含窗口边界（`rows` / `range` / `groups`）或排除规则。

## 5. 偏移函数

> **待实现**：本节定义的是目标 DSL。当前领域 DSL 解析器尚未识别
> `offset_difference` 和 `offset_rate`，注册表内部仍使用历史名称 `offset_diff` 和
> `offset_rate`。在函数命名、解析、规范化、图形化回填和执行展开统一前，
> `offset_difference` 不得作为当前可执行 DSL 对外发布。

偏移函数依赖排序后的行序决定偏移目标。它们读取当前行之前或之后的记录，
或窗口内的首尾、第 N 行取值。偏移家族的排序字段个数和方向不固定，
统一由 `over(... order by ...)` 承载。

### 5.1 函数签名

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

### 5.2 示例

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

### 5.3 语义

- 分组内按 `over(... order by ...)` 声明的排序升序（或 `desc`）排列后，以物理行序计算偏移。
- `lag(value [, offset])` 返回同一分区内向前第 `offset` 行的值，`offset` 缺省为 `1`。
- `lead(value [, offset])` 返回向后第 `offset` 行的值，`offset` 缺省为 `1`。
- `first_value` 返回分区内第一行的值。
- `last_value` 的目标语义是返回分区内最后一行的值。**当前实现待修正**：生成表达式尚未显式
  使用 `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`，DuckDB 默认窗口可能
  截止当前行，因此当前结果可能是当前行而不是分区最后一行。在窗口边界修正前，不得将
  “分区最后一行”作为已实现能力对外承诺。
- `nth_value(value, n)` 返回分区内第 `n` 行的值。
- `offset_difference(value, offset)` 返回“当前值减偏移行值”。
- `offset_rate(value, offset)` 返回“当前值减偏移行值，再除以偏移行值”。
- 偏移行值不存在时（分区前 `offset` 行或分区内不足 `n` 行），返回 `NULL`。
- `offset_rate` 偏移行值为零时返回 `NULL`。
- 未声明 `partition by` 时，全表视为一个分区。

### 5.4 约束

- `value` 可以是字段引用或标量表达式。
- `offset`、`n` 必须是正整数。
- `lag` / `lead` 的第二个参数缺省为 `1`，省略时只传一个参数。
- `over(...)` 必须包含 `order by`，且至少一个排序字段。
- `over(...)` 可以包含 `partition by`，也可以省略。
- `over(...)` 不得包含窗口边界（`rows` / `range` / `groups`）或排除规则。

## 6. 上一期函数

### 6.1 函数签名

```text
previous_value(value, order_field)
previous_difference(value, order_field)
previous_rate(value, order_field)
```

### 6.2 示例

```text
derive [上一期销售额] = previous_value([销售额], [日期])
```

```text
derive [销售额环比增量] =
  previous_difference([销售额], [日期])
  over(partition by [区域], [产品])
```

```text
derive [销售额环比增长率] =
  previous_rate([销售额], [日期])
  over(partition by [区域])
```

### 6.3 语义

- 上一期表示分组内按照 `order_field` 升序排列后的上一条记录。
- 未声明 `over(...)` 时，全表视为一个分组。
- 第一条记录没有上一期，返回 `NULL`。
- 上一期值为 `NULL` 时，三个函数均返回 `NULL`。
- `previous_difference` 返回“当前值减上一期值”。
- `previous_rate` 返回“当前值减上一期值，再除以上一期值”。
- 上一期值为零时，`previous_rate` 返回 `NULL`。

### 6.4 约束

- 必须恰好传入两个参数。
- `value` 可以是字段引用或标量表达式。
- `order_field` 必须是单个字段引用。
- `order_field` 的值应能形成稳定顺序；存在相同排序值时，同行之间的先后顺序未定义。
- `over(...)` 只能包含 `partition by`，不得包含 `order by`、窗口边界或排除规则。

## 7. 同比函数

### 7.1 函数签名

```text
year_over_year_value(value, date_field, grain)
year_over_year_difference(value, date_field, grain)
year_over_year_rate(value, date_field, grain)
```

### 7.2 示例

```text
derive [去年同期销售额] =
  year_over_year_value([销售额], [日期], "month")
  over(partition by [区域])
```

```text
derive [销售额同比增长率] =
  year_over_year_rate([销售额], [日期], "month")
  over(partition by [区域], [产品])
```

### 7.3 周期粒度

`grain` 必须是以下字符串字面量之一：

| 值          | 同期匹配键       |
| ----------- | ---------------- |
| `"year"`    | 上一年           |
| `"quarter"` | 上一年相同季度   |
| `"month"`   | 上一年相同月份   |
| `"week"`    | 上一年相同周序号 |
| `"day"`     | 上一年相同月日   |

### 7.4 语义

- 同期记录必须与当前记录严格相差一年。
- 同期记录不存在时返回 `NULL`，不得退化为最近一条记录。
- 同期值为 `NULL` 时返回 `NULL`。
- `year_over_year_difference` 返回“当前值减同期值”。
- `year_over_year_rate` 返回“当前值减同期值，再除以同期值”。
- 同期值为零时，`year_over_year_rate` 返回 `NULL`。
- 未声明 `over(...)` 时，全表视为一个业务分组。

### 7.5 约束

- 必须恰好传入三个参数。
- `value` 可以是字段引用或标量表达式。
- `date_field` 必须是单个日期或时间字段引用。
- `grain` 必须是受支持的字符串字面量，不允许使用字段、变量或任意表达式。
- `over(...)` 只能包含 `partition by`。
- 每个“业务分组 + 年份 + 周期粒度”组合必须唯一。
- 同一组合存在多条记录时属于歧义数据，执行必须失败并提示用户先聚合，不得随机选择、
  自动聚合或依赖物理行顺序。

> **待实现**：上述“歧义数据执行必须失败”（`AMBIGUOUS_PERIOD_ROWS` 检测）尚未实现。
> 当前实现依赖窗口排序使用 `lag()` 取同期值，同组合多行时结果不确定。
> 检测能力将随同比/环比功能的后续重构一并补齐。

建议的歧义诊断：

```text
周期对比失败：当前业务分组和周期内存在多条记录，请先按分组和周期聚合。
```

## 8. 时间累计函数

### 8.1 函数签名

```text
year_to_date(aggregate, date_field)
year_to_date(aggregate, date_field, fiscal_start_month)
quarter_to_date(aggregate, date_field)
month_to_date(aggregate, date_field)
week_to_date(aggregate, date_field)
```

### 8.2 示例

```text
derive [年累计销售额] =
  year_to_date(sum([销售额]), [日期])
  over(partition by [区域])
```

```text
derive [财年累计销售额] =
  year_to_date(sum([销售额]), [日期], 4)
  over(partition by [区域])
```

```text
derive [月累计订单数] =
  month_to_date(count(*), [日期])
  over(partition by [区域])
```

### 8.3 允许的聚合参数

`aggregate` 必须是一个直接聚合函数调用，只允许：

```text
sum(expr)
avg(expr)
count(expr)
count(*)
count(distinct field_ref)
min(expr)
max(expr)
```

主 DSL 中“不允许裸聚合函数”的约束继续有效，但增加以下例外：

> 聚合函数可以作为时间累计领域函数的直接参数，由外层领域函数提供窗口语义。

不允许以下形式：

```text
year_to_date([销售额], [日期])
year_to_date("sum", [销售额], [日期])
year_to_date(sum([销售额]) + 1, [日期])
year_to_date(sum([销售额]) over(partition by [区域]), [日期])
```

### 8.4 语义

- 按 `date_field` 升序计算。
- 窗口起点为当前周期第一条记录，终点为当前行。
- 年、季、月、周发生变化时分别重新开始累计。
- 未声明 `over(...)` 时，全表视为一个业务分组。
- `fiscal_start_month` 只改变 `year_to_date` 的年度边界。

### 8.5 约束

- `date_field` 必须是单个日期或时间字段引用。
- `fiscal_start_month` 只能用于 `year_to_date`。
- `fiscal_start_month` 必须是 `1` 到 `12` 的整数字面量。
- 其他累计函数出现第三个参数时必须报错。
- `over(...)` 只能包含 `partition by`。
- 同一分组中日期值相同时，行级累计的先后顺序未定义。需要严格行级顺序时，用户应使用
  能够唯一排序的日期时间字段，或先整理数据粒度。

## 9. 滚动时间函数

### 9.1 函数签名

```text
rolling_time(aggregate, date_field, size, unit)
```

### 9.2 示例

```text
derive [近7天销售额] =
  rolling_time(sum([销售额]), [日期], 7, "day")
  over(partition by [区域])
```

```text
derive [近3月平均销售额] =
  rolling_time(avg([销售额]), [日期], 3, "month")
  over(partition by [区域], [产品])
```

### 9.3 语义

- 时间范围为闭区间 `[当前时间 - size unit, 当前时间]`。
- 时间窗口包含当前行。
- 使用日期值范围计算，不使用物理行数计算。
- 未声明 `over(...)` 时，全表视为一个业务分组。

### 9.4 约束

- 必须恰好传入四个参数。
- `aggregate` 遵循时间累计函数的聚合参数白名单。
- `date_field` 必须是单个日期或时间字段引用。
- `size` 必须是正整数字面量。
- `unit` 必须是 `"day"`、`"week"`、`"month"`、`"quarter"` 或 `"year"`。
- `over(...)` 只能包含 `partition by`。

## 10. `over(...)` 约束

`over(...)` 的合法内容按函数家族区分。

### 10.1 周期对比和时间累计函数

这类函数的日期参数已经决定排序字段和窗口语义，因此其 `over(...)` 只允许业务分组：

```text
over(partition by [区域], [产品])
```

以下形式均非法：

```text
over(order by [日期])
over(partition by [区域] order by [日期])
over(partition by [区域] rows between unbounded preceding and current row)
```

### 10.2 偏移和累计函数

偏移函数和累计函数的排序字段由 `over(... order by ...)` 承载，因此其 `over(...)`
必带 `order by`，`partition by` 可选：

```text
over(order by [日期])
over(partition by [区域] order by [金额] desc, [日期])
```

以下形式均非法：

```text
over(partition by [区域])
over(partition by [区域] rows between unbounded preceding and current row)
over(order by [日期] rows between 1 preceding and current row)
```

这样可以避免函数参数与 `over(...)` 同时声明排序或窗口边界，形成两个相互冲突的配置来源。

## 11. 校验层次

### 11.1 语法校验

解析阶段必须检查：

- 函数名是否受支持；
- 括号、逗号和 `over(...)` 结构是否完整；
- 参数数量是否与函数签名完全一致；
- 字段参数是否是完整字段引用；
- 枚举参数是否是受支持的双引号字符串字面量；
- 数值参数是否是合法整数字面量。

### 11.2 Schema 语义校验

已知上游 schema 时必须检查：

- 引用字段是否存在；
- 日期参数是否为日期或时间类型；
- 聚合函数参数是否满足函数要求；
- 目标字段是新增还是覆盖。

表达式结果类型不在 DSL 输入层推断，交由数据库执行和结果 schema 推导。

### 11.3 数据语义校验

只有执行时才能判断的条件包括：

- 同比周期是否存在重复记录；
- 排序字段是否存在无法稳定排序的重复值；
- 数据库是否支持当前字段类型上的聚合计算。

不满足领域函数确定性要求时必须显式失败，不得静默选择任意记录或自动改变计算方式。

## 12. 稳定诊断

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

领域函数解析失败时不得将其作为普通未知函数透传给 DuckDB。

## 13. 规范化示例

```text
derive
  [累计销售额] =
    cumulative_sum([销售额])
    over(partition by [区域] order by [日期]),
  [销售额偏移差] =
    offset_difference([销售额], 2)
    over(partition by [区域] order by [日期]),
  [上一期销售额] =
    previous_value([销售额], [日期])
    over(partition by [区域]),
  [同比增长率] =
    year_over_year_rate([销售额], [日期], "month")
    over(partition by [区域]),
  [年累计销售额] =
    year_to_date(sum([销售额]), [日期])
    over(partition by [区域]),
  [近30天销售额] =
    rolling_time(sum([销售额]), [日期], 30, "day")
    over(partition by [区域])
```

保存和导出时可以规范化为空格稳定的单行形式，但不能展开成底层 DuckDB SQL。

## 14. 旧语法兼容

当前代码中已存在以下历史语法：

```text
period_compare(yoy_diff, [销售额], [日期])
accumulate(ytd, sum, [销售额], [日期])
```

规范处理策略：

- 如果这些语法尚未形成已保存数据，可以直接移除。
- 如果已有历史任务，解析器可以继续识别它们作为迁移输入。
- 旧语法不得继续出现在图形化页面、运行时 DSL reference 或新设计文档中。
- 任何旧语法在重新保存或导出后，都必须转换为本文档规定的新领域函数形式。
- 不允许在旧语法解析失败后静默退化成普通表达式。

## 15. 落地范围

实现本文档时需要同步修改完整调用链：

1. 表达式 tokenizer 和 parser；
2. 领域函数 AST 或等价结构化表示；
3. `calculate_field` parser 和 exporter；
4. 参数、schema 和数据语义 validator；
5. DuckDB SQL 编译器；
6. 图形化配置与 DSL 双向转换；
7. 运行时 DSL reference；
8. parser、exporter、编译和 DuckDB 集成测试。

在上述链路未完成前，不应将领域函数标记为可执行 DSL，也不应使用底层展开 SQL替代规范 DSL
进行保存。

## 16. 待办与待讨论事项

### 16.1 待办：分析场景表达式隔离

后续需要实现以下约束：

- 分析场景函数必须独占 `derive` 右侧表达式；
- 不允许分析场景函数参与四则运算；
- 不允许使用标量函数包裹分析场景函数；
- 不允许在一条计算中混合多个分析场景函数；
- 对上述输入返回稳定诊断，不将其透传至 DuckDB。

该约束用于保证每个分析场景具有明确的数据分析目的，并支持规范 DSL 无损恢复到图形化配置区。

### 16.2 待办：累计和偏移领域 DSL 落地

- 实现 `cumulative_*` 领域函数的解析、规范化、配置回填和执行展开；
- 统一 `offset_difference` 与内部历史名称 `offset_diff`；
- 实现 `offset_difference`、`offset_rate` 的规范 DSL 双向转换；
- 修正 `last_value` 的完整分区窗口边界，并增加 DuckDB 回归测试；
- 完成前，文档第 4、5 节仅表示目标设计，不表示当前运行时能力。

### 16.3 待讨论：限定字段引用

领域函数中的 `[source].[field]` 是否应受支持尚未确定，需要讨论以下方案：

- 明确禁止限定字段，并在 DSL 解析阶段返回错误；或
- 保留完整来源和字段名称，使规范化、配置回填及执行均支持限定引用。

在方案确定前，不扩展限定字段能力，也不将当前行为作为稳定公共契约。

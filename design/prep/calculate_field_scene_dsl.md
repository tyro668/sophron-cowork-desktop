# 计算字段场景 DSL 规范

## 1. 文档范围

本文档规定计算字段算子以下七个分析场景的公开语法，以及图形化配置生成 DSL、DSL
规范化、SQL 展开和可回填配置的共同契约：

1. 组内指标；
2. 排名；
3. 累计；
4. 跨行引用；
5. 滑动窗口；
6. 周期对比；
7. 时间累计。

自由表达式继续使用 `derive [字段] = expression`，不增加场景包装。

`group_sum`、`cumulative_sum`、`year_over_year_rate` 等旧公开形式不属于当前规范，解析时
必须明确报错。内部 TypeScript 标识符可以继续使用下划线命名，但不得直接作为公开 DSL
输出。

## 2. 设计原则

### 2.1 场景与功能分层

分析表达式采用统一结构：

```text
derive [target] = scene(operation(...)) over(...)
```

- `scene` 只负责标识图形化场景；
- `operation` 负责标识场景中的具体功能；
- 功能参数放在 `operation(...)` 内；
- 分组、排序和窗口边界统一放在 `over(...)` 内；
- 场景函数必须独占 `derive` 右侧，不得参与四则运算、被标量函数包裹或与其他场景混合。

### 2.2 命名

- 公开关键字和函数名统一使用小写；
- 不使用 `group_sum`、`year_over_year` 一类由场景与功能拼接产生的下划线名称；
- SQL 原生函数保留标准名称，包括 `row_number`、`dense_rank`、`var_pop` 等名称中的下划线；
- 场景提供语境后，内部功能只表达动作或指标，不重复场景名称；
- 优先复用 SQL、DAX 和数据分析领域的成熟术语，不为缩短文本创造缩写；
- 字符串枚举统一使用双引号。

### 2.3 参数顺序

参数按照“主要计算对象 → 计算依据 → 附加参数 → 输出形式”的顺序排列。结果类型属于对
既定计算的输出选择，因此放在最后。

## 3. 公共语法

```ebnf
derive_statement := "derive" field_ref "=" (free_expression | scene_expression)

scene_expression := scene_keyword "(" operation_call ")" over_clause?
scene_keyword    := "group" | "ranking" | "running" | "reference" | "moving" | "compare"
                  | "accumulate"
operation_call   := identifier "(" argument_list? ")"

over_clause := "over" "(" [partition_clause]
                           [order_clause]
                           [frame_clause] ")"

partition_clause := "partition" "by" field_ref ("," field_ref)*
order_clause     := "order" "by" sort_key ("," sort_key)*
sort_key         := field_ref ["asc" | "desc"]

frame_clause := frame_type "between" frame_bound "and" frame_bound
                ["exclude" frame_exclude]
frame_type   := "rows" | "range" | "groups"
frame_bound  := "unbounded preceding" | "unbounded following" | "current row"
              | positive_integer ("preceding" | "following")
              | "interval" positive_integer interval_unit ("preceding" | "following")
frame_exclude := "current row" | "group" | "ties" | "no others"
interval_unit := "\"day\"" | "\"week\"" | "\"month\"" | "\"quarter\"" | "\"year\""
```

`over(...)` 一旦出现，至少必须包含一个符合当前场景约束的子句，不允许空的 `over()`。

场景对 `over(...)` 的约束：

| 场景         | `partition by` | `order by` | frame        |
| ------------ | -------------- | ---------- | ------------ |
| `group`      | 可选           | 禁止       | 禁止         |
| `ranking`    | 可选           | 必填       | 禁止         |
| `running`    | 可选           | 必填       | 内置，不输出 |
| `reference`  | 可选           | 必填       | 禁止         |
| `moving`     | 可选           | 必填       | 必填         |
| `compare`    | 可选           | 禁止       | 禁止         |
| `accumulate` | 可选           | 禁止       | 内置，不输出 |

## 4. 组内指标：`group`

### 4.1 语法

```text
group(operation(value [, parameter])) over(partition by ...)
```

支持的功能：

```text
sum(value) / avg(value) / min(value) / max(value)
median(value) / stddev(value) / var_pop(value) / mode(value)
bool_and(value) / bool_or(value)
count(value | *)
count_distinct(value)
quantile_cont(value, q)
string_agg(value, delimiter)
percentoftotal(value)
```

### 4.2 示例

```text
derive [区域销售额] = group(sum([销售额])) over(partition by [区域])
derive [区域客户数] = group(count_distinct([客户])) over(partition by [区域])
derive [区域销售占比] = group(percentoftotal([销售额])) over(partition by [区域])
derive [名称列表] = group(string_agg([名称], ", ")) over(partition by [区域])
```

### 4.3 约束

- `over(...)` 只允许 `partition by`；
- 分组为空时省略整个 `over(...)`，全表视为一个分组；
- `q` 必须是 0 到 1 的数值；
- 只有 `count` 支持 `*`。

## 5. 排名：`ranking`

### 5.1 语法

```text
ranking(method(...)) over(partition by ... order by ...)
```

支持的排名方式：

```text
row_number()
rank()
dense_rank()
percent_rank()
cume_dist()
ntile(buckets)
```

### 5.2 示例

```text
derive [行序号] = ranking(row_number()) over(partition by [区域] order by [日期])
derive [销售排名] = ranking(rank()) over(partition by [区域] order by [销售额] desc)
derive [密集排名] = ranking(dense_rank()) over(order by [销售额] desc)
derive [销售四分位] = ranking(ntile(4)) over(order by [销售额] desc)
```

### 5.3 语义与约束

- `row_number` 为唯一行序号；
- `rank` 为并列且跳号的标准排名；
- `dense_rank` 为并列但不跳号的密集排名；
- `percent_rank` 为百分比排名；
- `cume_dist` 为累积分布；
- `ntile` 为均匀分桶，`buckets` 必须是正整数；
- `over(...)` 必须包含至少一个排序字段，不允许 frame。

## 6. 累计：`running`

### 6.1 语法

```text
running(operation(value)) over(partition by ... order by ...)
```

支持的功能：

```text
sum(value)
avg(value)
count(value | *)
min(value)
max(value)
product(value)
```

### 6.2 示例

```text
derive [累计销售额] = running(sum([销售额])) over(partition by [区域] order by [日期])
derive [累计行数] = running(count(*)) over(partition by [区域] order by [日期])
```

### 6.3 语义与约束

- 从分区首行累计到当前行；
- 固定窗口为 `rows between unbounded preceding and current row`；
- 固定窗口属于场景语义，不在规范 DSL 中输出，也不允许用户配置；
- `over(...)` 必须包含至少一个排序字段；
- 只有 `count` 支持 `*`。

## 7. 跨行引用：`reference`

### 7.1 语法

```text
reference(operation(value [, parameter])) over(partition by ... order by ...)
```

支持的功能：

```text
lag(value [, offset])
lead(value [, offset])
first(value)
last(value)
nth(value, n)
difference(value, offset)
rate(value, offset)
```

### 7.2 示例

```text
derive [上一条销售额] = reference(lag([销售额])) over(partition by [区域] order by [日期])
derive [下一条销售额] = reference(lead([销售额], 2)) over(partition by [区域] order by [日期])
derive [首笔销售额] = reference(first([销售额])) over(partition by [区域] order by [日期])
derive [偏移差值] = reference(difference([销售额], 2)) over(partition by [区域] order by [日期])
```

### 7.3 语义与约束

- `lag`、`lead` 的 `offset` 省略时为 1；
- `first`、`last`、`nth` 分别引用分区第一行、最后一行和第 N 行；
- `reference` 在展开 SQL 时使用完整分区窗口；该固定 frame 不在规范 DSL 中输出；
- `difference` 返回当前值减偏移行值；
- `rate` 返回差值除以偏移行值，偏移行值为 0 或 `NULL` 时返回 `NULL`；
- `offset` 和 `n` 必须是正整数；
- `over(...)` 必须包含至少一个排序字段，不允许 frame。

## 8. 滑动窗口：`moving`

### 8.1 语法

```text
moving(operation(value)) over(partition by ... order by ... frame)
```

支持的功能：

```text
sum(value)
avg(value)
count(value | *)
min(value)
max(value)
```

### 8.2 示例

```text
derive [近七条平均销售额] =
  moving(avg([销售额]))
  over(partition by [区域] order by [日期] rows between 6 preceding and current row)

derive [近七天销售额] =
  moving(sum([销售额]))
  over(order by [日期] range between interval 7 "day" preceding and current row)
```

### 8.3 语义与约束

- `over(...)` 必须同时包含排序和 frame；
- frame 支持 `rows`、`range` 和 `groups`；
- 带时间单位的 `range` 必须恰好有一个排序字段；
- 只有 `count` 支持 `*`；
- `moving` 表示范围随当前行移动；`over(...)` 负责描述具体窗口边界。

## 9. 周期对比：`compare`

周期对比以 `compare` 标识场景，以 `previous` 和 `sameperiodlastyear` 区分环比与
同比。两个功能函数都把结果类型放在最后。

### 9.1 环比：`previous`

```text
compare(previous(value, order_field, result)) over(partition by ...)
```

`result` 支持：

```text
"value" | "difference" | "percentchange"
```

示例：

```text
derive [上一期销售额] = compare(previous([销售额], [日期], "value"))
derive [环比差值] =
  compare(previous([销售额], [日期], "difference")) over(partition by [区域])
derive [环比增长率] =
  compare(previous([销售额], [日期], "percentchange")) over(partition by [区域])
```

`previous` 的当前业务语义是：在业务分组内按照 `order_field` 升序排列，取上一条记录。
它不承诺时间周期连续，因此不使用语义更宽且可能暗示连续周期的 `periodoverperiod`。

### 9.2 同比：`sameperiodlastyear`

```text
compare(sameperiodlastyear(value, date_field, grain, result)) over(partition by ...)
```

`grain` 支持：

```text
"year" | "quarter" | "month" | "week" | "day"
```

示例：

```text
derive [去年同期销售额] =
  compare(sameperiodlastyear([销售额], [日期], "month", "value"))
  over(partition by [区域])

derive [同比增长率] =
  compare(sameperiodlastyear([销售额], [日期], "month", "percentchange"))
  over(partition by [区域])
```

`sameperiodlastyear` 复用 DAX 的成熟术语。DAX 从日期上下文推导粒度；本项目是逐行计算，
因此通过 `grain` 显式规定同期匹配粒度。

### 9.3 结果语义

- `"value"`：返回上一条记录或去年同期记录的指标值；
- `"difference"`：返回当前值减参考值；
- `"percentchange"`：返回 `(当前值 - 参考值) / 参考值`；
- 参考记录缺失时返回 `NULL`；
- `percentchange` 的参考值为 0 或 `NULL` 时返回 `NULL`；
- `over(...)` 只允许 `partition by`，排序依据由功能函数的时间字段承担；
- 当前实现不预检同比候选记录是否唯一；同一业务分组、同期粒度和年份内存在多条记录时，
  数据库窗口排序存在并列，结果不保证稳定。使用方应先保证该组合唯一。

## 10. 时间累计：`accumulate`

时间累计以 `accumulate` 标识场景，以 To-date 功能或滚动时间功能标识累计范围。

### 10.1 函数签名

```text
accumulate(yeartodate(aggregate, date_field [, fiscal_start_month]))
accumulate(quartertodate(aggregate, date_field))
accumulate(monthtodate(aggregate, date_field))
accumulate(weektodate(aggregate, date_field))
accumulate(rolling(aggregate, date_field, size, unit))
```

允许的聚合参数：

```text
sum(value)
avg(value)
count(value | *)
count(distinct field_ref)
min(value)
max(value)
```

### 10.2 示例

```text
derive [年累计销售额] =
  accumulate(yeartodate(sum([销售额]), [日期]))
  over(partition by [区域])

derive [财年累计销售额] =
  accumulate(yeartodate(sum([销售额]), [日期], 4))
  over(partition by [区域])

derive [季度累计销售额] =
  accumulate(quartertodate(sum([销售额]), [日期]))
  over(partition by [区域])

derive [月累计销售额] =
  accumulate(monthtodate(sum([销售额]), [日期]))
  over(partition by [区域])

derive [周累计销售额] =
  accumulate(weektodate(sum([销售额]), [日期]))
  over(partition by [区域])

derive [近七天销售额] =
  accumulate(rolling(sum([销售额]), [日期], 7, "day"))
  over(partition by [区域])
```

### 10.3 语义

- `yeartodate`、`quartertodate`、`monthtodate`、`weektodate` 分别从当前年、季度、月、
  周的起点累计到当前记录；
- `fiscal_start_month` 只适用于 `yeartodate`，用于指定财年起始月份；
- `rolling` 使用真实时间范围 `[当前时间 - size unit, 当前时间]`，不按物理记录数计算；
- `date_field` 同时承担时间范围判断和升序推进依据；
- 分组为空时省略整个 `over(...)`，全表视为一个业务分组；
- 固定时间边界属于场景语义，不在规范 DSL 中展开为 frame。

### 10.4 约束

- `aggregate` 必须是白名单中的直接聚合调用；
- `date_field` 必须是单个日期或日期时间字段引用；
- `fiscal_start_month` 必须是 1 到 12 的整数；
- `size` 必须是正整数；
- `unit` 必须是 `"day"`、`"week"`、`"month"`、`"quarter"` 或 `"year"`；
- `over(...)` 只允许 `partition by`，禁止 `order by` 和 frame；
- `moving` 按物理行或显式 frame 计算，`accumulate(rolling(...))` 按真实时间范围计算，
  两者不得混用。

## 11. 规范化输出

图形化配置生成 DSL 时必须遵循：

1. 场景关键字、功能函数和普通关键字统一使用小写；
2. 字符串枚举统一使用双引号；
3. 升序统一省略 `asc`，降序输出 `desc`；
4. 分组为空且场景不需要排序或 frame 时，省略整个 `over(...)`；
5. 多个分组、排序字段保持图形化配置中的顺序；
6. 不输出场景内部固定的窗口边界；
7. 不输出底层 `case`、`extract` 或用于实现领域函数的 SQL 组合；
8. 不生成旧的下划线复合函数形式。

## 12. 当前实现边界

当前实现已经覆盖：

1. 函数注册表中的内部标识与公开场景、功能名称映射；
2. 场景表达式 tokenizer、parser、formatter 和参数校验；
3. 图形化配置生成规范 DSL；
4. 规范 DSL 解析为结构化计算配置；
5. 领域 DSL 展开为 DuckDB SQL；
6. 各场景的规范化、错误输入和主要执行结果测试。

当前限制：

1. 图形化向导只回填主要计算对象为单个字段或 `*` 的场景表达式；主要计算对象为复合表达式
   时仍可解析和执行，但不会回填到向导；
2. 同比不预检同期候选记录唯一性，重复候选的结果不保证稳定；
3. 场景表达式必须独占 `derive` 右侧；无法识别为场景表达式的内容按自由表达式处理，并交由
   公共表达式校验与数据库执行。

项目未上线，不保留旧公开 DSL 的兼容解析分支。旧形式必须显式报错，不能降级为自由表达式
透传给数据库。

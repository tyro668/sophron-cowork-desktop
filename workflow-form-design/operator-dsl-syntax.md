# 算子 DSL 语法参考

本文档整理数据处理算子的 DSL 通用形式、参数说明和示例，供图形配置表单映射时参考。本文只描述语法，不包含界面设计方案。

## 通用约定

### 字段引用

```text
[字段名]
[输入别名].[字段名]
```

### 参数说明

| 参数             | 必填 | 说明                                                                                  |
| ---------------- | ---- | ------------------------------------------------------------------------------------- |
| `field_ref`      | 是   | 字段引用，格式为 `[field]`。                                                          |
| `field_ref_list` | 是   | 多个字段引用，使用英文逗号分隔。                                                      |
| `literal`        | 是   | 字面量，例如字符串、数字、布尔值或 `null`。                                           |
| `expression`     | 是   | 表达式，可包含字段引用、函数、算术运算、比较运算和逻辑运算。                          |
| `sort_key`       | 是   | 排序项，通常为 `[field] asc` 或 `[field] desc`，可追加 `nulls first` / `nulls last`。 |

## 1. 字段选择

### 通用形式

```text
select [字段1], [字段2], ...
drop [字段1], [字段2], ...
```

### 参数说明

| 参数              | 必填 | 说明                                                 |
| ----------------- | ---- | ---------------------------------------------------- |
| `select` / `drop` | 是   | `select` 表示保留指定字段，`drop` 表示删除指定字段。 |
| 字段列表          | 是   | 要保留或删除的字段集合。                             |

### 示例

```text
select [order_id], [region], [amount]
```

```text
drop [internal_note], [debug_flag]
```

## 2. 筛选

### 通用形式

```text
filter 条件表达式
```

### 参数说明

| 参数       | 必填 | 说明                                                |
| ---------- | ---- | --------------------------------------------------- |
| 条件表达式 | 是   | 返回布尔值的表达式，用于保留满足条件的行。          |
| 比较运算符 | 否   | 支持 `=`、`!=`、`>`、`>=`、`<`、`<=`。              |
| 逻辑运算符 | 否   | 支持 `and`、`or`、`not`。                           |
| 范围判断   | 否   | 支持 `between ... and ...`。                        |
| 集合判断   | 否   | 支持 `in (...)`、`not in (...)`。                   |
| 字符匹配   | 否   | 支持 `like`、`not like`、`matches`、`not matches`。 |

### 示例

```text
filter [amount] > 0
```

```text
filter [status] in ("PAID", "REFUNDED")
```

```text
filter [revenue] between 0 and 100000 and [region] != "TEST"
```

## 3. 缺失值处理

### 通用形式

```text
missing value row drop when all_null
missing value row drop when any_null
missing value [字段] fill 值
missing value [字段] nullify values (值1, 值2, ...)
```

### 参数说明

| 参数                 | 必填 | 说明                                           |
| -------------------- | ---- | ---------------------------------------------- |
| 处理对象             | 是   | 可以是整行 `row`，也可以是单个字段 `[field]`。 |
| `drop when all_null` | 否   | 删除所有字段均为空的行。                       |
| `drop when any_null` | 否   | 删除任一字段为空的行。                         |
| `fill`               | 否   | 将字段缺失值填充为指定值。                     |
| `nullify values`     | 否   | 将指定特殊值转换为空值。                       |
| 值列表               | 否   | `nullify values` 使用的特殊值集合。            |

### 示例

```text
missing value row drop when all_null
```

```text
missing value [region] fill "UNKNOWN"
```

```text
missing value [region] nullify values ("", "N/A"), [score] fill 0
```

## 4. 类型转换

### 通用形式

```text
cast [字段] as 目标类型
cast [字段] as 目标类型 on_error 错误处理方式
```

### 参数说明

| 参数         | 必填 | 说明                                                                        |
| ------------ | ---- | --------------------------------------------------------------------------- |
| 字段         | 是   | 要转换类型的字段。                                                          |
| 目标类型     | 是   | 支持 `text`、`date`、`datetime`、`integer`、`float`、`decimal`、`boolean`。 |
| `on_error`   | 否   | 转换失败时的处理方式。                                                      |
| 错误处理方式 | 否   | 常见值为 `null`，表示转换失败时置为空值。                                   |

### 示例

```text
cast [amount] as decimal on_error null
```

```text
cast [created_at] as datetime
```

```text
cast [is_active] as boolean on_error null
```

## 5. 去重

### 通用形式

```text
deduplicate by [字段1], [字段2], ... keep first
deduplicate by [字段1], [字段2], ... keep last order by 排序字段
```

### 参数说明

| 参数                       | 必填 | 说明                               |
| -------------------------- | ---- | ---------------------------------- |
| 去重字段                   | 是   | 用于判断重复记录的字段集合。       |
| `keep first` / `keep last` | 是   | 重复记录中保留第一条或最后一条。   |
| `order by`                 | 否   | 用于决定 first / last 的排序依据。 |
| 排序字段                   | 否   | 一个或多个 `sort_key`。            |

### 示例

```text
deduplicate by [id] keep first
```

```text
deduplicate by [id] keep last order by [updated_at] desc
```

```text
deduplicate by [customer_id], [order_date] keep last order by [amount] desc
```

## 6. 排序

### 通用形式

```text
sort by [字段] asc
sort by [字段] desc nulls last
sort by [字段1] desc, [字段2] asc
```

### 参数说明

| 参数       | 必填 | 说明                              |
| ---------- | ---- | --------------------------------- |
| 排序字段   | 是   | 用于排序的字段。                  |
| 排序方向   | 否   | `asc` 表示升序，`desc` 表示降序。 |
| 空值位置   | 否   | `nulls first` 或 `nulls last`。   |
| 多字段排序 | 否   | 多个排序项按顺序生效。            |

### 示例

```text
sort by [created_at] desc nulls last
```

```text
sort by [region] asc, [amount] desc
```

## 7. 字段映射

### 通用形式

```text
map [原字段] to [目标字段]
map [原字段1] to [目标字段1], [原字段2] to [目标字段2]
```

### 参数说明

| 参数     | 必填 | 说明                                |
| -------- | ---- | ----------------------------------- |
| 原字段   | 是   | 需要重命名的字段。                  |
| 目标字段 | 是   | 重命名后的字段。                    |
| 多个映射 | 否   | 可在同一条 DSL 中配置多个字段映射。 |

### 示例

```text
map [old_name] to [new_name]
```

```text
map [dt] to [order_date], [rev] to [revenue]
```

## 8. 聚合

### 通用形式

```text
aggregate by [分组字段1], [分组字段2]
  metrics 聚合函数([字段]) as [输出字段]

aggregate all
  metrics 聚合函数([字段]) as [输出字段]
```

### 参数说明

| 参数       | 必填     | 说明                                                                              |
| ---------- | -------- | --------------------------------------------------------------------------------- |
| 分组方式   | 是       | `by` 表示按字段分组，`all` 表示全表聚合。                                         |
| 分组字段   | 条件必填 | 使用 `by` 时必填，可配置多个字段。                                                |
| `metrics`  | 是       | 聚合指标定义。                                                                    |
| 聚合函数   | 是       | 支持 `sum`、`avg`、`min`、`max`、`count`、`count_distinct`、`median`、`mode` 等。 |
| 聚合表达式 | 是       | 被聚合的字段、表达式或 `*`。                                                      |
| 输出字段   | 是       | 聚合结果字段名。                                                                  |
| 高级分组   | 否       | 支持 `rollup(...)`、`cube(...)`、`grouping sets (...)`。                          |

### 示例

```text
aggregate by [region] metrics sum([revenue]) as [total_revenue]
```

```text
aggregate by [region], [month]
  metrics sum([revenue]) as [total_revenue],
          count(*) as [row_count]
```

```text
aggregate all metrics count(*) as [row_count]
```

```text
aggregate by rollup([country], [city])
  metrics sum([amount]) as [amount_sum]
```

## 9. 计算字段

### 通用形式

```text
derive [目标字段] = 表达式
derive [目标字段1] = 表达式1, [目标字段2] = 表达式2
```

### 参数说明

| 参数       | 必填 | 说明                                                 |
| ---------- | ---- | ---------------------------------------------------- |
| 目标字段   | 是   | 要生成或覆盖的字段。                                 |
| 表达式     | 是   | 计算逻辑，可引用字段、函数、条件表达式或窗口表达式。 |
| 多个计算   | 否   | 可在同一条 DSL 中配置多个计算字段。                  |
| 窗口表达式 | 否   | 使用 `over(...)` 表达窗口计算。                      |

### 示例

```text
derive [margin] = if [revenue] = 0 then 0 else [profit] / [revenue]
```

```text
derive [month] = month([order_date])
```

```text
derive [rn] = row_number() over(partition by [region] order by [amount] desc)
```

```text
derive [running_revenue] = sum([revenue]) over(partition by [region] order by [order_date] rows between unbounded preceding and current row)
```

## 10. 连接

### 通用形式

```text
join 连接类型 右侧输入 on 连接条件
join 连接类型 右侧输入 on 连接条件 keep 输出字段规则
join 连接类型 右侧输入 on 连接条件 keep 输出字段规则 expect 连接基数
```

### 参数说明

| 参数     | 必填     | 说明                                                                     |
| -------- | -------- | ------------------------------------------------------------------------ |
| 连接类型 | 是       | 支持 `inner`、`left`、`right`、`full`、`cross`、`semi`、`anti`、`asof`。 |
| 右侧输入 | 是       | 右侧输入源 alias。                                                       |
| `on`     | 条件必填 | 连接条件。`cross` 可不需要普通连接条件。                                 |
| 连接条件 | 条件必填 | 通常使用 `[left_alias].[field] = [right_alias].[field]`。                |
| `keep`   | 否       | 控制连接后的输出字段。                                                   |
| `expect` | 否       | 声明期望连接基数，例如 `many_to_one`、`one_to_one`。                     |

### 示例

```text
join left customers on [orders].[customer_id] = [customers].[customer_id]
```

```text
join left customers
  on [orders].[customer_id] = [customers].[customer_id]
  keep left *, [customers].[name] as [customer_name]
```

```text
join inner products
  on [orders].[product_id] = [products].[product_id]
  keep left *, [products].[category] as [product_category]
  expect many_to_one
```

## 11. 限制行数 / Top N

### 通用形式

```text
limit 行数
limit 行数 offset 偏移量
limit 百分比 percent
top 行数 by 排序字段
```

### 参数说明

| 参数      | 必填       | 说明                     |
| --------- | ---------- | ------------------------ |
| `limit`   | 条件必填   | 普通限制行数。           |
| 行数      | 是         | 要保留的行数。           |
| `offset`  | 否         | 偏移指定行数后再取结果。 |
| `percent` | 否         | 使用百分比限制结果。     |
| `top`     | 条件必填   | 按排序取 Top N。         |
| 排序字段  | `top` 必填 | Top N 的排序依据。       |

### 示例

```text
limit 100
```

```text
limit 100 offset 200
```

```text
limit 10 percent
```

```text
top 10 by [amount] desc
```

## 12. 透视

### 通用形式

```text
pivot on [透视字段] using 聚合函数([值字段]) group by [分组字段]
pivot on [透视字段] in (值1, 值2, ...) using 聚合函数([值字段]) group by [分组字段]
```

### 参数说明

| 参数       | 必填 | 说明                       |
| ---------- | ---- | -------------------------- |
| `on`       | 是   | 用于展开为列的字段。       |
| `in`       | 否   | 显式限定要展开的枚举值。   |
| `using`    | 是   | 透视时使用的聚合指标。     |
| 聚合函数   | 是   | 对值字段执行的聚合函数。   |
| `group by` | 否   | 透视后保留为行维度的字段。 |

### 示例

```text
pivot on [month] using sum([revenue]) group by [region]
```

```text
pivot on [status] in ("paid", "refund") using count(*) group by [region]
```

```text
pivot on [year], [quarter] using sum([amount]) as [amount_sum] group by [category]
```

## 13. 反透视

### 通用形式

```text
unpivot [字段1], [字段2], ... into name [名称字段] value [值字段]
unpivot columns except [保留字段1], [保留字段2] into name [名称字段] value [值字段]
unpivot include nulls [字段1], [字段2] into name [名称字段] value [值字段]
```

### 参数说明

| 参数             | 必填     | 说明                                 |
| ---------------- | -------- | ------------------------------------ |
| 待展开字段       | 条件必填 | 要从宽表转换为长表的字段集合。       |
| `columns except` | 条件必填 | 除指定字段外，其余字段都参与反透视。 |
| `include nulls`  | 否       | 是否保留空值行。                     |
| `name` 字段      | 是       | 保存原列名的目标字段。               |
| `value` 字段     | 是       | 保存原列值的目标字段。               |

### 示例

```text
unpivot [jan], [feb], [mar] into name [month] value [sales]
```

```text
unpivot columns except [id], [region] into name [metric] value [value]
```

```text
unpivot include nulls [q1], [q2], [q3], [q4] into name [quarter] value [amount]
```

## 14. 集合操作

### 通用形式

```text
union 右侧输入
union 右侧输入 mode all by name
union 右侧输入 mode distinct by position
intersect 右侧输入
except 右侧输入
```

### 参数说明

| 参数            | 必填 | 说明                                  |
| --------------- | ---- | ------------------------------------- |
| 操作类型        | 是   | 支持 `union`、`intersect`、`except`。 |
| 右侧输入        | 是   | 右侧输入源 alias。                    |
| `mode all`      | 否   | 保留重复行。                          |
| `mode distinct` | 否   | 去除重复行。                          |
| `by name`       | 否   | 按字段名对齐。                        |
| `by position`   | 否   | 按字段位置对齐。                      |

### 示例

```text
union returns mode all by name
```

```text
union returns by name
```

```text
intersect whitelist
```

```text
except blacklist
```

## 15. 嵌套展开

### 通用形式

```text
unnest [嵌套字段] as [输出字段]
unnest [嵌套字段] as [输出字段] with index [索引字段]
explode json [JSON字段] path "JSON路径" as [输出字段]
```

### 参数说明

| 参数                 | 必填          | 说明                              |
| -------------------- | ------------- | --------------------------------- |
| `unnest` / `explode` | 是            | 展开 list、struct 或 JSON array。 |
| 嵌套字段             | 是            | 需要展开的字段。                  |
| 输出字段             | 是            | 展开后的字段名。                  |
| `with index`         | 否            | 生成展开后的序号字段。            |
| `recursive`          | 否            | 是否递归展开。                    |
| `max_depth`          | 否            | 最大递归深度。                    |
| `keep parent names`  | 否            | 是否保留父级字段名。              |
| `path`               | JSON 展开必填 | JSON path 表达式。                |

### 示例

```text
unnest [items] as [item]
```

```text
unnest [items] as [item] with index [item_index]
```

```text
unnest [payload_struct] as [payload_item] recursive true keep parent names true
```

```text
explode json [payload] path "$.items" as [item]
```

## 16. 输出

### 通用形式

```text
output table "表名" mode replace
output dataset "数据集名" mode replace
output file "文件路径" format 文件格式 mode replace
```

### 参数说明

| 参数         | 必填           | 说明                                                    |
| ------------ | -------------- | ------------------------------------------------------- |
| 输出目标类型 | 是             | 支持 `table`、`dataset`、`file`。                       |
| 输出目标     | 是             | 表名、数据集名或文件路径。                              |
| `format`     | 文件输出时必填 | 文件格式，支持 `csv`、`parquet`、`xlsx`、`json`。       |
| `mode`       | 否             | 输出模式，支持 `replace`、`append`、`error_if_exists`。 |

### 示例

```text
output table "clean_orders" mode replace
```

```text
output dataset "客户订单清洗结果" mode replace
```

```text
output file "/path/to/output/clean_orders.parquet" format parquet mode replace
```

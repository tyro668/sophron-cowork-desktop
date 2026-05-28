# 数据任务算子 DSL 设计文档 v0.1

## 1. 文档目标

本文档面向当前应用的数据任务画布，用于表达、保存、AI 生成和后端编译数据清洗/预处理算子。

DSL 的核心目标是让 AI 和用户可以用稳定、紧凑、可校验的文本描述一条数据处理流程，并能一一映射到当前应用的 `DataWorkflowNode`、`DataWorkflowEdge` 和节点 `config_json`。

当前应用已有算子类型如下，本文档以它们为内部稳定类型：

```text
input_source
filter
field_select
deduplicate
missing_value
type_convert
sort
aggregate
calculate_field
field_mapping
output
```

为支持表连接，本文档新增设计一个内部算子类型：

```text
join
```

实现该 DSL 时需要同步扩展 `DataWorkflowOperatorType`、算子目录、节点渲染、配置检查器和后端编译器。

本文档不设计通用聊天语法、不设计图表语法，也不替代 SQL。DSL 是数据任务算子的可编辑表示和编译输入。

---

## 2. 设计原则

### 2.1 算子优先

每个 DSL 命令必须能编译成一个明确的工作流算子节点。命令名可以更贴近数据处理习惯，例如 `select`、`cast`、`derive`，但内部节点类型必须落到当前的 `DataWorkflowOperatorType`。

### 2.2 Pipeline 优先

默认以线性 pipeline 表达主数据流：

```text
input source task
  | select [order_id], [order_date], [region], [revenue], [profit]
  | cast [order_date] as date, [revenue] as double, [profit] as double
  | missing value [region] fill "UNKNOWN"
  | derive [margin] = if [revenue] = 0 then 0 else [profit] / [revenue]
  | filter [revenue] > 0
  | output table "clean_sales" mode replace
```

画布仍然保存节点和边。线性 pipeline 只是最稳定的文本形态，编译后生成一组按顺序连接的节点。

当流程需要表连接时，允许声明多个带别名的输入源，并用 `from <alias>` 指定主数据流：

```text
input source task as orders
input source dataset "customer_dim" as customers

from orders
  | join left customers on [orders].[customer_id] = [customers].[customer_id]
  | output table "orders_with_customers" mode replace
```

每个 `join` 仍然是二元算子。多表连接通过多个 `join` 串联表达。

### 2.3 字段引用显式化

所有字段必须使用方括号引用：

```text
[revenue]
[order_date]
[source].[region]
```

禁止裸字段名参与表达式：

```text
filter revenue > 0
```

### 2.4 配置结构化

每个算子的 `config_json` 必须是结构化 JSON。原始 DSL 可选保存在 `config.dsl` 中，表达式 AST 可选保存在 `config.exprAst`、`config.metrics[].exprAst` 等字段中，便于后续 UI 回填和 DuckDB SQL 编译。

### 2.5 固定语序

DSL 命令保持固定语序，减少 AI 生成歧义。允许少量易懂别名，但编译后必须规范化成唯一内部形式。

### 2.6 关键字收敛

行级计算字段统一使用 `derive` 关键字，对应内部算子 `calculate_field`。不再把 `calculate` 或 `calculator` 作为公共 DSL 关键字，避免与 UI 控件、计算器工具或聚合语义混淆。

`aggregate` 保持独立关键字。它会改变数据粒度和行数，语义上不同于只增加或覆盖列的 `derive`。

### 2.7 清洗可审计

清洗流程中会删除行、转换失败置空、标准化值和覆盖字段。执行层必须记录每个算子的输入行数、输出行数、删除行数、失败转换数和关键告警。DSL 负责表达清洗意图，执行结果负责产出质量摘要和可选的异常样本。

### 2.8 多输入显式命名

多输入任务中的每个 `input source` 必须带 `as <alias>`。连接条件中必须使用带别名的字段引用，例如 `[orders].[customer_id] = [customers].[customer_id]`，避免同名字段歧义。

---

## 3. DSL 使用形态

### 3.1 任务级 Pipeline

任务级 DSL 描述完整工作流：

```text
input source file "/path/to/orders.csv" format auto as raw_orders
  | select [order_id], [dt], [region], [rev], [profit]
  | map [dt] to [order_date], [rev] to [revenue]
  | cast [order_date] as date, [revenue] as double, [profit] as double
  | missing value row drop when all_null
  | missing value [region] nullify values ("", "N/A", "-")
  | missing value [revenue] fill 0
  | missing value [profit] fill 0
  | missing value [region] fill "UNKNOWN"
  | deduplicate by [order_id] keep last order by [order_date] desc
  | derive [margin] = if [revenue] = 0 then 0 else [profit] / [revenue]
  | filter [revenue] > 0
  | sort by [order_date] desc
  | output table "clean_orders" mode replace
```

### 3.2 节点级 DSL

节点级 DSL 只描述单个算子，用于检查器、AI 局部修改、`append`/`replace` 类操作：

```text
filter [revenue] > 0 and [region] != "TEST"
```

```text
aggregate by [region], [month]
  metrics sum([revenue]) as [total_revenue],
          avg([margin]) as [avg_margin],
          count(*) as [row_count]
```

### 3.3 多源 Join Pipeline

多源任务先声明所有输入源，再从主源开始 pipeline：

```text
input source task as orders
input source dataset "customer_dim" as customers
input source dataset "product_dim" as products

from orders
  | join left customers
      on [orders].[customer_id] = [customers].[customer_id]
      keep left *, [customers].[name] as [customer_name], [customers].[level] as [customer_level]
      expect many_to_one
  | join left products
      on [orders].[product_id] = [products].[product_id]
      keep left *, [products].[category] as [product_category]
      expect many_to_one
  | output table "orders_enriched" mode replace
```

说明：

- `orders` 是主数据流，先进入后续清洗 pipeline。
- `customers`、`products` 分别编译为独立 `input_source` 节点。
- 每个 `join` 节点有两个输入 handle：`left` 接上游主流，`right` 接右表输入源。
- `keep` 用于控制连接后的输出字段，避免维表大量字段和同名字段污染主表。

### 3.4 图结构扩展

当前数据画布有边模型。v0.1 允许 `join` 形成多输入 DAG；其他任意分支暂保留命名节点语法，MVP 可不实现：

```text
node high_value: filter from source where [revenue] >= 10000
node normal_value: filter from source where [revenue] < 10000
```

除 `join` 的 `left/right` 输入外，校验器应拒绝未声明语义的多入边、多出边或不连通图。

---

## 4. 程序结构

### 4.1 EBNF

```ebnf
prep_program       := metadata_stmt* (single_source_pipeline | multi_source_pipeline)

metadata_stmt      := "dsl" "version" STRING
                    | "task" IDENTIFIER

source_decl        := input_source_command_with_alias

single_source_pipeline := input_source_command pipe_operator* output_tail?
multi_source_pipeline  := source_decl+ "from" IDENTIFIER pipe_operator* output_tail?

pipe_operator      := "|" operator_command
output_tail        := "|" output_command

operator_command   := field_select_command
                    | field_mapping_command
                    | filter_command
                    | deduplicate_command
                    | missing_value_command
                    | type_convert_command
                    | sort_command
                    | join_command
                    | aggregate_command
                    | calculate_field_command

node_command       := input_source_command
                    | operator_command
                    | output_command
```

### 4.2 说明

- 一个完整任务至少有一个 `input source`。
- 单源任务可以直接用 `input source ...` 开始 pipeline。
- 多源任务必须先声明多个 `input source ... as <alias>`，再用 `from <alias>` 开始主 pipeline。
- `output` 可省略。省略时执行层使用任务默认输出表。
- pipeline 中每个 `|` 后的命令对应一个新的节点。
- 节点默认使用上游输出作为输入，下游默认消费当前节点输出；`join` 额外消费右侧输入源。

---

## 5. 词法规则

### 5.1 标识符

```ebnf
IDENTIFIER := [A-Za-z_][A-Za-z0-9_]*
```

用于数据流别名、函数名、类型名和内部节点 key。

`ESCAPED_FIELD_TEXT` 表示反引号内的原始字段名文本，反引号本身需要用 ``\` `` 转义。

### 5.2 字段引用

```ebnf
field_ref           := simple_field_ref | qualified_field_ref
qualified_field_ref := simple_field_ref "." simple_field_ref
simple_field_ref    := "[" field_name "]"
field_name          := IDENTIFIER | escaped_field_name
escaped_field_name := "`" ESCAPED_FIELD_TEXT "`"

field_ref_list := field_ref ("," field_ref)*
```

示例：

```text
[revenue]
[raw_orders].[region]
[`订单 日期`]
```

说明：

- `[revenue]` 表示当前数据流字段。
- `[raw_orders].[region]` 表示显式带输入源 alias 的字段，用于多输入、分支或 join 类场景。
- 当字段包含空格、点号、中文标点或其他特殊字符时，使用反引号转义，例如 ``[`订单 日期`]``。
- 带源字段必须写为 `[table_name].[field_name]`，不允许写成 `[table_name.field_name]`。
- 字段重命名目标也必须使用方括号，且不能带表名前缀。

### 5.3 字面量

```ebnf
literal := STRING | NUMBER | BOOLEAN | NULL
BOOLEAN := "true" | "false"
NULL    := "null"
```

```text
"UNKNOWN"
100
3.14
true
false
null
```

字符串使用双引号。文件路径、输出表名、sheet 名等也使用双引号。

### 5.4 常用列表

```ebnf
literal_list := "(" literal ("," literal)* ")"
```

示例：

```text
("PAID", "REFUNDED")
("", "N/A", "-")
```

### 5.5 注释

```text
# 只保留有效订单
filter [order_status] = "PAID"
```

---

## 6. 算子命令规范

### 6.1 input_source

作用：定义任务输入数据源。

语法：

```ebnf
input_source_command            := "input" "source" input_source_target ["as" IDENTIFIER]
input_source_command_with_alias := "input" "source" input_source_target "as" IDENTIFIER

input_source_target             := "task"
                                 | "file" STRING ["format" source_format] source_options*
                                 | "dataset" STRING

source_format                   := "auto" | "csv" | "tsv" | "xlsx" | "parquet" | "json"
source_options                  := "sheet" STRING
                                 | "header" BOOLEAN
                                 | "encoding" STRING
```

示例：

```text
input source task
input source file "/path/to/orders.csv" format auto as orders
input source file "/path/to/report.xlsx" format xlsx sheet "Sheet1" as report
input source dataset "dataset_01HXYZ" as imported_orders
```

节点映射：

```json
{
  "type": "input_source",
  "label": "数据源",
  "config": {
    "source": "task",
    "alias": "orders"
  }
}
```

配置字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `source` | `"task" | "file" | "dataset"` | 输入来源 |
| `filePath` | `string?` | 文件路径，`source=file` 时必填 |
| `datasetId` | `string?` | 数据集 ID，`source=dataset` 时必填 |
| `format` | `string?` | 文件格式，默认 `auto` |
| `sheet` | `string?` | Excel sheet |
| `header` | `boolean?` | 是否首行为表头 |
| `encoding` | `string?` | 文本编码 |
| `alias` | `string?` | 数据流别名 |

约束：

- 多源任务中每个输入源必须有 `alias`。
- 同一个任务内 `alias` 必须唯一。
- `from <alias>` 引用的主源必须已声明。

### 6.2 field_select

作用：保留或删除字段。

语法：

```ebnf
field_select_command := select_keep_command | select_drop_command
select_keep_command  := "select" field_ref_list
select_drop_command  := "drop" field_ref_list
```

示例：

```text
select [order_id], [order_date], [region], [revenue]
drop [debug_col], [unused_col]
```

节点映射：

```json
{
  "type": "field_select",
  "label": "字段选择",
  "config": {
    "mode": "include",
    "columns": ["order_id", "order_date", "region", "revenue"]
  }
}
```

配置字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | `"include" | "exclude"` | 保留或删除 |
| `columns` | `string[]` | 字段列表 |

约束：

- `select` 至少保留一个字段。
- `drop` 不允许删除全部字段。
- 字段必须存在于上游 schema。

### 6.3 field_mapping

作用：字段重命名、标准化映射和输出字段名对齐。

语法：

```ebnf
field_mapping_command := "map" mapping_pair ("," mapping_pair)*
                       | "rename" rename_pair ("," rename_pair)*

mapping_pair          := field_ref "to" field_ref
rename_pair           := field_ref "as" field_ref
```

示例：

```text
map [dt] to [order_date], [rev] to [revenue]
rename [customerName] as [customer_name]
```

节点映射：

```json
{
  "type": "field_mapping",
  "label": "字段映射",
  "config": {
    "mappings": [
      { "source": "dt", "target": "order_date" },
      { "source": "rev", "target": "revenue" }
    ]
  }
}
```

约束：

- `target` 不能带数据流前缀。
- `target` 不能重复。
- `source` 必须存在。
- 未列出的字段默认透传。若需要只输出映射字段，应先使用 `select`。

### 6.4 filter

作用：按布尔条件筛选行。

语法：

```ebnf
filter_command := "filter" boolean_expr
```

示例：

```text
filter [revenue] > 0
filter [revenue] > 0 and [region] != "TEST"
filter not is_null([customer_id])
```

节点映射：

```json
{
  "type": "filter",
  "label": "筛选",
  "config": {
    "condition": "[revenue] > 0",
    "exprAst": {
      "type": "binary_op",
      "op": ">",
      "left": { "type": "field", "name": "revenue" },
      "right": { "type": "literal", "value": 0 }
    }
  }
}
```

约束：

- 条件必须是布尔表达式。
- 不允许聚合函数。
- 不允许窗口函数。

### 6.5 deduplicate

作用：删除重复行。

语法：

```ebnf
deduplicate_command := "deduplicate" deduplicate_scope? deduplicate_keep? deduplicate_order?

deduplicate_scope   := "by" field_ref_list
deduplicate_keep    := "keep" ("first" | "last")
deduplicate_order   := "order" "by" sort_key ("," sort_key)*
```

示例：

```text
deduplicate
deduplicate by [order_id]
deduplicate by [order_id], [sku_id] keep last order by [updated_at] desc
```

节点映射：

```json
{
  "type": "deduplicate",
  "label": "去重",
  "config": {
    "strategy": "by_columns",
    "columns": ["order_id"],
    "keep": "last",
    "orderBy": [{ "field": "updated_at", "direction": "desc" }]
  }
}
```

配置字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `strategy` | `"all_columns" | "by_columns"` | 去重范围 |
| `columns` | `string[]?` | 指定字段 |
| `keep` | `"first" | "last"` | 保留规则，默认 `first` |
| `orderBy` | `SortKey[]?` | 有保留规则时的排序依据 |

约束：

- 不写 `by` 时表示全字段去重。
- 使用 `keep last` 且不写 `order by` 时，结果依赖输入顺序，校验器应给出警告。

### 6.6 missing_value

作用：处理缺失值。

语法：

```ebnf
missing_value_command := "missing" "value" (missing_column_rules | missing_row_rule)

missing_column_rules  := missing_rule ("," missing_rule)*
missing_rule          := field_ref missing_action
missing_action        := "skip"
                       | "drop" "rows"
                       | "nullify" "values" literal_list
                       | "fill" scalar_expr
                       | "fill" ("forward" | "backward" | "mean" | "median" | "mode")

missing_row_rule      := "row" "drop" "when" row_missing_condition
row_missing_condition := "all_null"
                       | "any_null" ["in" field_ref_list]
```

示例：

```text
missing value row drop when all_null
missing value row drop when any_null in [order_id], [order_date]
missing value [region] nullify values ("", "N/A", "-")
missing value [region] fill "UNKNOWN"
missing value [revenue] fill 0, [profit] fill 0
missing value [event_time] fill forward
missing value [event_type] fill mode
missing value [page_id] drop rows
missing value [device_id] skip
```

节点映射：

```json
{
  "type": "missing_value",
  "label": "缺失值处理",
  "config": {
    "strategy": "by_column",
    "rules": [
      { "column": "region", "method": "nullify_values", "values": ["", "N/A", "-"] },
      { "column": "region", "method": "literal_fill", "value": "UNKNOWN" },
      { "column": "event_time", "method": "forward_fill" }
    ]
  }
}
```

方法规范化：

| DSL | `method` |
| --- | --- |
| `skip` | `skip` |
| `drop rows` | `drop` |
| `nullify values (...)` | `nullify_values` |
| `fill <literal/expr>` | `literal_fill` |
| `fill forward` | `forward_fill` |
| `fill backward` | `backward_fill` |
| `fill mean` | `mean_fill` |
| `fill median` | `median_fill` |
| `fill mode` | `mode_fill` |

约束：

- `fill` 后的表达式必须是标量表达式。
- 不允许聚合函数和窗口函数。
- `mean`、`median` 只允许用于数值字段。
- `forward`、`backward` 需要稳定排序时，应在上游显式 `sort`。
- `nullify values` 先把指定字面量标准化为 `null`，再执行后续缺失处理。
- `row drop when all_null` 表示删除全字段为空的行，应映射为 `config.strategy = "drop_empty_rows"`。
- `row drop when any_null in ...` 表示关键字段任一缺失即删除，应记录删除行数和字段命中统计。
- 同一字段允许连续清洗规则，但必须按 DSL 出现顺序执行，例如先 `nullify values (...)`，再 `fill "UNKNOWN"`。

### 6.7 type_convert

作用：字段类型转换。

语法：

```ebnf
type_convert_command := "cast" cast_pair ("," cast_pair)*
cast_pair            := field_ref "as" type_name cast_options*

type_name            := "string" | "int" | "double" | "decimal" | "boolean" | "date" | "timestamp"
cast_options         := "format" STRING
                      | "on_error" ("null" | "fail" | "keep")
                      | "locale" STRING
                      | "timezone" STRING
```

示例：

```text
cast [order_date] as date format "yyyy-MM-dd"
cast [revenue] as double on_error null, [quantity] as int on_error fail
cast [created_at] as timestamp format "yyyy-MM-dd HH:mm:ss" timezone "Asia/Shanghai"
```

节点映射：

```json
{
  "type": "type_convert",
  "label": "类型转换",
  "config": {
    "conversions": [
      { "column": "order_date", "type": "date", "format": "yyyy-MM-dd", "onError": "null" },
      { "column": "revenue", "type": "double", "onError": "null" }
    ]
  }
}
```

约束：

- `cast` 只改变字段类型，不改变字段名。
- 如需改名，使用 `map` 或 `rename`。
- 默认 `on_error` 为 `null`，即无法转换时输出 `null`。
- 日期时间转换可以携带 `format` 和 `timezone`。
- 数字转换可以携带 `locale`，用于处理小数点、千分位和区域格式。

### 6.8 sort

作用：排序。

语法：

```ebnf
sort_command := "sort" "by" sort_key ("," sort_key)*
sort_key     := field_ref ["asc" | "desc"] ["nulls" ("first" | "last")]
```

示例：

```text
sort by [order_date] desc
sort by [region] asc, [revenue] desc nulls last
```

节点映射：

```json
{
  "type": "sort",
  "label": "排序",
  "config": {
    "keys": [
      { "field": "order_date", "direction": "desc", "nulls": "last" }
    ]
  }
}
```

### 6.9 join

作用：连接当前主数据流与另一个已声明输入源。

语法：

```ebnf
join_command       := "join" (regular_join_body | asof_join_body)

regular_join_body  := join_type IDENTIFIER ["as" IDENTIFIER]
                      join_on_clause?
                      join_keep_clause?
                      join_conflict_clause?
                      join_expect_clause?

join_type          := "inner" | "left" | "right" | "full" | "cross" | "semi" | "anti"
join_on_clause     := "on" join_predicate ("and" join_predicate)*
join_predicate     := field_ref "=" field_ref

asof_join_body     := "asof" IDENTIFIER ["as" IDENTIFIER]
                      asof_on_clause
                      asof_by_clause?
                      asof_direction_clause?
                      asof_tolerance_clause?
                      join_keep_clause?
                      join_conflict_clause?
                      join_expect_clause?

asof_on_clause     := "on" field_ref asof_match_op field_ref
asof_match_op      := ">=" | "<=" | "nearest"
asof_by_clause     := "by" join_predicate ("and" join_predicate)*
asof_direction_clause := "direction" ("backward" | "forward" | "nearest")
asof_tolerance_clause := "tolerance" duration_literal
duration_literal   := NUMBER ("ms" | "s" | "m" | "h" | "d")

join_keep_clause   := "keep" join_keep_item ("," join_keep_item)*
join_keep_item     := "left" "*"
                    | "right" "*"
                    | field_ref ["as" field_ref]

join_conflict_clause := "suffix" STRING STRING
                      | "right_prefix" STRING

join_expect_clause := "expect" join_cardinality
join_cardinality   := "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many"
```

示例：

```text
input source task as orders
input source dataset "customer_dim" as customers

from orders
  | join left customers
      on [orders].[customer_id] = [customers].[customer_id]
      keep left *, [customers].[name] as [customer_name], [customers].[level] as [customer_level]
      expect many_to_one
  | output table "orders_with_customers" mode replace
```

多字段连接：

```text
join inner sku_price
  on [orders].[sku_id] = [sku_price].[sku_id]
  and [orders].[region] = [sku_price].[region]
  keep left *, [sku_price].[price] as [standard_price]
  expect many_to_one
```

反连接用于清洗黑名单：

```text
input source task as orders
input source dataset "blacklist_customers" as blacklist

from orders
  | join anti blacklist on [orders].[customer_id] = [blacklist].[customer_id]
  | output table "orders_without_blacklist" mode replace
```

ASOF 连接用于按时间补齐最近的历史状态、行情、汇率或快照：

```text
input source task as trades
input source dataset "fx_rates" as rates

from trades
  | join asof rates
      on [trades].[trade_time] >= [rates].[rate_time]
      by [trades].[currency] = [rates].[currency]
      tolerance 1d
      keep left *, [rates].[rate] as [fx_rate]
      expect many_to_one
  | output table "trades_with_fx" mode replace
```

说明：

- `>=` 表示从右表选择不晚于左表时间的最近一行，即 backward asof。
- `<=` 表示从右表选择不早于左表时间的最近一行，即 forward asof。
- `nearest` 表示从右表选择绝对时间距离最近的一行，必须显式写 `tolerance`。
- `by` 用于限定同一业务分组内做近邻匹配，例如同一币种、同一设备、同一商品。
- `join asof` 默认保留左表全部行；未匹配到右表时，右表字段输出为 `null`。如果只需要保留匹配成功的行，可在后续追加 `filter not is_null([right_field])`。

节点映射：

```json
{
  "type": "join",
  "label": "表连接",
  "config": {
    "joinType": "left",
    "rightInput": "customers",
    "rightAlias": "customers",
    "conditions": [
      {
        "left": "orders.customer_id",
        "operator": "=",
        "right": "customers.customer_id"
      }
    ],
    "keep": [
      { "side": "left", "wildcard": true },
      { "source": "customers.name", "alias": "customer_name" },
      { "source": "customers.level", "alias": "customer_level" }
    ],
    "cardinality": "many_to_one",
    "conflict": {
      "strategy": "right_prefix",
      "rightPrefix": "customers_"
    }
  }
}
```

ASOF 节点映射：

```json
{
  "type": "join",
  "label": "ASOF 表连接",
  "config": {
    "joinType": "asof",
    "rightInput": "rates",
    "rightAlias": "rates",
    "asof": {
      "leftTime": "trades.trade_time",
      "operator": ">=",
      "rightTime": "rates.rate_time",
      "direction": "backward",
      "tolerance": "1d",
      "by": [
        {
          "left": "trades.currency",
          "operator": "=",
          "right": "rates.currency"
        }
      ]
    },
    "keep": [
      { "side": "left", "wildcard": true },
      { "source": "rates.rate", "alias": "fx_rate" }
    ],
    "cardinality": "many_to_one"
  }
}
```

配置字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `joinType` | `inner | left | right | full | cross | semi | anti | asof` | 连接类型 |
| `rightInput` | `string` | 右侧输入源 alias |
| `rightAlias` | `string?` | 右侧在连接条件中的临时 alias |
| `conditions` | `JoinCondition[]` | 连接条件，`cross` 可为空 |
| `asof` | `object?` | ASOF 连接的时间键、方向、容忍窗口和分组键 |
| `keep` | `JoinKeepItem[]?` | 输出字段控制 |
| `cardinality` | `string?` | 预期连接基数，用于运行时告警 |
| `conflict` | `object?` | 同名字段冲突处理 |

图边映射：

```text
orders(input_source)   --output--> join(left)
customers(input_source)--output--> join(right)
join                  --output--> next(input)
```

在 `DataWorkflowEdgeInput` 中：

- 左输入边：`targetHandle = "left"`
- 右输入边：`targetHandle = "right"`
- join 输出边：`sourceHandle = "output"`

约束：

- 除 `cross` 外，`join` 必须有 `on` 条件。
- v0.1 连接条件只支持等值条件，并允许多个条件用 `and` 串联。
- `join asof` 的 `on` 条件必须是一个时间/序列字段近邻条件，普通等值分组条件必须写在 `by` 中。
- 连接条件中的字段必须使用带输入 alias 的字段引用，格式为 `[table_name].[field_name]`。
- 右表 alias 必须来自已声明的 `input source ... as <alias>`。
- `semi` 和 `anti` 只输出左表字段，忽略 `keep right *`。
- `keep` 中 `as` 后的目标字段不能带输入 alias。
- 未写 `keep` 时默认保留左表全部字段和右表全部字段；同名字段使用 `right_prefix "<rightAlias>_"` 处理。
- `expect many_to_one` 或 `expect one_to_one` 运行时应检查右表 key 唯一性，不满足时给出告警。

### 6.10 aggregate

作用：按维度聚合。

语法：

```ebnf
aggregate_command := "aggregate" aggregate_group "metrics" metric_item ("," metric_item)*

aggregate_group   := "by" field_ref_list | "all"
metric_item       := agg_func_call "as" field_ref
agg_func_call     := AGG_FUNC "(" (scalar_expr | "*") ")"
```

示例：

```text
aggregate by [region]
  metrics sum([revenue]) as [total_revenue],
          avg([margin]) as [avg_margin],
          count(*) as [row_count]

aggregate all metrics count(*) as [row_count]
```

节点映射：

```json
{
  "type": "aggregate",
  "label": "聚合",
  "config": {
    "groupBy": ["region"],
    "metrics": [
      {
        "function": "sum",
        "expression": "[revenue]",
        "alias": "total_revenue"
      },
      {
        "function": "count",
        "expression": "*",
        "alias": "row_count"
      }
    ]
  }
}
```

支持聚合函数：

```text
sum(expr)
avg(expr)
min(expr)
max(expr)
count(expr)
count(*)
count_distinct(expr)
```

约束：

- `aggregate by` 至少一个字段。
- `aggregate all` 表示全表聚合。
- 指标别名必须唯一。
- 聚合函数只能出现在 `metrics` 中。

### 6.11 calculate_field

作用：生成新字段或覆盖现有字段。

公共 DSL 关键字统一为 `derive`，内部节点类型仍为 `calculate_field`。

语法：

```ebnf
calculate_field_command := "derive" derive_pair ("," derive_pair)*
derive_pair             := field_ref "=" expression
```

示例：

```text
derive [margin] = if [revenue] = 0 then 0 else [profit] / [revenue]
derive [month] = month([order_date])
derive [rn] = row_number() over(partition by [region] order by [revenue] desc)
```

节点映射：

```json
{
  "type": "calculate_field",
  "label": "计算字段",
  "config": {
    "calculations": [
      {
        "field": "margin",
        "expression": "if [revenue] = 0 then 0 else [profit] / [revenue]"
      }
    ]
  }
}
```

约束：

- 允许标量表达式和条件表达式。
- 允许窗口函数，但窗口函数必须带 `over(...)`。
- 不允许直接使用聚合函数。
- 目标字段可以是新字段，也可以覆盖现有字段。覆盖时 UI 应提示。

### 6.12 output

作用：定义任务输出。

语法：

```ebnf
output_command := "output" output_target output_options*

output_target  := "table" STRING
                | "dataset" STRING
                | "file" STRING ["format" output_format]

output_format  := "csv" | "parquet" | "xlsx" | "json"
output_options := "mode" ("replace" | "append" | "error_if_exists")
                | "name" STRING
```

示例：

```text
output table "clean_orders" mode replace
output dataset "客户订单清洗结果" mode replace
output file "/path/to/output/clean_orders.parquet" format parquet mode replace
```

节点映射：

```json
{
  "type": "output",
  "label": "输出",
  "config": {
    "destination": "duckdb_table",
    "table": "clean_orders",
    "mode": "replace"
  }
}
```

目标规范化：

| DSL | `destination` |
| --- | --- |
| `output table` | `duckdb_table` |
| `output dataset` | `dataset` |
| `output file` | `file` |

约束：

- `mode` 默认 `replace`。
- 输出表名必须通过安全标识符校验或由执行层引用转义。
- `append` 需要目标 schema 与当前 schema 兼容。

---

## 7. 表达式体系

### 7.1 表达式 EBNF

```ebnf
expression         := if_expr
                    | case_expr
                    | logical_expr
                    | window_expr

logical_expr       := logical_expr "or" logical_term
                    | logical_term

logical_term       := logical_term "and" logical_factor
                    | logical_factor

logical_factor     := "not" logical_factor
                    | comparison_expr

comparison_expr    := arithmetic_expr comparison_suffix?
comparison_suffix  := compare_op arithmetic_expr
                    | ["not"] "in" literal_list
                    | "between" arithmetic_expr "and" arithmetic_expr
                    | ["not"] "matches" STRING
                    | ["not"] "like" STRING

compare_op         := "=" | "!=" | ">" | ">=" | "<" | "<="

arithmetic_expr    := arithmetic_expr ("+" | "-") term
                    | term

term               := term ("*" | "/" | "%") factor
                    | factor

factor             := literal
                    | field_ref
                    | scalar_func_call
                    | "(" expression ")"

if_expr            := "if" boolean_expr "then" expression "else" expression

case_expr          := "case" when_clause+ else_clause "end"
when_clause        := "when" boolean_expr "then" expression
else_clause        := "else" expression
```

### 7.2 操作符优先级

从高到低：

1. `()`
2. 函数调用
3. `* / %`
4. `+ -`
5. `= != > >= < <=`
6. `not`
7. `and`
8. `or`

清洗常用条件示例：

```text
filter [status] in ("PAID", "REFUNDED")
filter [revenue] between 0 and 100000
filter [email] matches "^[^@]+@[^@]+$"
filter [name] not like "%测试%"
```

### 7.3 标量函数

```text
abs(x)
round(x)
round(x, precision)
ceil(x)
floor(x)
lower(str)
upper(str)
length(str)
concat(str1, str2, ...)
substring(str, start, length)
trim(str)
normalize_space(str)
contains(str, substr)
starts_with(str, prefix)
ends_with(str, suffix)
replace(str, search, replacement)
regexp_replace(str, pattern, replacement)
year(date)
month(date)
day(date)
date_diff(date1, date2)
date_trunc(unit, date)
coalesce(expr1, expr2, ...)
is_null(expr)
null_if(expr, value)
empty_to_null(str)
parse_number(str [, locale])
parse_date(str, format)
```

### 7.4 窗口函数

窗口函数只允许在 `derive` 对应的内部 `calculate_field` 中使用：

```text
row_number()
rank()
dense_rank()
lag(expr [, offset])
lead(expr [, offset])
cumulative_sum(expr)
```

语法：

```ebnf
window_expr      := window_func_call "over" "(" window_spec ")"
window_spec      := ["partition" "by" field_ref_list]
                    ["order" "by" sort_key ("," sort_key)*]
```

示例：

```text
derive [rn] = row_number() over(partition by [region] order by [revenue] desc)
```

### 7.5 表达式位置矩阵

| 上下文 | 标量函数 | 聚合函数 | 窗口函数 | 条件表达式 |
| --- | ---: | ---: | ---: | ---: |
| `filter` | 是 | 否 | 否 | 是 |
| `missing value fill` | 是 | 否 | 否 | 是 |
| `derive` | 是 | 否 | 是 | 是 |
| `aggregate metrics` | 聚合参数可用 | 主函数必须是聚合 | 否 | 是 |
| `join on` | 否 | 否 | 否 | 否 |
| `sort by` | 否 | 否 | 否 | 否 |

---

## 8. 配置 AST 与现有模型映射

### 8.1 Workflow AST

解析完整 DSL 后，建议得到以下中间结构：

```ts
type PrepOperatorType = DataWorkflowOperatorType | 'join';

interface PrepWorkflowAst {
  version: 'prep-dsl/v1';
  sources: PrepOperatorAst[];
  mainSource: string;
  operators: PrepOperatorAst[];
  output?: PrepOperatorAst;
}

interface PrepOperatorAst {
  key?: string;
  type: PrepOperatorType;
  label?: string;
  dsl: string;
  config: Record<string, unknown>;
  diagnostics?: PrepDiagnostic[];
}
```

### 8.2 编译到 DataTaskWorkflow

任务级 pipeline 编译成当前应用结构：

```ts
interface DataWorkflowNodeInput {
  id: string;
  type: PrepOperatorType;
  label: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
}

interface DataWorkflowEdgeInput {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: 'output';
  targetHandle: 'input' | 'left' | 'right';
}
```

推荐 `config` 同时保存规范化配置和原始 DSL：

```json
{
  "dsl": "filter [revenue] > 0",
  "condition": "[revenue] > 0",
  "exprAst": {
    "type": "binary_op",
    "op": ">",
    "left": { "type": "field", "name": "revenue" },
    "right": { "type": "literal", "value": 0 }
  }
}
```

### 8.3 节点布局

文本 DSL 编译成画布节点时，布局可以沿用当前 UI 的紧凑横向排列：

```text
x = 64 + (index % 4) * 150
y = 72 + floor(index / 4) * 64
```

后续 UI 拖拽只影响 `x/y`，不改变 DSL 语义。

---

## 9. 执行语义

### 9.1 推荐执行流程

```text
DSL 文本
  -> Lexer
  -> Parser
  -> Workflow AST
  -> Semantic Validator
  -> Logical Plan
  -> DuckDB SQL
  -> 输出表/数据集/文件
```

### 9.2 与当前 runTask 的关系

当前 `runTask` 逻辑会把源文件读入临时表，然后执行非空行过滤和 `SELECT DISTINCT *`。DSL 执行落地后，这段默认逻辑应改为一个隐式或显式工作流：

```text
input source task
  | missing value row drop when all_null
  | deduplicate
  | output table "<task_output_table>" mode replace
```

空行过滤可以通过公共 DSL 表达，也可由执行层在没有用户工作流时作为默认任务模板生成。它对应的规范化配置为：

```json
{
  "type": "missing_value",
  "config": {
    "strategy": "drop_empty_rows"
  }
}
```

### 9.3 DuckDB 编译边界

- 每个算子编译成一个 relation 子查询或临时 CTE。
- 字段名必须统一经过 DuckDB 标识符引用。
- 字符串、数字、布尔、空值必须通过参数化或安全字面量生成。
- `output table` 默认使用 `CREATE OR REPLACE TABLE` 语义。

---

## 10. 语义校验规则

### 10.1 图校验

- 一个任务至少有一个 `input_source`。
- 多输入任务中所有 `input_source` 必须有唯一 alias。
- `from <alias>` 必须引用已声明输入源。
- MVP 中最多一个 `output`。
- 除 `join` 外，每个非源节点必须只有一个入边。
- `join` 节点必须有一个 `left` 输入边和一个 `right` 输入边。
- 每个非输出节点最多一个主输出边；右表输入源可以同时被多个 `join` 读取。
- 必须是 DAG，不允许环。
- 不连通节点不能参与运行。

### 10.2 字段校验

- 所有字段必须使用 `[field]` 或 `[table_name].[field_name]`。
- 字段必须存在于上游 schema，除非它是当前 `derive` 的目标字段。
- 重命名、映射和计算产生的新字段不能在同一算子内被前置表达式引用。
- 输出 schema 中不能有重复字段。

### 10.3 函数位置校验

- 聚合函数只能出现在 `aggregate metrics`。
- 窗口函数只能出现在 `derive`。
- `filter`、`missing value fill` 不允许聚合函数和窗口函数。
- `sort by` 只能引用字段，不能写表达式。
- `join on` v0.1 只能使用字段等值条件，不能使用函数、窗口函数、聚合函数或任意标量表达式。

### 10.4 类型校验

- `cast` 目标类型必须是内置类型。
- `if` 和 `case` 各分支返回类型必须兼容。
- 数值函数只能接收数值类型。
- 日期函数只能接收日期/时间类型或可安全转换的字符串。

### 10.5 输出校验

- 输出表名、文件路径和数据集名不能为空。
- `append` 模式需要目标存在且 schema 兼容。
- 文件输出需要确认扩展名和 `format` 一致。

### 10.6 Join 校验

- 右侧输入源必须存在，不能引用当前节点之后才声明的源。
- `inner`、`left`、`right`、`full`、`semi`、`anti` 必须有至少一个 `on` 条件。
- `asof` 必须有一个且只能有一个 `on` 时间/序列近邻条件。
- `cross` 不允许写 `on` 条件，且执行前应提示可能产生行数膨胀。
- `semi`、`anti` 的输出 schema 等于左表 schema。
- `keep` 中的字段必须来自左表或右表，别名不能重复，目标别名不能带输入前缀。
- 未写 `keep` 时，同名字段必须按冲突策略自动重命名；不能静默覆盖。
- `expect one_to_one`、`expect many_to_one` 需要检查右表 key 唯一性并产出告警。
- `asof` 的左右时间字段必须是 `date`、`timestamp` 或可安全转换的数值序列。
- `asof` 的 `by` 条件只能是等值字段条件，字段必须带输入 alias，格式为 `[table_name].[field_name]`。
- `asof nearest` 必须声明 `tolerance`，避免误匹配过远历史/未来记录。
- `asof` 同时写 `direction` 时，必须与 `on` 运算符一致：`>=` 对应 `backward`，`<=` 对应 `forward`，`nearest` 对应 `nearest`。
- `asof` 执行前右表应按 `by` 字段和时间字段排序；执行层可以自动排序，但需要在运行日志中记录。

---

## 11. AI 生成约束

给 AI 生成数据任务 DSL 时，应使用以下约束：

- 只输出 DSL，不输出 SQL。
- 字段写成 `[field]`；join/asof 等多输入场景写成 `[table_name].[field_name]`。
- 优先生成线性 pipeline。
- 单源 pipeline 只包含一个 `input source` 和一个 `output`。
- 多源 join pipeline 必须先声明所有 `input source ... as <alias>`，再用 `from <mainAlias>` 开始主流程。
- 生成 `join` 时，连接条件字段必须写成 `[table_name].[field_name]`。
- 生成 `join asof` 时，时间近邻条件写在 `on`，业务分组等值条件写在 `by`，优先补充 `tolerance`。
- 不确定 join key 时不要猜测，应生成待确认诊断或让用户选择字段。
- 对列名标准化使用 `map`，对类型转换使用 `cast`，对新字段使用 `derive`。
- 不生成 `calculate` 或 `calculator` 关键字；行级计算一律使用 `derive`。
- `aggregate` 的指标必须写在 `metrics` 后，且每个指标必须有 `as [alias]`。
- 不确定的源文件使用 `input source task`，不要猜路径。
- 不确定的输出使用 `output table "<task_name>_clean" mode replace`。

推荐输出模板：

```text
input source task
  | select [field_a], [field_b], [field_c]
  | missing value row drop when all_null
  | missing value [field_a] nullify values ("", "N/A", "-")
  | cast [field_b] as double on_error null
  | missing value [field_b] fill 0
  | filter [field_b] > 0
  | output table "clean_result" mode replace
```

---

## 12. 完整示例

### 12.1 基础清洗

```text
input source task as raw_orders
  | select [order_id], [dt], [region], [rev], [profit], [status]
  | map [dt] to [order_date], [rev] to [revenue]
  | cast [order_date] as date format "yyyy-MM-dd",
         [revenue] as double on_error null,
         [profit] as double on_error null
  | missing value row drop when all_null
  | missing value [region] nullify values ("", "N/A", "-")
  | missing value [region] fill "UNKNOWN",
                  [revenue] fill 0,
                  [profit] fill 0
  | derive [margin] = if [revenue] = 0 then 0 else [profit] / [revenue]
  | filter [status] = "PAID" and [revenue] > 0
  | deduplicate by [order_id] keep last order by [order_date] desc
  | output table "clean_orders" mode replace
```

### 12.2 汇总任务

```text
input source dataset "clean_orders" as orders
  | derive [month] = date_trunc("month", [order_date])
  | aggregate by [region], [month]
      metrics sum([revenue]) as [total_revenue],
              avg([margin]) as [avg_margin],
              count(*) as [order_count]
  | sort by [month] asc, [total_revenue] desc
  | output table "region_month_summary" mode replace
```

### 12.3 Top N 前置写法

```text
input source dataset "clean_orders" as orders
  | derive [rn] = row_number() over(partition by [region] order by [revenue] desc)
  | filter [rn] <= 10
  | output table "top_orders_by_region" mode replace
```

### 12.4 多表连接清洗

```text
input source task as orders
input source dataset "customer_dim" as customers
input source dataset "blacklist_customers" as blacklist

from orders
  | missing value row drop when any_null in [order_id], [customer_id]
  | cast [order_date] as date format "yyyy-MM-dd",
         [revenue] as double on_error null
  | join anti blacklist
      on [orders].[customer_id] = [blacklist].[customer_id]
  | join left customers
      on [orders].[customer_id] = [customers].[customer_id]
      keep left *, [customers].[name] as [customer_name], [customers].[level] as [customer_level]
      expect many_to_one
  | missing value [customer_level] fill "UNKNOWN"
  | output table "clean_orders_with_customer" mode replace
```

### 12.5 ASOF 时间近邻连接

```text
input source task as events
input source dataset "device_status_snapshot" as status

from events
  | cast [event_time] as timestamp,
         [device_id] as string
  | join asof status
      on [events].[event_time] >= [status].[snapshot_time]
      by [events].[device_id] = [status].[device_id]
      tolerance 6h
      keep left *, [status].[firmware_version] as [firmware_version], [status].[region] as [device_region]
      expect many_to_one
  | missing value [firmware_version] fill "UNKNOWN"
  | output table "events_with_device_status" mode replace
```

---

## 13. 数据清洗补充设计

### 13.1 清洗结果统计

每次运行工作流时，执行层应为每个节点记录清洗统计，作为任务运行日志或节点日志展示：

```ts
interface PrepOperatorRunStats {
  nodeId: string;
  type: PrepOperatorType;
  inputRows: number;
  outputRows: number;
  droppedRows: number;
  changedCells: number;
  nullifiedCells: number;
  castFailedCells: number;
  warnings: string[];
}
```

这些统计不改变 DSL 语法，但会影响 UI：节点卡片和检查器应能显示删除行数、转换失败数、缺失填充数和告警。

### 13.2 被删除行与异常样本

涉及删除行的算子包括：

- `filter`
- `deduplicate`
- `missing value ... drop rows`
- `missing value row drop ...`

执行层建议支持可选审计输出：

```json
{
  "audit": {
    "droppedRows": "count",
    "sampleSize": 50,
    "reasonField": "_cleaning_reason"
  }
}
```

`droppedRows` 取值建议：

| 取值 | 说明 |
| --- | --- |
| `none` | 不保留删除样本，只记录统计 |
| `count` | 只记录删除行数 |
| `sample` | 保存删除样本 |
| `table` | 保存完整 reject table |

v0.1 可以先实现 `count`，后续再支持 `sample` 或 `table`。

### 13.3 清洗能力覆盖矩阵

| 清洗需求 | v0.1 DSL 表达 | 内部算子 |
| --- | --- | --- |
| 删除空行 | `missing value row drop when all_null` | `missing_value` |
| 关键字段缺失即删除 | `missing value row drop when any_null in ...` | `missing_value` |
| 特殊值转空 | `missing value [field] nullify values (...)` | `missing_value` |
| 缺失填充 | `missing value [field] fill ...` | `missing_value` |
| 类型转换 | `cast [field] as ...` | `type_convert` |
| 字段改名 | `map [old] to [new]` | `field_mapping` |
| 文本标准化 | `derive [field] = trim/replace/regexp_replace(...)` | `calculate_field` |
| 值域过滤 | `filter [field] in (...)` | `filter` |
| 范围过滤 | `filter [field] between ... and ...` | `filter` |
| 正则过滤 | `filter [field] matches "..."` | `filter` |
| 去重 | `deduplicate by ... keep ...` | `deduplicate` |
| 维表补充字段 | `join left dim on ... keep ...` | `join` |
| 黑名单/白名单过滤 | `join anti blacklist on ...` / `join semi whitelist on ...` | `join` |
| 时间近邻补齐 | `join asof snapshot on ... by ... tolerance ...` | `join` |
| 汇总质量指标 | `aggregate ... metrics ...` | `aggregate` |

### 13.4 暂不进入 v0.1 的候选算子

以下能力属于真实数据清洗常见需求，但除本文档已新增设计的 `join` 外，当前内部算子没有独立类型。建议先通过现有算子表达，等产品需要明确后再扩展 `DataWorkflowOperatorType`。

| 候选能力 | 推荐后续内部类型 | 说明 |
| --- | --- | --- |
| 异常值处理 | `outlier` | IQR、Z-score、分位数截尾、winsorize、置空或删除 |
| 质量校验 | `quality_check` | required、unique、range、regex、enum，不一定改变数据 |
| 值标准化字典 | `value_standardize` | 分类值归一，例如 `"CN" -> "China"` |
| schema/profile | `profile_schema` | 字段类型推断、空值率、唯一值、分布摘要 |
| 行拆分/展开 | `explode` | JSON/list 字段展开，当前不属于清洗 MVP |

候选语法示例，仅作为 v0.2 参考：

```text
outlier [revenue] method iqr action nullify
quality check required [order_id], unique [order_id], regex [email] "^[^@]+@[^@]+$"
standardize [country] using {"CN": "China", "中国": "China", "US": "United States"}
```

---

## 14. 版本与兼容性

v0.1 建议实现范围：

- 支持任务级线性 pipeline。
- 支持多源 `input source ... as <alias>` 声明和 `from <alias>` 主流程。
- 支持节点级 DSL 解析。
- 支持当前 11 个 `DataWorkflowOperatorType`，并新增设计 `join` 内部算子。
- 支持字段引用、基础表达式、条件表达式、常用标量函数。
- 支持清洗常用条件：`in`、`between`、`matches`、`like`。
- 支持空行删除、关键字段缺失删除、特殊缺失标记转空。
- 支持 `join` 的核心类型：`inner`、`left`、`right`、`full`、`cross`、`semi`、`anti`、`asof`。
- 支持 `aggregate` 的核心聚合函数。
- 支持将 DSL 编译成 `DataWorkflowNodeInput[]` 和 `DataWorkflowEdgeInput[]`。
- 公共 DSL 中只支持 `derive` 作为行级计算关键字，`calculate`/`calculator` 仅可作为旧草稿迁移输入的兼容别名，不作为保存后的规范形式。

暂不要求：

- 任意多输入图执行，v0.1 仅支持由 `join` 形成的多输入 DAG。
- union/pivot/unpivot 等当前应用尚未暴露的算子。
- 完整 SQL 互转。
- 跨任务变量赋值。

后续版本可以新增 `union`、`pivot` 等算子，但应先扩展 `DataWorkflowOperatorType`，再扩展 DSL。

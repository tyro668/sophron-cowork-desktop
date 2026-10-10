# 数据任务算子 DSL 开发计划 v0.2

## 1. 目标

基于 `design/prep/data-task-operator-dsl.md`，在当前应用中落地一套覆盖完整数据清洗流程的数据任务算子 DSL 能力。

本计划不只新增 `join` 算子，而是把当前数据任务画布已有算子和设计文档新增的连接能力统一纳入 DSL 主链路：

```text
input_source
field_select
field_mapping
filter
deduplicate
missing_value
type_convert
sort
calculate_field    # 公共 DSL 关键字为 derive
aggregate
join               # 包含普通 join、semi/anti join、asof join
output
```

目标能力：

- 用户和 AI 可以用文本 DSL 描述数据清洗、字段处理、类型转换、去重、排序、派生字段、聚合、普通 join 和 asof join。
- DSL 可以解析为 AST，并编译成当前画布使用的 `DataWorkflowNode` / `DataWorkflowEdge`。
- 当前工作流可以导出为规范 DSL，便于 AI 修改、版本记录和用户复制。
- 数据任务运行时可以按保存的工作流节点生成 DuckDB SQL 执行，而不是只做默认清洗。
- 每类算子都有结构化配置摘要、基础运行统计和测试覆盖。
- i18n 在 UI 边界完成，共享 DSL 包只输出稳定诊断码和英文 fallback，不直接内置中文 UI 文案。

v0.2 的目标是打通“DSL 解析 -> 语义校验 -> 工作流保存 -> DuckDB 执行 -> UI 导入导出与摘要”的主链路。高级可视化表单编辑、任意 DAG、reject table 全量审计、union/pivot/unpivot 等不进入本轮。

---

## 2. 当前边界

当前数据任务相关边界：

| 模块     | 边界                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------- |
| 类型定义 | `src/renderer/types/index.ts` 定义 `DataWorkflowOperatorType`，需要覆盖现有清洗算子并新增 `join`          |
| 存储层   | `src/main/data/data-task-store.ts` 保存节点和边，`operator_type` 是字符串，数据库层无需为新增算子单独迁移 |
| 执行层   | `runTask` 应优先按保存的 workflow 执行；无 workflow 时保留默认清洗行为                                    |
| UI 画布  | `src/renderer/components/DataView.tsx` 维护算子目录、节点拖拽、边连接、检查器、DSL 导入导出               |
| i18n     | `src/renderer/i18n/locales/zh.json` 和 `en.json` 承载 UI 文案、算子名称和 DSL 诊断文案                    |
| 测试     | `tests/data-duckdb-store.test.ts` 覆盖运行时，`tests/prep-dsl` 覆盖 DSL 解析、校验、编译和导出            |

开发时必须遵循 `UI_STYLE_GUIDE.md` 的紧凑操作型 UI 风格：小字号、小控件、数据表式摘要、低装饰性，避免营销式页面或大段说明。

---

## 3. 技术选型与目录

### 3.1 解析框架

推荐使用 `Chevrotain`：

- 项目主体是 TypeScript，Chevrotain 不需要额外代码生成。
- 适合受控 DSL：lexer、parser、CST visitor、错误定位可以分层维护。
- 后续可以把表达式解析、pipeline 解析和单节点 DSL 解析拆开测试。

新增依赖：

```text
chevrotain
```

### 3.2 共享 DSL 模块

```text
src/shared/prep-dsl/
  ast.ts
  tokens.ts
  parser.ts
  visitor.ts
  diagnostics.ts
  validator.ts
  workflow-compiler.ts
  exporter.ts
  expression.ts
  logical-plan.ts
  index.ts
```

职责：

- 定义 AST、表达式 AST、字段引用、算子配置类型。
- 解析完整任务 DSL 和单节点 DSL。
- 输出结构化诊断：`code`、`message`、`range`、`details`。
- 做跨算子语义校验。
- 编译为工作流 nodes/edges。
- 从工作流导出规范 DSL。

共享模块禁止依赖 React、Electron、i18next 或主进程数据库模块。

### 3.3 主进程执行模块

```text
src/main/data/
  data-task-store.ts
  workflow-runner.ts
  workflow-sql-compiler.ts
  workflow-run-stats.ts
```

职责：

- 按工作流拓扑顺序执行节点。
- 为每个节点生成 DuckDB SQL。
- 统一字段名、字面量、表达式和标识符转义。
- 记录节点级输入行数、输出行数、删除行数、转换失败数和告警。

### 3.4 渲染进程 UI

```text
src/renderer/components/DataView.tsx
src/renderer/i18n/locales/zh.json
src/renderer/i18n/locales/en.json
```

职责：

- 算子目录覆盖所有内部算子。
- DSL 导入、导出、诊断展示。
- 检查器展示每类算子的结构化配置摘要和运行日志。
- `join` 节点展示 `left` / `right` 两个输入 handle，其他节点保持单输入。

---

## 4. 算子覆盖矩阵

每个算子都必须完成五件事：解析成 AST、语义校验、编译成 workflow、编译成 SQL、在 UI 中可读。

| 内部算子          | DSL 关键字        | 核心配置                                                                  | SQL 执行目标                           | UI 摘要重点                    |
| ----------------- | ----------------- | ------------------------------------------------------------------------- | -------------------------------------- | ------------------------------ |
| `input_source`    | `input source`    | `source`、`filePath`、`datasetId`、`format`、`alias`                      | 绑定任务源、文件或数据集为 relation    | 来源、别名、格式               |
| `field_select`    | `select` / `drop` | `mode`、`columns`                                                         | 投影或排除字段                         | 模式、字段数、字段列表         |
| `field_mapping`   | `map` / `rename`  | `mappings`                                                                | 字段重命名并透传未映射字段             | 映射数量、样例                 |
| `filter`          | `filter`          | `condition`、`exprAst`                                                    | `WHERE` 布尔表达式                     | 条件表达式、删除行数           |
| `deduplicate`     | `deduplicate`     | `strategy`、`columns`、`keep`、`orderBy`                                  | `DISTINCT` 或 `row_number()`           | 去重字段、保留规则             |
| `missing_value`   | `missing value`   | `strategy`、`rules`                                                       | 空行删除、空值标准化、填充、按列删除   | 策略、规则数量、命中统计       |
| `type_convert`    | `cast`            | `conversions`                                                             | `CAST` / `TRY_CAST`，按 `onError` 处理 | 转换字段、失败数               |
| `sort`            | `sort by`         | `keys`                                                                    | `ORDER BY`                             | 排序键、空值顺序               |
| `calculate_field` | `derive`          | `calculations`                                                            | 投影新增或覆盖字段                     | 派生字段、表达式               |
| `aggregate`       | `aggregate`       | `groupBy`、`metrics`                                                      | `GROUP BY` 与聚合函数                  | 维度、指标                     |
| `join`            | `join`            | `joinType`、`rightInput`、`conditions`、`keep`、`conflict`、`cardinality` | 标准 join、semi/anti、asof join        | 连接类型、右表、条件、保留字段 |
| `output`          | `output`          | `destination`、`table`、`dataset`、`filePath`、`mode`                     | 写出目标表，后续扩展数据集/文件        | 目标、模式                     |

开发完成定义：

- 解析器能生成稳定配置 JSON。
- 校验器能阻止明显错误输入，并返回可本地化诊断码。
- workflow 编译结果可以保存、读取、导出。
- SQL 编译器能执行最小可用语义。
- UI 检查器能显示紧凑摘要，不能只显示原始 JSON。
- 至少有一个成功用例和一个失败/边界用例测试。

---

## 5. 数据模型与类型改造

### 5.1 算子类型

修改：

- `src/renderer/types/index.ts`
- `src/main/data/data-task-store.ts`
- `src/renderer/components/DataView.tsx`
- `src/renderer/i18n/locales/zh.json`
- `src/renderer/i18n/locales/en.json`

工作项：

- `DataWorkflowOperatorType` 覆盖全部算子，并新增 `'join'`。
- `WORKFLOW_OPERATOR_TYPES`、`DEFAULT_OPERATOR_LABELS`、`OPERATOR_CATALOG` 与类型保持一致。
- `normalizeOperatorType` 保留旧值兼容，例如 `source`、`select_fields`、`deduplicate_rows`、`join_table`、`asof_join`。
- UI 图标覆盖全部算子，`join` 建议使用 `GitMerge` 或相近 lucide 图标。

### 5.2 节点配置类型

在 `src/shared/prep-dsl/ast.ts` 中定义稳定配置类型，避免各处散乱使用 `Record<string, unknown>`。

```ts
type PrepOperatorType =
  | 'input_source'
  | 'field_select'
  | 'field_mapping'
  | 'filter'
  | 'deduplicate'
  | 'missing_value'
  | 'type_convert'
  | 'sort'
  | 'calculate_field'
  | 'aggregate'
  | 'join'
  | 'output';

interface PrepWorkflowAst {
  version: 'prep-dsl/v1';
  sources: PrepOperatorAst[];
  mainSource: string;
  operators: PrepOperatorAst[];
  output?: PrepOperatorAst;
}
```

每个算子需要独立配置类型：

- `PrepInputSourceConfig`
- `PrepFieldSelectConfig`
- `PrepFieldMappingConfig`
- `PrepFilterConfig`
- `PrepDeduplicateConfig`
- `PrepMissingValueConfig`
- `PrepTypeConvertConfig`
- `PrepSortConfig`
- `PrepCalculateFieldConfig`
- `PrepAggregateConfig`
- `PrepJoinConfig`
- `PrepOutputConfig`

`PrepJoinConfig` 至少覆盖：

- `joinType`
- `rightInput`
- `rightAlias`
- `conditions`
- `asof`
- `keep`
- `conflict`
- `cardinality`

### 5.3 运行统计

节点运行统计建议先作为任务运行结果的一部分返回，并可后续落表。

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

第一阶段可只保存最近一次运行统计，避免数据库迁移阻塞 DSL 主链路。若要持久化，再新增：

```text
data_workflow_runs
data_workflow_node_runs
```

---

## 6. 里程碑

### M1：DSL Lexer、Parser 与 AST

目标：完整任务 DSL 和单节点 DSL 都能解析成 AST，错误有行列位置和诊断码。

范围：

- 字段引用：`[field]`、`[table_name].[field_name]`。
- 禁止 `[table_name.field_name]`，并提示使用 `[table_name].[field_name]`。
- 字面量、列表、注释、字符串转义。
- 表达式：算术、比较、逻辑、`in`、`between`、`matches`、`like`、`if`、`case`、函数调用。
- pipeline：单源 `input source ... | ...`。
- 多源：`input source ... as alias` + `from alias`。
- 全部算子命令：
  - `input source`
  - `select` / `drop`
  - `map` / `rename`
  - `filter`
  - `deduplicate`
  - `missing value`
  - `cast`
  - `sort by`
  - `derive`
  - `aggregate`
  - `join`
  - `output`

算子级解析要求：

| 算子              | 解析重点                                                             |
| ----------------- | -------------------------------------------------------------------- |
| `input_source`    | `task`、`file`、`dataset`、format、sheet、header、encoding、alias    |
| `field_select`    | `select` 与 `drop` 归一成 `mode`                                     |
| `field_mapping`   | `map ... to ...` 与 `rename ... as ...` 归一成 `mappings`            |
| `filter`          | 保存原始条件，并生成可选表达式 AST                                   |
| `deduplicate`     | `by`、`keep`、`order by`                                             |
| `missing_value`   | 行级规则、列级规则、连续规则顺序                                     |
| `type_convert`    | 类型、format、on_error、locale、timezone                             |
| `sort`            | 多排序键、方向、nulls first/last                                     |
| `calculate_field` | `derive` 多字段赋值，公共 DSL 不暴露 `calculate` / `calculator`      |
| `aggregate`       | `aggregate by` / `aggregate all`、metrics、指标别名                  |
| `join`            | 普通 join、semi/anti、cross、asof、keep、suffix/right_prefix、expect |
| `output`          | table、dataset、file、format、mode、name                             |

验收：

- `tests/prep-dsl/lexer-parser.test.ts` 覆盖每个算子的成功解析。
- 每个算子至少覆盖一个语法错误用例。
- 设计文档中的完整示例都能解析。
- `[orders.customer_id]` 必须报错，并提示使用 `[orders].[customer_id]`。

### M2：语义校验

目标：AST 在进入 workflow 或 SQL 编译前完成跨算子、字段、图结构和执行边界校验。

全局校验：

- 一个任务至少有一个 `input_source`。
- 多源任务中所有 `input_source` 必须有唯一 alias。
- `from <alias>` 必须引用已声明输入源。
- MVP 中最多一个 `output`。
- 除 `join` 外，每个非源节点只能有一个主输入。
- `join` 必须有 `left` 和 `right` 两个输入。
- 所有字段引用必须使用 `[field]` 或 `[table_name].[field_name]`。
- 多输入场景的连接条件必须使用带输入 alias 的字段引用。

算子级校验：

| 算子              | 校验重点                                                                           |
| ----------------- | ---------------------------------------------------------------------------------- |
| `input_source`    | source 类型合法；file/dataset 必填项完整；alias 唯一                               |
| `field_select`    | `select` 不为空；`drop` 不能删除全部字段；字段存在                                 |
| `field_mapping`   | source 存在；target 不重复且不能带表名前缀                                         |
| `filter`          | 条件为布尔表达式；不允许聚合函数和窗口函数                                         |
| `deduplicate`     | `by` 字段存在；`keep last` 缺少 `order by` 给 warning                              |
| `missing_value`   | fill 类型与字段类型兼容；均值/中位数仅用于数值；前后填充缺少稳定排序给 warning     |
| `type_convert`    | 目标类型合法；format/timezone/locale 与类型兼容；`on_error` 合法                   |
| `sort`            | 排序字段存在；nulls 参数合法                                                       |
| `calculate_field` | 目标字段合法；表达式可编译；聚合函数禁止；窗口函数必须带 `over`                    |
| `aggregate`       | `by` 字段存在；指标别名唯一；聚合函数只能出现在 metrics                            |
| `join`            | 右输入存在；非 cross 必须有 on；asof 必须有时间近邻 on；条件使用 `[table].[field]` |
| `output`          | 输出目标合法；模式合法；默认输出表名可生成                                         |

验收：

- `tests/prep-dsl/validator.test.ts` 覆盖全局规则和每个算子规则。
- 诊断对象包含稳定 `code`，UI 通过 i18n 显示本地化文案。
- validator 不依赖数据库时，可只做结构和引用校验；schema 存在性校验允许在执行前增强。

### M3：Workflow 编译与 DSL 导出

目标：AST 可以编译成 `DataWorkflowNodeInput[]` / `DataWorkflowEdgeInput[]`，当前画布也可以导出规范 DSL。

范围：

- 单源 pipeline 编译为线性节点和边。
- 多源 pipeline 编译为多个 `input_source` 节点，加主流节点链路。
- `join` 节点生成双输入 edge handle：
  - 左输入：`targetHandle = "left"`
  - 右输入：`targetHandle = "right"`
  - 输出：`sourceHandle = "output"`
- 普通节点使用：
  - 输入：`targetHandle = "input"`
  - 输出：`sourceHandle = "output"`
- 节点 `config.dsl` 保存原始 DSL 片段。
- 自动布局沿用当前画布紧凑布局，并为右表输入源预留横向空间。
- 导出时按规范关键字输出：
  - `calculate_field` 导出为 `derive`
  - `field_mapping` 按原语义导出为 `map` 或 `rename`
  - `joinType = "asof"` 导出为 `join asof`

验收：

- `tests/prep-dsl/workflow-compiler.test.ts` 覆盖单源清洗、聚合、多源 join、asof join。
- `tests/prep-dsl/exporter.test.ts` 覆盖 workflow -> DSL -> workflow 往返。
- 编译结果能通过 `saveTaskWorkflow` 保存并重新读取。
- 重新打开任务后，节点类型、配置、边 handle 不丢失。

### M4：DuckDB SQL 编译与工作流执行

目标：`runTask` 能按保存的工作流节点执行，并为每类算子生成稳定 DuckDB SQL。

执行策略：

- 每个节点编译成一个临时 relation 或 CTE。
- 运行器按拓扑顺序执行，join 读取左 relation 和右 relation。
- 字段名统一使用 DuckDB 标识符引用。
- 字面量统一安全转义或参数化。
- 表达式从 AST 或受控 DSL 表达式编译，不直接拼接未校验原文。
- 默认无 workflow 时，仍生成兼容模板：

```text
input source task
  | missing value row drop when all_null
  | deduplicate
  | output table "<task_output_table>" mode replace
```

SQL 编译清单：

| 算子              | SQL 实现                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `input_source`    | 任务源直接绑定已有导入表；file/dataset 源按当前数据层能力加载或解析为待支持诊断                                                    |
| `field_select`    | `SELECT <columns>` 或排除字段后的投影                                                                                              |
| `field_mapping`   | `SELECT old AS new`，未映射字段默认透传                                                                                            |
| `filter`          | `WHERE <boolean_expr>`                                                                                                             |
| `deduplicate`     | 全字段 `SELECT DISTINCT`；按字段去重用 `row_number() over(partition by ...)`                                                       |
| `missing_value`   | 行删除、按列删除、指定值转 null、字面量填充；均值/中位数/众数/前后填充分阶段补齐                                                   |
| `type_convert`    | `TRY_CAST` / `CAST`，按 `on_error` 选择置空、失败或保留原值                                                                        |
| `sort`            | `ORDER BY`，包含方向和 nulls 位置                                                                                                  |
| `calculate_field` | `SELECT *` 加派生表达式；覆盖字段时重建投影                                                                                        |
| `aggregate`       | `GROUP BY` 与受控聚合函数                                                                                                          |
| `join`            | inner/left/right/full/cross 标准 join；semi/anti 用 `EXISTS` / `NOT EXISTS` 或原生 join；asof 用原生能力或 lateral/window fallback |
| `output`          | `CREATE TABLE AS SELECT`；append/error_if_exists 按 mode 处理                                                                      |

分阶段实现建议：

1. 投影类：`field_select`、`field_mapping`、`output`。
2. 行过滤类：`filter`、`deduplicate`、`missing_value` 的删除/空值标准化/字面量填充。
3. 表达式类：`type_convert`、`calculate_field`、`sort`。
4. 粒度变化类：`aggregate`。
5. 多输入类：普通 `join`、`semi`、`anti`、`cross`。
6. 时间近邻类：`asof join`。
7. 高级缺失填充：`forward_fill`、`backward_fill`、`mean_fill`、`median_fill`、`mode_fill`。

验收：

- `tests/data-duckdb-store.test.ts` 覆盖按 workflow 执行。
- 每个算子至少有一个 DuckDB 执行测试。
- 用 CSV fixture 验证：
  - 字段选择与字段映射
  - 缺失值处理
  - 类型转换
  - filter
  - deduplicate
  - sort
  - derive
  - aggregate
  - 普通 left join
  - semi/anti join
  - asof join
  - output mode replace

### M5：UI 接入与 i18n

目标：用户能在数据任务页使用完整 DSL 能力，并能读懂每类算子的配置与错误。

范围：

- 算子面板覆盖全部算子。
- `join` 节点显示两个输入 handle：`left` / `right`。
- DSL 导入入口：把文本 DSL 编译成画布节点。
- DSL 导出入口：把当前工作流导出为规范 DSL。
- 诊断列表使用 code -> i18n 文案映射，支持中文和英文。
- 检查器显示结构化配置摘要，不急着做完整表单编辑。
- 节点日志显示运行统计。

检查器摘要清单：

| 算子              | 摘要字段                                                 |
| ----------------- | -------------------------------------------------------- |
| `input_source`    | 来源、别名、格式、数据集或文件名                         |
| `field_select`    | include/exclude、字段数量、字段列表                      |
| `field_mapping`   | 映射数量、前几组 source -> target                        |
| `filter`          | 条件表达式、删除行数                                     |
| `deduplicate`     | 去重范围、保留规则、排序依据                             |
| `missing_value`   | 策略、规则列表、空值命中数、删除行数                     |
| `type_convert`    | 转换数量、目标类型、失败数                               |
| `sort`            | 排序键                                                   |
| `calculate_field` | 派生字段和表达式                                         |
| `aggregate`       | group by 字段、metrics                                   |
| `join`            | join 类型、右表、on/by 条件、keep、cardinality、冲突策略 |
| `output`          | 目标类型、表名/数据集/文件、mode                         |

UI 要求：

- 遵循 `UI_STYLE_GUIDE.md` 的紧凑操作型风格。
- 控件使用小字号、紧凑按钮、数据表格式摘要。
- 不做大面积说明文本。
- 不在共享 DSL 层写死中文文案。
- 不暴露本机绝对路径或个人路径；示例路径使用占位符。

验收：

- 在一个任务中粘贴包含多个算子的 DSL 后，画布节点和边正确生成。
- 导出的 DSL 能重新导入。
- join 节点可以看到 left/right 连接点。
- 每类算子在检查器里都有可读摘要。
- 保存、重新打开后工作流不丢失。

### M6：运行统计与日志

目标：每个算子运行后能提供基础质量反馈。

统计范围：

| 算子              | 关键统计                                         |
| ----------------- | ------------------------------------------------ |
| `input_source`    | 输入行数、字段数                                 |
| `field_select`    | 输出字段数                                       |
| `field_mapping`   | 改名字段数                                       |
| `filter`          | 删除行数                                         |
| `deduplicate`     | 删除重复行数                                     |
| `missing_value`   | 删除行数、置空单元格数、填充单元格数             |
| `type_convert`    | 转换失败单元格数                                 |
| `sort`            | 输入/输出行数                                    |
| `calculate_field` | 新增/覆盖字段数、表达式告警                      |
| `aggregate`       | 输入行数、输出分组数                             |
| `join`            | 左表行数、右表行数、输出行数、未匹配数、基数告警 |
| `output`          | 输出行数、输出字段数                             |

验收：

- 节点日志中可以看到输入行数、输出行数和关键告警。
- 涉及删除行的算子都能统计 `droppedRows`。
- join 能提示 many_to_one / one_to_one 期望不满足的告警。

### M7：质量、兼容与性能

目标：降低 DSL 进入主流程后的回归风险。

工作项：

- 保留旧工作流节点保存/读取兼容。
- 未知 `operator_type` 仍按现有规则降级或提示。
- DSL parser diagnostics 使用稳定 code，UI 负责本地化文案。
- 加入基础性能测试：100k 行 CSV、10 个清洗节点、2 个 join。
- 明确 DuckDB ASOF JOIN 对不同版本的 fallback 策略。
- 增加字段名、表名、字符串字面量转义测试。
- 检查设计文档和测试 fixture，避免出现真实个人路径。

验收：

- 现有 `tests/data-duckdb-store.test.ts` 全部通过。
- 新增 DSL 测试全部通过。
- `npm run typecheck` 通过。
- 关键 SQL 编译路径有单元或集成测试覆盖。

---

## 7. 逐算子开发清单

### 7.1 `input_source`

- Parser：支持 `task`、`file`、`dataset`、format、sheet、header、encoding、alias。
- Validator：多源 alias 必填且唯一；source 必填项完整。
- Workflow：每个 source 生成独立节点；多源时 `from` 指定主链路起点。
- SQL：任务源绑定当前任务输入表；数据集/文件源按现有数据层能力加载。
- UI：摘要展示来源、别名、格式。
- Tests：单源任务、多源任务、缺失 alias、重复 alias。

### 7.2 `field_select`

- Parser：`select` -> include，`drop` -> exclude。
- Validator：字段列表非空；字段存在；drop 后至少保留一列。
- Workflow：线性节点。
- SQL：投影字段或排除字段。
- UI：摘要展示模式与字段数。
- Tests：include、exclude、未知字段、drop 全部字段。

### 7.3 `field_mapping`

- Parser：`map [old] to [new]`、`rename [old] as [new]`。
- Validator：source 存在；target 唯一；target 不带表名前缀。
- Workflow：线性节点。
- SQL：重命名投影，未列字段透传。
- UI：摘要展示映射列表。
- Tests：多字段映射、target 重复、特殊字段名转义。

### 7.4 `filter`

- Parser：保存条件原文并生成表达式 AST。
- Validator：表达式必须返回 boolean；禁止聚合和窗口函数。
- Workflow：线性节点。
- SQL：编译为 `WHERE` 条件。
- UI：摘要展示条件，日志展示删除行数。
- Tests：比较、逻辑、in、between、matches、非法表达式。

### 7.5 `deduplicate`

- Parser：支持全字段去重、`by`、`keep`、`order by`。
- Validator：去重字段存在；缺少稳定排序时给 warning。
- Workflow：线性节点。
- SQL：全字段 `DISTINCT`；按字段用窗口函数筛选。
- UI：摘要展示去重字段和保留规则。
- Tests：全字段、按键、keep first/last、排序。

### 7.6 `missing_value`

- Parser：支持行级规则和列级规则，保留规则顺序。
- Validator：字段存在；填充值类型兼容；均值/中位数用于数值字段。
- Workflow：线性节点。
- SQL：先实现 row drop、drop rows、nullify values、literal fill；再补齐统计填充和前后填充。
- UI：摘要展示规则表和命中统计。
- Tests：全空行删除、关键字段删除、特殊值转 null、字面量填充、连续规则。

### 7.7 `type_convert`

- Parser：支持多字段 cast、format、on_error、locale、timezone。
- Validator：类型名合法；选项与目标类型兼容。
- Workflow：线性节点。
- SQL：`TRY_CAST`、`CAST`，按 `onError` 控制失败行为。
- UI：摘要展示转换字段和目标类型。
- Tests：日期、时间戳、数值、on_error null/fail/keep。

### 7.8 `sort`

- Parser：支持多排序键、方向、nulls first/last。
- Validator：排序字段存在。
- Workflow：线性节点。
- SQL：`ORDER BY`。
- UI：摘要展示排序键。
- Tests：单键、多键、空值位置。

### 7.9 `calculate_field`

- Parser：公共 DSL 只接受 `derive`，支持多个赋值。
- Validator：目标字段合法；表达式可编译；窗口函数必须带 `over`。
- Workflow：线性节点，内部类型为 `calculate_field`。
- SQL：新增字段或覆盖字段时重建投影。
- UI：摘要展示目标字段和表达式。
- Tests：标量计算、条件表达式、文本函数、窗口函数、覆盖字段。

### 7.10 `aggregate`

- Parser：支持 `aggregate by ... metrics ...` 和 `aggregate all metrics ...`。
- Validator：分组字段存在；指标别名唯一；聚合函数白名单。
- Workflow：线性节点，但会改变数据粒度。
- SQL：`GROUP BY`、`count(*)`、`count_distinct` 等聚合函数。
- UI：摘要展示分组字段和指标。
- Tests：按维度聚合、全表聚合、别名重复、非法聚合函数。

### 7.11 `join`

- Parser：支持 `inner`、`left`、`right`、`full`、`cross`、`semi`、`anti` 和 `asof`。
- Validator：右输入存在；连接字段必须写成 `[table_name].[field_name]`；asof 必须有时间近邻条件。
- Workflow：生成 `left` / `right` 双输入边。
- SQL：标准 join、semi/anti、cross、asof fallback。
- UI：摘要展示连接类型、右表、条件、keep、cardinality。
- Tests：left join、多字段 join、anti join、semi join、cross join、字段冲突、asof join。

### 7.12 `output`

- Parser：支持 `table`、`dataset`、`file`、format、mode、name。
- Validator：目标和 mode 合法。
- Workflow：终止节点。
- SQL：v0.2 先稳定支持 `output table`；dataset/file 先解析并在执行层按能力接入或给出明确诊断。
- UI：摘要展示目标和写入模式。
- Tests：replace、append、error_if_exists、默认输出表。

---

## 8. 建议实施顺序

1. 类型、i18n、诊断码和算子目录对齐，确保所有算子都有稳定内部类型和文案。
2. 完成 parser/AST，先让全部算子都能解析，但不急着接执行。
3. 完成 validator，让错误 DSL 能被挡在 workflow 保存前。
4. 完成 AST -> workflow 编译和 workflow -> DSL 导出。
5. 重构后端执行器，先支持单源投影类和行过滤类算子。
6. 接入表达式类算子：`type_convert`、`derive`、`sort`。
7. 接入粒度变化类算子：`aggregate`。
8. 接入多输入类算子：普通 join、semi/anti、cross。
9. 接入 asof join 和 join 基数告警。
10. 补齐 UI 检查器的全算子配置摘要和节点运行日志。
11. 补齐性能、兼容和安全转义测试。

这个顺序保证每一步都有可验证产物，也能避免一开始就把 parser、UI 和 SQL 执行全部绑在一起。

---

## 9. 风险与处理

| 风险                        | 处理                                               |
| --------------------------- | -------------------------------------------------- |
| DSL parser 一次性过大       | 先覆盖命令级解析，再逐步增强表达式 AST 和错误恢复  |
| 表达式直接拼 SQL 有注入风险 | 字段、函数、字面量全部通过 AST 或白名单编译        |
| DuckDB ASOF JOIN 语法差异   | 写独立适配层，必要时用 lateral/window fallback     |
| 字段名转义复杂              | 全部通过 FieldRef AST 编译，不拼接原始字段文本     |
| join 后字段冲突             | 默认 `right_prefix`，禁止静默覆盖                  |
| 缺失值高级填充实现复杂      | 先实现清洗 MVP，再补前后填充和统计填充             |
| UI 表单配置太复杂           | v0.2 先 DSL 导入/导出 + 摘要展示，完整表单后续迭代 |
| 旧工作流兼容                | `operator_type` 是字符串，可先兼容读取，再扩展类型 |
| i18n 与共享模块耦合         | 共享模块只输出 code，渲染进程负责本地化            |

---

## 10. 测试矩阵

| 测试文件                                   | 覆盖内容                               |
| ------------------------------------------ | -------------------------------------- |
| `tests/prep-dsl/lexer-parser.test.ts`      | 全算子语法、字段引用、错误定位         |
| `tests/prep-dsl/validator.test.ts`         | 全局规则、字段规则、算子级规则         |
| `tests/prep-dsl/workflow-compiler.test.ts` | AST 到 nodes/edges，join handle，布局  |
| `tests/prep-dsl/exporter.test.ts`          | workflow 导出 DSL，往返稳定性          |
| `tests/prep-dsl/expression.test.ts`        | 表达式 AST、函数白名单、SQL 表达式编译 |
| `tests/prep-dsl/duckdb-sql.test.ts`        | 单节点 SQL 编译                        |
| `tests/data-duckdb-store.test.ts`          | 端到端工作流执行和输出表验证           |

每个算子至少覆盖：

- 一个成功解析用例。
- 一个语义错误用例。
- 一个 workflow 编译用例。
- 一个 SQL 执行或 SQL 编译用例。
- 一个导出 DSL 用例。

---

## 11. 本轮不做

- 任意多分支 DAG 编辑和执行；v0.2 只支持由 `join` 形成的多输入 DAG。
- union、pivot、unpivot、explode 等未进入当前内部算子集合的能力。
- 完整 reject table 审计；本轮先做统计和少量告警。
- 每个算子的完整表单编辑器；先做 DSL 和配置摘要。
- AI 自动推断 join key；不确定时应生成诊断或让用户选择字段。

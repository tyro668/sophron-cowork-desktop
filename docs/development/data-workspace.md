# 数据工作区

数据工作区是本项目区别于普通聊天 Agent 的核心模块。它把本地 CSV/Excel/文件夹导入成可查询表，允许用户用流程图或 Prep DSL 组织数据清洗任务，并把同一能力暴露给 Agent 自定义工具。

## 模块分层

```text
DataView UI
  -> preload data API
  -> main data.* IPC handlers
  -> DataCommandService
  -> DataTaskStore
       metadata: SQLite cowork.db
       table data: DuckDB workspace.duckdb
       normalizer projects/runs: userData/data/input-table-normalizers

Agent 会话
  -> DataAgentRuntimeExtension
  -> DataToolService
  -> DataCommandService
  -> DataTaskStore
```

主流程中 [`createDataTaskStore`](../../src/main/data/data-task-store.ts) 的构造方式在 [`main/index.ts`](../../src/main/index.ts)：

- `dbPath`: `join(app.getPath('userData'), 'data', 'workspace.duckdb')`
- `metadataDb`: 通用 SQLite `DatabaseInstance`

因此默认运行时：

- 数据任务、输入表元数据、输出表元数据、流程节点、normalizer 版本元数据在 `cowork.db`。
- 导入后的实际表、流程临时表、输出表在 `workspace.duckdb`。
- 如果测试或单独实例化时未传 `metadataDb`，metadata 会回落到 DuckDB。

## 关键代码

| 文件                                                                                                           | 职责                                                         |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`src/renderer/components/DataView.tsx`](../../src/renderer/components/DataView.tsx)                           | 数据工作台 UI，包含列表、导入、预览、流程图、DSL、normalizer |
| [`src/main/data/data-task-store.ts`](../../src/main/data/data-task-store.ts)                                   | 数据任务底层 store，管理 metadata、DuckDB 表、流程执行       |
| [`src/main/data/data-command-service.ts`](../../src/main/data/data-command-service.ts)                         | 面向 UI 和 Agent 的命令服务，做输入校验、业务编排和错误归一  |
| [`src/main/data/data-tool-service.ts`](../../src/main/data/data-tool-service.ts)                               | 把命令结果格式化成 Agent 工具结果                            |
| [`src/main/data/data-tool-definitions.ts`](../../src/main/data/data-tool-definitions.ts)                       | TypeBox schema 和 Agent custom tool 定义                     |
| [`src/main/data/data-agent-extension.ts`](../../src/main/data/data-agent-extension.ts)                         | 会话前注入数据工具 prompt 和 custom tools                    |
| [`src/main/data/data-tool-prompt.ts`](../../src/main/data/data-tool-prompt.ts)                                 | Agent 使用数据工具的系统说明                                 |
| [`src/main/data/input-table-normalizer-generator.ts`](../../src/main/data/input-table-normalizer-generator.ts) | LLM 生成自定义输入表 normalizer 项目                         |
| [`src/main/data/input-table-normalizer-runner.ts`](../../src/main/data/input-table-normalizer-runner.ts)       | 在受控工作目录运行 normalizer 项目并读取 manifest            |
| [`src/shared/prep-dsl`](../../src/shared/prep-dsl)                                                             | 数据流程 DSL AST、解析、校验、导出、编译                     |
| [`docs/prep-dsl-reference.md`](../prep-dsl-reference.md)                                                       | 从 DSL reference 生成的用户/Agent 参考                       |

## 数据对象

主要类型在 [`src/renderer/types/index.ts`](../../src/renderer/types/index.ts)：

- `DataCleaningTask`：数据任务，记录状态、源、输出表、行列数、错误、运行时间。
- `DataDataset`：输入表或输出表 metadata，指向真实 DuckDB table。
- `DataOutputTable`：输出表视图，底层同样复用 `DataDataset`。
- `DataTaskWorkflow`：流程图节点和边。
- `DataWorkflowNode`：operator 节点，包含 `type`、`label`、坐标和 config。
- `DataWorkflowEdge`：节点连线。
- `DataInputTableConfig`：CSV、Excel、文件夹导入配置。
- `DataInputTableNormalizerArtifact` / `Version`：自定义 normalizer 资产和版本。
- `DataInputTablePreview`：预览表结构和行数据。

支持的 `DataWorkflowOperatorType`：

- `input_source`
- `filter`
- `field_select`
- `deduplicate`
- `missing_value`
- `type_convert`
- `sort`
- `join`
- `aggregate`
- `calculate_field`
- `field_mapping`
- `limit`
- `pivot`
- `unpivot`
- `set_op`
- `unnest`
- `output`

新增 operator 必须同时改 UI catalog、类型、DSL、后端 SQL 编译和测试。

## DataTaskStore

[`DataTaskStore`](../../src/main/data/data-task-store.ts) 是数据模块底层实现。

主要职责：

- 初始化 metadata schema：
  - `data_cleaning_tasks`
  - `data_datasets`
  - `data_input_table_normalizer_artifacts`
  - `data_input_table_normalizer_artifact_versions`
  - `data_workflow_nodes`
  - `data_workflow_edges`
  - `data_workflow_node_caches`
- 初始化 DuckDB 连接。
- 导入 CSV/Excel/文件夹为 DuckDB table。
- 预览输入表、输出表、流程节点。
- 保存和运行 workflow。
- 把 workflow operator 编译成 DuckDB SQL。
- 维护 workflow node cache，支持 UI 中的节点预览。
- 管理 normalizer artifact/version 的文件落盘、发布和删除。

关键方法：

- `getDashboard(query)`：数据页首屏列表和统计。
- `createTask` / `updateTask` / `runTask` / `deleteTask`。
- `importDataset` / `updateDataset` / `deleteDataset`。
- `createOutputTable` / `updateOutputTable`。
- `getTaskWorkflow` / `saveTaskWorkflow`。
- `previewDataset` / `previewInputTable` / `previewWorkflowNode`。
- `summarizeInputTableSource`：内置 reader 抽样源文件结构。
- `saveInputTableNormalizerArtifactVersion` / `publishInputTableNormalizerArtifactVersion`。

维护注意：

- SQL identifier 必须走本地 quote/validate helper，不要拼用户输入。
- metadata 和 DuckDB 表数据是两套连接，事务边界不是完全一样的。
- 删除数据集时要同时删除 metadata 和 DuckDB table。
- output table 的 metadata 清理依赖 `cleanupOutputTableMetadata`。
- workflow 临时表需要及时清理 cache，避免 DuckDB 文件膨胀。

## DataCommandService

[`DataCommandService`](../../src/main/data/data-command-service.ts) 位于 UI/Agent 和 store 之间，负责业务编排。

典型职责：

- 参数规范化：名称、source path、source kind、分页、preview rows。
- 唯一性检查：输入表、输出表名称。
- 将底层错误映射为 `DataCommandError`。
- 执行组合命令：
  - `createInputTableWithProcessingStrategy`
  - `generateInputTableNormalizerDraft`
  - `previewInputTableNormalizerVersion`
  - `publishInputTableNormalizerVersion`
  - `applyWorkflowDsl`
  - `applyOperatorDsl`
  - `exportWorkflowDsl`
- 在 custom normalizer 流程中串联：源摘要 -> LLM 生成项目 -> 预览 -> 发布 -> 导入输入表。

维护建议：

- UI 和 Agent 共用的业务规则应放在这里。
- 只属于显示层的字符串格式化不要放这里，应放 `DataToolService` 或 UI。
- Agent 工具 schema 改动时要同步 command type。

## Agent 数据工具

数据工具由 [`createDataAgentRuntimeExtension`](../../src/main/data/data-agent-extension.ts) 注入。

运行时流程：

1. `beforeSessionRun` 调用 `DataToolService.resolveConversationContext`。
2. `buildDataToolPrompt` 根据 session/workspace 生成说明。
3. `createDataCustomTools` 返回 TypeBox 工具定义。
4. 工具执行时调用 `DataToolService`。
5. `DataToolService` 调 `DataCommandService` 并格式化文本结果。

常见工具能力：

- 列出输入表、输出表、任务。
- 创建/更新输入表和输出表。
- 预览表。
- 创建/更新/运行数据任务。
- 读取、应用、导出 workflow DSL。
- 生成/预览/发布 input-table normalizer。
- 获取 run result。

权限策略中部分只读数据工具默认 allow，见 [`permission-policies.ts`](../../src/shared/permission-policies.ts)。

## Prep DSL

Prep DSL 是数据流程的文本表示，服务 UI 和 Agent。

代码结构：

- [`ast.ts`](../../src/shared/prep-dsl/ast.ts)：operator 类型、AST 和 diagnostic 类型。
- [`parser.ts`](../../src/shared/prep-dsl/parser.ts)：文本 DSL -> AST。
- [`validator.ts`](../../src/shared/prep-dsl/validator.ts)：别名、join、set op 等校验。
- [`workflow-compiler.ts`](../../src/shared/prep-dsl/workflow-compiler.ts)：AST -> flow nodes/edges。
- [`exporter.ts`](../../src/shared/prep-dsl/exporter.ts)：flow nodes/edges -> DSL。
- [`reference.ts`](../../src/shared/prep-dsl/reference.ts)：DSL 文档来源。

DSL 示例：

```text
input source dataset "<inputTableId>" as src
  | select [order_id], [region]
  | filter [amount] > 0
  | output table "clean_orders" mode replace
```

新增 operator checklist：

1. 在 `PrepOperatorType` 和 renderer `DataWorkflowOperatorType` 中加入类型。
2. 在 `parser.ts` 支持解析文本。
3. 在 `validator.ts` 补必要规则。
4. 在 `workflow-compiler.ts` 确认连线逻辑。
5. 在 `exporter.ts` 支持从 flow config 导出 DSL。
6. 在 `DataTaskStore` 中加入 SQL 编译。
7. 在 `DataView` 中加入 operator catalog、节点图标、配置面板、摘要和预览字段。
8. 更新 `reference.ts`，重新生成或更新 [`docs/prep-dsl-reference.md`](../prep-dsl-reference.md)。
9. 增加 `tests/prep-dsl/*` 和 `tests/data-operator-dsl-execution.test.ts`。

## Input Table Normalizer

Normalizer 用于处理复杂 Excel/CSV/文件夹输入，尤其是多 sheet、合并单元格、非标准表头。

流程：

1. `summarizeInputTableSource` 使用内置 Node reader 抽样真实文件。
2. [`input-table-normalizer-generator`](../../src/main/data/input-table-normalizer-generator.ts) 调 LLM：
   - 先做结构分析，要求返回严格 JSON。
   - 再根据模板生成 Python 或 Node 项目文件。
3. 生成结果合并到 [`shared/input-table-normalizer/templates.ts`](../../src/shared/input-table-normalizer/templates.ts) 提供的项目模板。
4. `DataTaskStore.saveInputTableNormalizerArtifactVersion` 保存版本 metadata 和项目文件。
5. [`input-table-normalizer-runner`](../../src/main/data/input-table-normalizer-runner.ts) 在运行目录写入项目文件和 `context.json`。
6. runner 执行 dependency prepare 和 entrypoint。
7. normalizer 写 `manifest.json` 和输出文件。
8. runner 校验 manifest，确认输出留在 output 目录内。
9. 发布版本后，输入表 config 记录 `artifactId`、`artifactVersionId`、file hash、runtime、entrypoint 和 project files。

安全点：

- 项目文件路径必须是相对路径，不能逃出 project root。
- manifest output 必须留在 output 目录。
- 命令变量由 runner 生成并插值。
- 默认提示要求不使用外部依赖；如果未来允许依赖，必须严格维护 `dependencyPrepare` 和 lock hash。

## DataView UI 维护边界

`DataView.tsx` 很大，修改时建议按内部组件定位：

- `DataView`：顶层 dashboard 状态、tab、导航、加载。
- `TasksPanel` / `TasksTable`：任务列表和操作。
- `InputTablesPanel` / `InputTableEditorWorkbench` / `InputTableEditor`：输入表管理。
- `OutputTablesPanel` / `OutputTableEditor`：输出表管理。
- `TaskEditor`：任务编辑和 workflow 管理入口。
- `WorkflowCanvas` / `WorkflowOperatorNode` / `WorkflowInspector`：流程图。
- `WorkflowDslDialog`：DSL 文本编辑。
- `InputTableGenerationOutputPanel` / `CodePreview` / `NormalizerProjectTree` / `InputTableVersionHistoryPanel`：normalizer 生成和版本。
- `GlassDataGridPreview`：预览表格。

改 UI 时：

- 保持 [`UI_STYLE_GUIDE.md`](../../UI_STYLE_GUIDE.md) 的紧凑操作台风格。
- 表格分页只显示真实页码。
- 批量删除要分批，避免一次删除大量数据阻塞 UI。
- workflow 节点有固定尺寸，避免 hover 或 label 改变布局。

## 数据模块测试

重点测试：

- [`tests/data-tool-service.test.ts`](../../tests/data-tool-service.test.ts)
- [`tests/data-command-service.test.ts`](../../tests/data-command-service.test.ts)
- [`tests/data-agent-extension.test.ts`](../../tests/data-agent-extension.test.ts)
- [`tests/data-tool-prompt.test.ts`](../../tests/data-tool-prompt.test.ts)
- [`tests/data-duckdb-store.test.ts`](../../tests/data-duckdb-store.test.ts)
- [`tests/data-operator-dsl-execution.test.ts`](../../tests/data-operator-dsl-execution.test.ts)
- [`tests/input-table-normalizer.test.ts`](../../tests/input-table-normalizer.test.ts)
- [`tests/prep-dsl/parser-compiler.test.ts`](../../tests/prep-dsl/parser-compiler.test.ts)
- [`tests/prep-dsl/operator-dsl-cases.test.ts`](../../tests/prep-dsl/operator-dsl-cases.test.ts)
- [`tests/prep-dsl/reference.test.ts`](../../tests/prep-dsl/reference.test.ts)
- [`tests/data-resource-link-navigation.test.ts`](../../tests/data-resource-link-navigation.test.ts)

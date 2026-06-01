# 数据页面 CLI 化与数据任务 Tool Call 化设计文档 v0.1

## 1. 背景

当前数据页面已经具备以下核心能力：

- 数据任务：创建、编辑、保存工作流、运行工作流、删除。
- 输入表：新增 Excel/CSV/文件夹输入表、编辑配置、预览、删除。
- 输出表：新增输出表、编辑来源输入表、预览、删除。
- 数据任务算子：输入、DSL 算子、输出算子配置，工作流节点和连线保存。
- 执行层：`DataTaskStore.runTask` 可以按工作流连线从输入算子执行到输出算子，并写入临时或正式 DuckDB 表。
- DSL 层：`src/shared/prep-dsl` 已支持任务级和单算子级 DSL 解析、导出、校验和工作流编译。

但这些能力主要通过 UI 和 Electron IPC 暴露。为了让自动化、脚本、LLM agent 和后续远程控制都能稳定复用数据能力，需要把数据页面所有操作抽象为统一命令能力，并进一步注册为可被 LLM `tool_call` 调用的数据处理工具。

本文设计两个目标：

1. 数据页面所有操作 CLI 化，支持 CLI 完成当前 UI 能完成的全部事情。
2. 数据任务处理能力 Tool 化，让任务中的 LLM 可以通过 `tool_call` 调用数据处理、预览、配置和执行能力。

---

## 2. 目标与非目标

### 2.1 目标

- 提供稳定的 `sophron data ...` CLI 命令族，覆盖数据任务、输入表、输出表、工作流和算子配置。
- CLI 不依赖浏览器或界面点击，不通过 GUI 自动化模拟用户操作。
- CLI 与 UI、tool_call 共享同一套数据应用服务，避免出现三套业务逻辑。
- 所有写配置的操作继续写入 `cowork.db`。只有导入后的物理表、临时结果表、正式结果表写入 DuckDB。
- 支持 JSON 输出，便于脚本和 LLM 消费。
- 支持 dry-run、validate、preview、run 等安全工作流。
- 将数据处理能力以 agent custom tools 方式注册给 LLM，必要时也可以作为 MCP server 暴露给外部 agent。
- 支持 LLM 通过 tool_call 执行以下典型任务：
  - 查询有哪些输入表、输出表、数据任务。
  - 基于用户选择或授权的本地文件/文件夹创建输入表。
  - 创建输出表，供后续数据任务写入或复用。
  - 创建或修改数据任务。
  - 为输入算子选择输入表。
  - 修改非输入/输出算子的 DSL。
  - 为输出算子选择输出表或自动输出表名称。
  - 运行任务并读取结果预览。
  - 对输入表或中间 DSL 做临时预览，不污染正式输出表。

### 2.2 非目标

- 不设计新的通用 SQL 编辑器。
- 不把 LLM tool 设计成任意文件读写工具。
- 不绕过现有权限模型直接给 LLM 任意访问本机文件系统。
- 不用 CLI 替代 UI，只保证两者能力等价、状态一致。
- 不在本轮设计分布式调度或远程多用户协作。

---

## 3. 设计原则

### 3.1 一个业务核心，三个入口

数据操作必须收敛到同一层服务：

```text
UI IPC
CLI
LLM tool_call
        |
        v
DataCommandService / DataTaskToolService
        |
        v
DataTaskStore + prep-dsl + DuckDB runner
```

禁止在 CLI 或 tool_call 中重新实现导入、保存、运行、预览逻辑。

### 3.2 CLI 输出稳定优先

CLI 默认可以输出人类可读表格，但必须支持 `--json`。所有自动化、LLM 和测试都应使用 JSON。

```bash
sophron data input list --json
sophron data task run --id task_xxx --json
```

JSON 字段要稳定，新增字段允许，删除和改名需要版本化。

### 3.3 配置写 SQLite，数据写 DuckDB

- 数据任务、输入表、输出表、工作流节点、连线、算子配置：写入 `cowork.db`。
- 输入表导入后的物理表、输出表物理表、任务临时结果表：写入 DuckDB。
- tool_call 和 CLI 都不能直接写 UI 内存状态，必须走持久化或临时运行结果协议。

### 3.4 Tool 要小而可控

LLM 工具不应暴露一个万能 `execute_data_command` 作为主要接口。应提供粒度合适、可审计、可权限控制的工具。

允许提供一个低层 escape hatch：

```text
data_cli_command
```

但默认不暴露给普通 agent，或者标记为高风险需要用户确认。

### 3.5 临时运行和正式运行明确区分

LLM 和 CLI 都必须显式区分：

- `temporary`：写入临时结果表，不改工作流，不覆盖正式输出表。
- `persisted`：使用已保存配置执行，写入正式输出表。

这与当前 `runTask(..., outputMode)` 语义保持一致。

---

## 4. 当前能力边界

### 4.1 数据层已有入口

`src/main/data/data-task-store.ts` 已有核心方法：

| 能力 | 方法 |
| --- | --- |
| 创建数据任务 | `createTask` |
| 更新数据任务 | `updateTask` |
| 删除数据任务 | `deleteTask` |
| 运行数据任务 | `runTask` |
| 导入输入表 | `importDataset` |
| 更新输入表 | `updateDataset` |
| 删除输入表 | `deleteDataset` |
| 预览输入表或输出表 | `previewDataset` |
| 预览未保存输入表配置 | `previewInputTable` |
| 创建输出表 | `createOutputTable` |
| 更新输出表 | `updateOutputTable` |
| 获取工作流 | `getTaskWorkflow` |
| 保存工作流 | `saveTaskWorkflow` |

### 4.2 DSL 能力

`src/shared/prep-dsl` 提供：

- `parsePrepDsl`
- `compilePrepWorkflowToFlow`
- `parsePrepOperatorDsl`
- `exportPrepWorkflowDsl`
- `exportPrepOperatorDsl`

CLI 和 tool_call 应直接复用这些能力完成 DSL 校验、导入、导出和单算子配置。

### 4.3 Agent 工具基础

当前 agent runtime 已支持：

- MCP 工具桥接为 SDK `ToolDefinition`。
- 本地 custom tool 形态，例如 memory tools。
- 权限请求和 tool_call 进度事件。
- tool use/result UI 展示。

数据工具可以采用相同 custom tool 注册方式进入 agent，不必先实现为 MCP server。后续若要给外部 agent 使用，再补 MCP server。

---

## 5. 总体架构

### 5.1 新增模块

```text
src/main/data/
  data-command-service.ts
  data-command-types.ts
  data-cli-runtime.ts
  data-tool-service.ts
  data-tool-definitions.ts

src/cli/
  data-cli.ts

src/main/mcp/
  data-mcp-server.ts        # 可选二期
```

### 5.2 服务职责

#### DataCommandService

面向 UI IPC、CLI 和 tool_call 的统一业务门面。

职责：

- 参数校验和规范化。
- 将高层命令转换为 `DataTaskStore` 调用。
- 统一返回结构。
- 统一错误码。
- 统一 dry-run 和 validate 逻辑。
- 统一审计事件。

示意接口：

```ts
interface DataCommandService {
  listTasks(input: ListTasksInput): Promise<ListTasksResult>;
  createTask(input: CreateTaskCommand): Promise<TaskResult>;
  updateTask(input: UpdateTaskCommand): Promise<TaskResult>;
  deleteTask(input: DeleteTaskCommand): Promise<DeleteResult>;
  runTask(input: RunTaskCommand): Promise<RunTaskResult>;

  listInputTables(input: ListInputTablesInput): Promise<ListInputTablesResult>;
  createInputTable(input: CreateInputTableCommand): Promise<InputTableResult>;
  updateInputTable(input: UpdateInputTableCommand): Promise<InputTableResult>;
  deleteInputTable(input: DeleteInputTableCommand): Promise<DeleteResult>;
  previewInputTable(input: PreviewInputTableCommand): Promise<TablePreviewResult>;

  listOutputTables(input: ListOutputTablesInput): Promise<ListOutputTablesResult>;
  createOutputTable(input: CreateOutputTableCommand): Promise<OutputTableResult>;
  updateOutputTable(input: UpdateOutputTableCommand): Promise<OutputTableResult>;
  deleteOutputTable(input: DeleteOutputTableCommand): Promise<DeleteResult>;
  previewOutputTable(input: PreviewOutputTableCommand): Promise<TablePreviewResult>;

  getWorkflow(input: GetWorkflowCommand): Promise<WorkflowResult>;
  saveWorkflow(input: SaveWorkflowCommand): Promise<WorkflowResult>;
  importWorkflowDsl(input: ImportWorkflowDslCommand): Promise<WorkflowResult>;
  exportWorkflowDsl(input: ExportWorkflowDslCommand): Promise<TextResult>;
  updateOperatorDsl(input: UpdateOperatorDslCommand): Promise<WorkflowResult>;
  configureInputOperator(input: ConfigureInputOperatorCommand): Promise<WorkflowResult>;
  configureOutputOperator(input: ConfigureOutputOperatorCommand): Promise<WorkflowResult>;
}
```

#### DataCliRuntime

职责：

- 解析命令行参数。
- 解析 app 数据目录和工作区数据库路径。
- 创建 `DataTaskStore` 和 metadata DB 连接。
- 调用 `DataCommandService`。
- 格式化 stdout/stderr。
- 控制退出码。

#### DataToolService

职责：

- 把 agent tool 参数映射为 `DataCommandService` 命令。
- 加权限标签。
- 压缩返回内容，避免把大表数据塞进上下文。
- 对长任务提供进度事件。
- 对危险操作加确认策略。

---

## 6. CLI 设计

### 6.1 命令入口

建议提供一个主命令：

```bash
sophron data <resource> <action> [options]
```

也可提供别名：

```bash
sophron-data <resource> <action> [options]
```

打包后在 `package.json` 中声明 bin：

```json
{
  "bin": {
    "sophron-data": "dist/cli/data-cli.js"
  }
}
```

开发期可通过：

```bash
npm run data -- task list
```

### 6.2 通用参数

| 参数 | 说明 |
| --- | --- |
| `--json` | 输出 JSON |
| `--pretty` | JSON 缩进 |
| `--workspace <path>` | 指定工作区数据目录，默认使用应用 userData |
| `--cowork-db <path>` | 指定 SQLite 配置库 |
| `--duckdb <path>` | 指定 DuckDB 数据库 |
| `--yes` | 跳过删除、覆盖等确认 |
| `--dry-run` | 只校验和展示计划，不落库 |
| `--quiet` | 仅输出结果 id 或必要信息 |
| `--limit <n>` | 列表或预览条数 |
| `--offset <n>` | 分页偏移 |

### 6.3 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 通用失败 |
| `2` | 参数错误 |
| `3` | 校验失败 |
| `4` | 资源不存在 |
| `5` | 权限或路径访问失败 |
| `6` | 数据执行失败 |
| `7` | 并发锁失败 |

### 6.4 输出结构

所有 `--json` 输出统一为：

```json
{
  "ok": true,
  "command": "task.run",
  "result": {},
  "diagnostics": [],
  "meta": {
    "durationMs": 120,
    "workspace": "...",
    "timestamp": 1780000000000
  }
}
```

失败输出：

```json
{
  "ok": false,
  "command": "workflow.importDsl",
  "error": {
    "code": "DSL_PARSE_FAILED",
    "message": "DSL parse failed",
    "details": {}
  },
  "diagnostics": [
    {
      "code": "invalidQualifiedField",
      "message": "Invalid field reference [orders.customer_id]; use [orders].[customer_id]",
      "range": { "start": 42, "end": 62 }
    }
  ]
}
```

---

## 7. CLI 命令全集

### 7.1 数据任务

#### 列表

```bash
sophron data task list
sophron data task list --query "销售" --limit 20 --json
```

#### 创建

```bash
sophron data task create --name "销售数据清洗"
```

输出：

```json
{
  "task": {
    "id": "task_xxx",
    "name": "销售数据清洗",
    "status": "draft"
  }
}
```

#### 改名

```bash
sophron data task update --id task_xxx --name "销售数据清洗 v2"
```

#### 删除

```bash
sophron data task delete --id task_xxx --yes
```

#### 查看详情

```bash
sophron data task show --id task_xxx --json
```

返回：

- 任务元信息。
- workflow 节点和边。
- 最近运行状态。
- 关联输出表。

#### 运行

```bash
sophron data task run --id task_xxx
sophron data task run --id task_xxx --mode persisted --json
sophron data task run --id task_xxx --mode temporary --dsl-file ./draft.prep --json
```

参数：

| 参数 | 说明 |
| --- | --- |
| `--mode persisted` | 使用保存的 workflow，写正式输出表 |
| `--mode temporary` | 使用传入 workflow 或保存 workflow，写临时表 |
| `--dsl <text>` | 临时 DSL |
| `--dsl-file <path>` | 临时 DSL 文件 |
| `--wait` | 等待运行完成，MVP 默认等待 |
| `--preview <n>` | 运行后返回前 n 行 |

### 7.2 输入表

#### 列表

```bash
sophron data input list
sophron data input list --source excel --json
```

#### 新增 Excel 输入表

```bash
sophron data input create \
  --name "ABC分析数据" \
  --kind excel \
  --file ./ABC分析数据.xlsx \
  --sheet Sheet1 \
  --header smart
```

#### 新增 CSV 输入表

```bash
sophron data input create \
  --name "客户信息表" \
  --kind csv \
  --file ./客户信息表.csv
```

#### 新增文件夹输入表

```bash
sophron data input create \
  --name "市场调研原始数据" \
  --kind folder \
  --folder ./market \
  --file-range excel_csv \
  --merge append \
  --schema align_by_name \
  --skip-empty \
  --keep-source-file-name
```

#### 更新配置

```bash
sophron data input update \
  --id dataset_xxx \
  --name "客户信息表 2026" \
  --kind csv \
  --file ./customers_2026.csv
```

#### 预览

```bash
sophron data input preview --id dataset_xxx --limit 100 --offset 0 --json
```

#### 删除

```bash
sophron data input delete --id dataset_xxx --yes
```

### 7.3 输出表

#### 列表

```bash
sophron data output list --json
```

#### 新增

```bash
sophron data output create --name "销售清洗结果"
```

#### 绑定输入表

```bash
sophron data output update \
  --id output_xxx \
  --name "客户明细输出" \
  --source-input dataset_xxx
```

#### 预览

```bash
sophron data output preview --id output_xxx --limit 100
```

#### 删除

```bash
sophron data output delete --id output_xxx --yes
```

### 7.4 工作流

#### 查看工作流

```bash
sophron data workflow show --task task_xxx --json
```

#### 导出 DSL

```bash
sophron data workflow export-dsl --task task_xxx
```

#### 导入 DSL 并保存

```bash
sophron data workflow import-dsl --task task_xxx --file ./workflow.prep
```

#### 校验 DSL

```bash
sophron data workflow validate-dsl --file ./workflow.prep --json
```

### 7.5 算子节点

#### 列出节点

```bash
sophron data node list --task task_xxx
```

#### 新增算子

```bash
sophron data node add --task task_xxx --type filter --label "筛选有效订单"
```

#### 删除算子

```bash
sophron data node delete --task task_xxx --node node_xxx --yes
```

#### 重命名算子

```bash
sophron data node update --task task_xxx --node node_xxx --label "筛选订单"
```

#### 配置输入算子

输入算子只允许选择输入表：

```bash
sophron data node input-config \
  --task task_xxx \
  --node node_input \
  --input-table dataset_xxx
```

保存后的节点配置：

```json
{
  "source": "dataset",
  "datasetId": "dataset_xxx",
  "inputTableName": "客户信息表",
  "name": "客户信息表"
}
```

#### 配置输出算子

自动输出表：

```bash
sophron data node output-config \
  --task task_xxx \
  --node node_output \
  --strategy auto \
  --name "销售清洗结果"
```

输出到已有表：

```bash
sophron data node output-config \
  --task task_xxx \
  --node node_output \
  --strategy existing \
  --output-table output_xxx
```

#### 配置 DSL 算子

```bash
sophron data node set-dsl \
  --task task_xxx \
  --node node_filter \
  --dsl 'filter [revenue] > 0'
```

或：

```bash
sophron data node set-dsl --task task_xxx --node node_agg --file ./aggregate.prep
```

CLI 必须校验：

- DSL 语法正确。
- 单节点 DSL 的算子类型与节点类型匹配。
- 解析后的 `operator.config` 写回节点配置。
- 保留 `config.dsl`。

#### 连接算子

```bash
sophron data edge add \
  --task task_xxx \
  --from node_input \
  --to node_filter \
  --from-handle output \
  --to-handle input
```

Join 连接：

```bash
sophron data edge add --task task_xxx --from node_orders --to node_join --to-handle left
sophron data edge add --task task_xxx --from node_customers --to node_join --to-handle right
```

删除连接：

```bash
sophron data edge delete --task task_xxx --edge edge_xxx --yes
```

---

## 8. Tool Call 设计

### 8.1 工具注册方式

MVP 不新增一套孤立的工具调用通道，而是接入当前应用已经存在的 Agent/LLM custom tools 体系。

当前应用内已经存在三类 LLM 工具来源：

1. 内置 coding tools：由 agent runner 创建，负责文件、命令、搜索等基础能力。
2. MCP tools：由 `buildMcpCustomTools(mcpManager)` 桥接到 SDK `ToolDefinition`。
3. extension custom tools：由 `AgentRuntimeExtensionManager.beforeSessionRun(...)` 汇总，每个运行时扩展可以返回 `promptPrefix` 和 `customTools`。

数据模块推荐作为 `AgentRuntimeExtension` 注册，和现有 extension custom tools 合流。这样有几个好处：

- 不需要改造 Agent 主循环；agent runner 已经会把 MCP tools 和 extension custom tools 合并后交给 LLM。
- 可以复用现有 tool trace、远程工具进度、权限确认和工具结果展示链路。
- 数据工具可以通过 `promptPrefix` 给当前会话补充路由规则，让 LLM 仅在固定/可复用数据处理流程中使用 `data_*` 工具；一次性探索分析不自动创建或运行数据任务。
- 未来如果需要开放给外部 agent，再把同一组 `DataToolService` 包装成 MCP server。

接入点：

```text
src/main/extensions/agent-runtime-extension-manager.ts
  DataAgentRuntimeExtension.beforeSessionRun(...)

src/main/claude/agent-runner.ts
  customTools = [...mcpCustomTools, ...extensionCustomTools]
```

后续外部 agent 需要时，再把同一组工具包装为：

```text
src/main/mcp/data-mcp-server.ts
```

### 8.2 与现有 LLM 工具调用体系集成

#### 8.2.1 运行时结构

```mermaid
flowchart LR
  User["用户对话"] --> AgentRunner["Agent Runner"]
  AgentRunner --> ExtensionManager["AgentRuntimeExtensionManager"]
  ExtensionManager --> DataExtension["DataAgentRuntimeExtension"]
  DataExtension --> DataTools["data_* ToolDefinition"]
  DataTools --> DataToolService["DataToolService"]
  DataToolService --> CommandService["DataCommandService"]
  CommandService --> Sqlite["cowork.db 配置库"]
  CommandService --> Duckdb["DuckDB 物理数据表"]
  AgentRunner --> ToolTrace["tool_call trace / progress"]
  ToolTrace --> ToolUi["ToolUseBlock 展示"]
```

新增组件：

```text
src/main/data/data-tool-service.ts
src/main/data/data-agent-extension.ts
src/main/data/data-tool-prompt.ts
src/main/data/data-tool-types.ts
```

`DataToolService` 只封装对话工具能力，不直接越过 `DataCommandService` 访问存储。所有 UI、CLI、tool_call 最终都走同一套命令服务，保证行为一致。

#### 8.2.2 AgentRuntimeExtension 注册

数据扩展实现当前扩展体系已有的 `beforeSessionRun` 入口：

```ts
export function createDataAgentRuntimeExtension(
  dataToolService: DataToolService,
): AgentRuntimeExtension {
  return {
    name: 'data-tools',
    async beforeSessionRun(context) {
      return {
        promptPrefix: buildDataToolPrompt(context),
        customTools: createDataCustomTools(dataToolService, context),
      };
    },
  };
}
```

注册位置应和已有运行时扩展保持一致，在 agent runtime 初始化时注入：

```ts
agentRuntimeExtensionManager.register(
  createDataAgentRuntimeExtension(dataToolService),
);
```

注意：

- 工具名必须使用稳定的 `data_*` 前缀，避免和 MCP 工具、内置工具重名。当前扩展管理器会按工具名去重，重名会导致后注册工具被忽略。
- 工具 `parameters` 使用 TypeBox 描述，和现有 memory tools、MCP bridge 的风格一致。
- 工具 `execute(...)` 返回 SDK custom tool 标准结果：`content: [{ type: 'text', text }]`，并可在 `details` 中放机器可读数据，供 UI 后续增强展示。

示例：

```ts
const dataPreviewTableTool: AgentRuntimeCustomTool = {
  name: 'data_preview_table',
  label: 'Data -> preview table',
  description: 'Preview rows from a configured input table, output table, or temporary run result.',
  parameters: Type.Object({
    tableKind: Type.Union([
      Type.Literal('input'),
      Type.Literal('output'),
      Type.Literal('temporary'),
    ]),
    id: Type.String(),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    offset: Type.Optional(Type.Number({ minimum: 0 })),
  }),
  async execute(toolCallId, params, signal, onUpdate, context) {
    return dataToolService.previewTable({
      actor: createToolActor(context),
      toolCallId,
      params,
      signal,
      onUpdate,
    });
  },
};
```

#### 8.2.3 对话上下文绑定

数据工具需要从 Agent 会话中拿到当前工作区和可选的数据上下文：

```ts
interface DataConversationContext {
  workspaceId: string;
  conversationId: string;
  selectedDataTaskId?: string;
  selectedInputTableId?: string;
  selectedOutputTableId?: string;
}
```

工具调用规则：

- LLM 可以显式传入 `taskId`、`inputTableId`、`outputTableId`。
- 当用户在数据任务编辑页或输入/输出表编辑页发起对话时，可以由 `DataConversationContext` 提供当前选中对象，工具允许传 `current: true` 使用当前对象。
- 如果用户只给了自然语言表名，LLM 必须先调用 `data_list_input_tables` 或 `data_list_output_tables` 做候选解析，不能直接猜测表 ID。
- 如果候选超过一个，工具返回 `AMBIGUOUS_DATA_RESOURCE`，由 LLM 追问用户或展示候选。
- 对需要沉淀为固定/可复用流程的复杂数据处理，LLM 应构造数据任务 DSL 并调用 `data_run_task` 临时试算。对一次性探索分析，不应自动创建任务或运行工作流，应先询问用户是否要保存为可复用数据任务。

#### 8.2.4 Prompt Prefix、工具调用文档与工具路由

`DataAgentRuntimeExtension` 需要追加一段短 prompt，让 LLM 知道什么时候调用数据工具，以及如何正确创建输入表、输出表和数据任务。

详细注入内容、动态上下文结构、工具调用配方和裁剪策略见：

```text
design/toolcall/data-tool-context-injection-design.md
```

最小注入语义如下：

```text
Use data_* workflow tools only when the user asks to create, manage, save, run, or modify a fixed reusable data-processing workflow.
Do not automatically create a data task or run a workflow for one-off exploration, casual analysis, or simple questions.

Before referencing a table by name in a fixed workflow, list matching input/output tables and use the returned IDs.
Do not load entire tables into the chat. Use previews, schema, metadata, and temporary task runs.
For creating input tables, use data_create_input_table only with user-selected or explicitly authorized local files/folders.
For creating reusable output targets, use data_create_output_table before binding output operators.
For creating data tasks, use data_create_task, validate workflow DSL with dryRun, then save only after confirmation.
Within a fixed workflow, run in temporary mode first. Persist workflow or output tables only when the user asks or confirms.
For write, delete, persisted run, file import, or output overwrite operations, request permission through the normal tool permission flow.
```

这段 prompt 只描述工具使用策略、核心调用顺序和当前数据上下文，不包含完整业务表内容。具体表、任务、字段都通过工具实时读取，避免 prompt 过大或过期。

#### 8.2.5 权限、Trace 和远程协作

数据工具复用当前工具权限与 trace 链路：

- `read` 工具：`data_list_*`、`data_preview_table`、`data_get_task_workflow`、`data_export_workflow_dsl`。可进入只读自动批准名单，但仍要限制返回行数和字段数。
- `write_config` 工具：创建/修改输入表、输出表、任务、节点、边、DSL。需要用户确认或会话级授权。
- `execute` 工具：`data_run_task`。临时运行可降低风险，但仍应展示将读取的输入表和预计输出目标。
- `destructive` 工具：删除配置、覆盖正式输出表、替换物理表。必须明确确认。
- `file_access` 工具：导入本地文件或文件夹。必须走路径权限校验，不允许读取未授权路径。

`data_run_task` 和文件夹导入可能耗时较长，需要使用 custom tool 的 `onUpdate` 输出阶段性进度：

```text
validating workflow -> reading inputs -> executing operators -> writing output -> preparing preview
```

agent runner 已经会把 `tool_call` trace 发送到渲染层和远程协作通道，数据工具只需要提供稳定的 `toolName`、`toolCallId`、`label` 和进度文本。

#### 8.2.6 工具结果展示

现有 `ToolUseBlock` 已能展示通用工具调用结果。为了让数据工具在对话中更易读，需要补充轻量 UI 映射：

```text
src/renderer/components/message/toolHelpers.tsx
  getToolIcon(name)
  getToolLabel(name, input, displayName)
```

建议：

- `data_*` 前缀默认使用数据表/数据库类图标。
- `data_preview_table` 显示为 `预览表：<表名或 ID>`。
- `data_run_task` 显示为 `执行数据任务：<任务名或 ID>`。
- `data_apply_operator_dsl` 显示为 `更新算子 DSL：<节点名或 ID>`。
- 工具结果正文使用紧凑 Markdown，最多展示 20 行预览。
- `details` 中保留结构化结果，后续可以扩展为真正的表格预览卡片。

工具返回格式建议：

```json
{
  "content": [
    {
      "type": "text",
      "text": "已预览输入表「客户信息表」，显示 20/2468 行。"
    }
  ],
  "details": {
    "kind": "data.preview",
    "tableKind": "input",
    "id": "dataset_xxx",
    "columns": ["customer_id", "region"],
    "rows": []
  }
}
```

#### 8.2.7 对话中的准确性约束

为了让智能会话能准确处理复杂数据，LLM 使用数据工具时必须遵守：

1. 固定流程才使用：只有用户表达创建/保存/运行/修改固定数据处理流程、输出表或数据任务时，才使用工作流写入和执行工具。
2. 先发现，再处理：固定流程涉及表名、字段、任务名时，先通过 list/show/schema/preview 工具确认真实对象。
3. 样本不是全量：预览数据只能用于理解结构和少量样例；固定流程中的统计、聚合、连接、去重交给数据任务执行引擎完成。
4. 固定流程内临时优先：先 dry-run 或 `temporary` 运行；用户确认保存后，才写入正式任务和输出表。
5. 不隐式覆盖：任何正式输出表覆盖、删除、替换物理表都要明确说明影响范围并请求确认。
6. 结果可追溯：每次 tool_call 写配置或执行任务，都记录 actor、输入参数、任务 ID、输出表 ID、运行 ID 和时间。

### 8.3 工具命名

工具名应稳定、短、语义明确：

```text
data_list_input_tables
data_create_input_table
data_update_input_table
data_preview_table
data_list_tasks
data_create_task
data_update_task
data_get_task_workflow
data_apply_workflow_dsl
data_export_workflow_dsl
data_configure_input_operator
data_apply_operator_dsl
data_configure_output_operator
data_run_task
data_get_run_result
data_list_output_tables
data_create_output_table
data_update_output_table
```

### 8.4 工具权限分级

| 等级 | 工具 | 默认策略 |
| --- | --- | --- |
| read | list、show、preview、export DSL、validate DSL | 可自动批准 |
| write_config | create/update/delete、save workflow、apply DSL、create input/output/task | 需要用户确认或会话授权 |
| execute | run task、execute temp DSL | 需要用户确认，临时运行可降低风险 |
| destructive | delete、overwrite output、replace physical table | 必须确认 |
| file_access | import local file/folder | 必须确认路径权限 |

### 8.5 核心工具定义

#### data_list_input_tables

用途：让 LLM 知道当前有哪些输入表可用于输入算子。

输入：

```json
{
  "query": "客户",
  "sourceKind": "all",
  "limit": 20
}
```

输出：

```json
{
  "inputTables": [
    {
      "id": "dataset_xxx",
      "name": "客户信息表",
      "sourceKind": "csv",
      "rowCount": 2468,
      "columnCount": 18
    }
  ]
}
```

#### data_create_input_table

用途：在对话中基于用户选择或明确授权的本地文件/文件夹创建输入表。

输入：

CSV 文件：

```json
{
  "name": "销售明细",
  "sourceKind": "csv",
  "filePath": "/authorized/path/sales.csv",
  "config": {
    "delimiter": ",",
    "encoding": "utf8",
    "header": true
  },
  "previewRows": 20
}
```

Excel 文件：

```json
{
  "name": "客户信息表",
  "sourceKind": "excel",
  "filePath": "/authorized/path/customers.xlsx",
  "config": {
    "sheetName": "Sheet1",
    "headerMode": "auto"
  },
  "previewRows": 20
}
```

文件夹：

```json
{
  "name": "订单文件夹",
  "sourceKind": "folder",
  "folderPath": "/authorized/path/orders",
  "config": {
    "recursive": false,
    "filePattern": "*.csv"
  },
  "previewRows": 20
}
```

行为：

1. 校验 `sourceKind` 和来源配置。
2. 校验文件或文件夹路径权限，未授权时返回 `FILE_ACCESS_DENIED`。
3. 调用 `DataCommandService.createInputTable`，最终复用 `DataTaskStore.importDataset`。
4. 返回输入表 ID、名称、来源类型、行列数和受限预览。
5. 同名输入表不静默覆盖；返回冲突错误或候选，由 LLM 询问用户。

输出：

```json
{
  "inputTable": {
    "id": "dataset_xxx",
    "name": "销售明细",
    "sourceKind": "csv",
    "rowCount": 2468,
    "columnCount": 18
  },
  "preview": {
    "columns": ["order_id", "region", "gmv"],
    "rows": []
  }
}
```

权限：

- 该工具同时属于 `write_config` 和 `file_access`。
- 必须使用用户已选择、已授权或在当前请求中明确给出的路径。
- 不允许 LLM 自行猜测或遍历本机路径。

#### data_update_input_table

用途：在对话中修改已有输入表名称或来源配置。

输入：

```json
{
  "id": "dataset_xxx",
  "name": "销售明细 v2",
  "config": {
    "headerMode": "manual",
    "headerRow": 2
  },
  "previewRows": 20
}
```

行为：

- 只能更新已存在输入表。
- 若修改文件/文件夹路径，必须重新做路径权限确认。
- 更新后返回新的输入表摘要和受限预览。

#### data_preview_table

用途：预览输入表或输出表数据。

输入：

```json
{
  "tableKind": "input",
  "id": "dataset_xxx",
  "limit": 20,
  "offset": 0
}
```

输出必须限制行数，默认最多 20 行，绝不返回整表。

#### data_create_output_table

用途：在对话中创建输出表，供输出算子绑定或后续任务复用。

输入：

```json
{
  "name": "地区 GMV 汇总",
  "sourceInputTableId": "dataset_xxx"
}
```

也允许先创建空的输出目标配置：

```json
{
  "name": "地区 GMV 汇总"
}
```

行为：

1. 校验名称。
2. 如果指定 `sourceInputTableId`，校验输入表存在。
3. 调用 `DataCommandService.createOutputTable`，最终复用 `DataTaskStore.createOutputTable`。
4. 同名输出表不静默覆盖；返回冲突错误或候选，由 LLM 询问是否复用。

输出：

```json
{
  "outputTable": {
    "id": "output_xxx",
    "name": "地区 GMV 汇总",
    "sourceInputTableId": "dataset_xxx",
    "rowCount": 0,
    "columnCount": 0
  }
}
```

#### data_update_output_table

用途：在对话中修改输出表名称或来源输入表配置。

输入：

```json
{
  "id": "output_xxx",
  "name": "地区 GMV 汇总 v2",
  "sourceInputTableId": "dataset_xxx"
}
```

行为：

- 只能更新已存在输出表。
- 不直接覆盖输出表物理数据；覆盖数据只能通过明确的任务运行和输出策略完成。

#### data_create_task

输入：

```json
{
  "name": "销售数据清洗"
}
```

输出：

```json
{
  "task": {
    "id": "task_xxx",
    "name": "销售数据清洗",
    "status": "draft"
  }
}
```

#### data_apply_workflow_dsl

用途：用任务级 DSL 创建或替换数据任务工作流。

输入：

```json
{
  "taskId": "task_xxx",
  "dsl": "input source dataset \"customers\" as customers\nfrom customers\n  | output table \"customers_out\" mode replace",
  "mode": "replace",
  "dryRun": false
}
```

行为：

1. 调用 `parsePrepDsl`。
2. 调用 `compilePrepWorkflowToFlow`。
3. 若 `dryRun=true`，只返回节点、边和诊断。
4. 若 `dryRun=false`，调用 `saveTaskWorkflow`。

#### data_configure_input_operator

用途：配置输入算子，只允许选择输入表。

输入：

```json
{
  "taskId": "task_xxx",
  "nodeId": "node_input",
  "inputTableId": "dataset_xxx"
}
```

输出：

```json
{
  "node": {
    "id": "node_input",
    "type": "input_source",
    "config": {
      "source": "dataset",
      "datasetId": "dataset_xxx",
      "inputTableName": "客户信息表"
    }
  }
}
```

#### data_apply_operator_dsl

用途：修改单个非输入/输出算子。

输入：

```json
{
  "taskId": "task_xxx",
  "nodeId": "node_filter",
  "dsl": "filter [revenue] > 0"
}
```

行为：

- 读取节点类型。
- 调用 `parsePrepOperatorDsl(dsl, node.type)`。
- 类型不匹配时返回 `OPERATOR_TYPE_MISMATCH`。
- 保存解析后的 `config`。

#### data_configure_output_operator

输入：

```json
{
  "taskId": "task_xxx",
  "nodeId": "node_output",
  "strategy": "existing",
  "outputTableId": "output_xxx"
}
```

或：

```json
{
  "taskId": "task_xxx",
  "nodeId": "node_output",
  "strategy": "auto",
  "outputTableName": "销售清洗结果"
}
```

#### data_run_task

用途：运行数据任务。

输入：

```json
{
  "taskId": "task_xxx",
  "mode": "persisted",
  "previewRows": 20
}
```

临时运行：

```json
{
  "taskId": "task_xxx",
  "mode": "temporary",
  "workflowDsl": "input source dataset \"customers\" as customers\nfrom customers\n  | filter [region] = \"华东\"\n  | output table \"tmp\" mode replace",
  "previewRows": 20
}
```

输出：

```json
{
  "task": {
    "id": "task_xxx",
    "status": "completed",
    "outputTable": "output_abcd",
    "rowCount": 120,
    "columnCount": 8
  },
  "preview": {
    "columns": ["order_id", "region"],
    "rows": []
  }
}
```

---

## 9. LLM 数据处理工作流示例

### 9.1 从本地文件创建输入表、任务和输出表

用户输入：

```text
把我选择的 sales.csv 建成输入表“销售明细”，按地区汇总 GMV，输出到“地区 GMV 汇总”。
```

推荐 tool_call 流程：

1. LLM 确认文件路径来自用户选择或当前请求授权。
2. 调用 `data_create_input_table` 创建输入表并返回预览。
3. 调用 `data_create_output_table` 创建输出表。
4. 调用 `data_create_task` 创建数据任务。
5. 调用 `data_apply_workflow_dsl`，用输入表和输出表生成工作流。
6. 调用 `data_run_task`，`mode=persisted`。
7. 调用 `data_preview_table` 预览输出表。

关键约束：

- 创建输入表前必须确认文件/文件夹路径权限。
- 同名输入表或输出表不能静默覆盖，必须让用户选择复用、改名或取消。
- 输出表创建只创建配置；正式数据写入发生在 `data_run_task` 中。

### 9.2 从已有输入表创建任务并运行

1. LLM 调用 `data_list_input_tables` 查找输入表。
2. 调用 `data_create_task` 创建任务。
3. 调用 `data_apply_workflow_dsl` 保存工作流：

```text
input source dataset "销售明细" as sales

from sales
  | cast [revenue] as double on_error null
  | filter [revenue] > 0
  | output table "销售清洗结果" mode replace
```

4. 调用 `data_run_task`，`mode=persisted`。
5. 调用 `data_preview_table` 预览输出表。

### 9.3 临时试算不污染正式输出

1. LLM 读取已有任务 DSL：`data_export_workflow_dsl`。
2. 修改筛选条件。
3. 调用 `data_run_task`，`mode=temporary`，传入 `workflowDsl`。
4. 返回临时表预览。
5. 用户确认后，LLM 再调用 `data_apply_workflow_dsl` 保存。

### 9.4 在会话中准确处理复杂数据问题

用户输入：

```text
帮我看一下销售明细，按地区和月份汇总 GMV，过滤掉退款订单，再输出一张可复用的结果表。
```

推荐 tool_call 流程：

1. 调用 `data_list_input_tables`，用 `query="销售"` 找到候选输入表。
2. 调用 `data_preview_table` 预览小样本，确认字段名、日期字段和退款标记字段。
3. 调用 `data_create_task` 创建数据任务。
4. 调用 `data_apply_workflow_dsl`，先写入包含 `filter`、`derive`、`aggregate`、`output` 的工作流 DSL，`dryRun=true` 验证结构。
5. 调用 `data_run_task`，`mode=temporary` 做临时试算。
6. 调用 `data_preview_table` 预览临时结果，只把摘要和少量样本返回对话。
7. 用户确认后，调用 `data_apply_workflow_dsl` 保存正式工作流，再调用 `data_run_task`，`mode=persisted` 写入正式输出表。

关键约束：

- 不把 Excel/CSV 全量内容读进对话上下文。
- 不用 LLM 自己推断全量统计结果。
- 所有聚合、连接、去重和类型转换都交给数据任务执行引擎。
- 生成正式输出表前，必须让用户知道输出表名称和覆盖策略。

### 9.5 对已有数据任务做会话内修改

用户输入：

```text
把当前任务里的筛选规则改成只保留华东和华南，并先给我看结果。
```

推荐 tool_call 流程：

1. 如果会话上下文存在 `selectedDataTaskId`，调用 `data_get_task_workflow` 读取当前任务；否则先调用 `data_list_tasks` 让用户选择。
2. 找到 `filter` 节点后，调用 `data_apply_operator_dsl` 的 `dryRun` 或校验模式验证：

```text
filter [region] in ("华东", "华南")
```

3. 调用 `data_run_task`，`mode=temporary`，返回临时预览。
4. 用户确认后，再调用 `data_apply_operator_dsl` 持久化节点 DSL。

如果存在多个筛选节点，工具应返回候选节点列表，LLM 需要向用户确认修改哪个节点。

---

## 10. 统一错误码

| 错误码 | 场景 |
| --- | --- |
| `INVALID_ARGUMENT` | CLI 或 tool 参数缺失、格式错误 |
| `RESOURCE_NOT_FOUND` | task/input/output/node/edge 不存在 |
| `RESOURCE_ALREADY_EXISTS` | 创建输入表、输出表或任务时名称冲突，不能静默覆盖 |
| `VALIDATION_FAILED` | 数据配置校验失败 |
| `DSL_PARSE_FAILED` | DSL 解析失败 |
| `OPERATOR_TYPE_MISMATCH` | 单算子 DSL 类型和节点类型不一致 |
| `AMBIGUOUS_DATA_RESOURCE` | 通过名称匹配到多个任务、输入表、输出表或节点，需要用户确认 |
| `FILE_ACCESS_DENIED` | 文件或文件夹路径无权限 |
| `UNSUPPORTED_SOURCE_KIND` | 不支持的输入表来源类型 |
| `WORKFLOW_INVALID` | 工作流缺少输入、输出、连线或存在循环 |
| `TASK_RUN_FAILED` | DuckDB 执行失败 |
| `PERMISSION_REQUIRED` | tool_call 需要用户确认 |
| `LOCK_TIMEOUT` | 数据库锁等待超时 |

---

## 11. 并发与锁

CLI 和 Electron app 可能同时访问 `cowork.db` 和 DuckDB。

建议：

- SQLite 使用 WAL。
- 写操作进入 `DataCommandService` 的进程内串行队列。
- CLI 直接模式使用 advisory lock 文件：

```text
<userData>/data/.data-command.lock
```

- 锁超时时返回 `LOCK_TIMEOUT`。
- DuckDB 运行任务时，同一个任务 id 串行执行。
- 不同任务并发执行可作为后续优化，MVP 先全局串行。

---

## 12. 安全与权限

### 12.1 CLI

CLI 是本机用户主动执行，可默认允许读写应用数据。但以下操作仍应提示或要求 `--yes`：

- 删除输入表、输出表、数据任务。
- 覆盖输出表。
- 导入本地文件或文件夹。
- 运行会覆盖正式输出表的数据任务。

### 12.2 Tool Call

tool_call 必须比 CLI 更严格：

- 读操作可默认允许。
- 写配置操作需用户确认，或会话已授权。
- 运行任务需用户确认。
- 导入本地文件或文件夹必须经过文件权限确认。
- 删除操作必须确认。
- 工具返回不得包含任意本机绝对路径，除非用户明确请求或路径来自用户选择。

### 12.3 审计日志

建议新增表：

```sql
CREATE TABLE data_command_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,       -- ui | cli | tool
  actor_id TEXT,
  command TEXT NOT NULL,
  input_json TEXT,
  result_json TEXT,
  status TEXT NOT NULL,           -- success | failed
  error_code TEXT,
  created_at INTEGER NOT NULL
);
```

---

## 13. 实施计划

### Phase 1：服务层抽取

- 新增 `DataCommandService`。
- 将现有 IPC 中直接调用 `DataTaskStore` 的逻辑逐步迁移到服务层。
- 保持现有 UI 行为不变。
- 增加单元测试覆盖服务层。

验收：

- UI 数据页面所有现有测试通过。
- 服务层能完成任务创建、输入表导入、输出表创建、工作流保存、任务运行。

### Phase 2：CLI MVP

- 新增 `src/cli/data-cli.ts`。
- 支持 `task list/create/update/delete/show/run`。
- 支持 `input list/create/update/delete/preview`。
- 支持 `output list/create/update/delete/preview`。
- 支持 `--json` 和稳定退出码。

验收：

- 使用临时 workspace 运行 CLI 集成测试。
- CLI 可以完整完成：创建输入表 -> 创建任务 -> 导入 DSL -> 运行 -> 预览输出。

### Phase 3：工作流和算子 CLI

- 支持 `workflow import-dsl/export-dsl/validate-dsl`。
- 支持 `node input-config/output-config/set-dsl/add/delete/update`。
- 支持 `edge add/delete`。

验收：

- CLI 可以完成当前数据任务画布中的所有算子配置。
- 单算子 DSL 类型不匹配能正确失败。

### Phase 4：Tool Call MVP

- 新增 `DataToolService`。
- 新增 `DataAgentRuntimeExtension`，通过现有 `AgentRuntimeExtensionManager` 注册数据 custom tools。
- 新增 `buildDataToolPrompt(...)`，把数据工具路由规则注入当前对话 prompt。
- `buildDataToolPrompt(...)` 必须遵循 `design/toolcall/data-tool-context-injection-design.md`，注入创建输入表、输出表和数据任务的工具调用文档。
- 使用 TypeBox 定义 `data_*` 工具 schema，保持和现有 custom tools 一致。
- 接入现有 tool trace、远程工具进度和权限确认链路。
- 在 `toolHelpers.tsx` 中补充 `data_*` 图标和展示标题。
- 加工具返回摘要、结构化 `details` 和预览行数限制。
- 支持通过 tool_call 创建输入表、输出表和数据任务；输入表文件/文件夹导入必须走路径权限确认。

验收：

- LLM 可以通过 tool_call 列出输入表、创建输入表、创建输出表、创建任务、保存 DSL、运行任务、预览输出。
- LLM 只在固定/可复用数据处理流程中使用 `data_*` 工具；一次性探索分析不会自动创建或运行数据任务。
- 工具调用在对话中显示为数据相关标题，并能看到运行进度。
- 写操作、文件导入和运行操作能触发权限确认。

### Phase 5：数据处理增强

- 支持临时 DSL 试算。
- 支持节点级预览：执行到指定节点并返回临时预览。
- 支持运行日志和节点统计。
- 支持取消长任务。

验收：

- LLM 可以先临时试算，再将用户确认后的方案保存为正式任务。

### Phase 6：MCP server 可选输出

- 将 `DataToolService` 包装为 MCP server。
- 支持外部 agent 连接本地数据能力。
- 默认关闭，需要用户在设置中启用。

---

## 14. 测试计划

### 14.1 单元测试

- `DataCommandService` 参数校验。
- CLI 参数解析。
- tool schema 校验。
- DSL 导入、导出、单节点配置。

### 14.2 集成测试

- CLI 使用临时 SQLite/DuckDB 路径完整跑通。
- 输入表 Excel/CSV/文件夹导入。
- 输出表创建和预览。
- 工作流运行写正式表。
- 临时运行不污染正式输出表。

### 14.3 Agent Tool 测试

- `DataAgentRuntimeExtension.beforeSessionRun` 能返回 promptPrefix 和完整 `data_*` tools。
- agent runner 合并 MCP tools 和 extension custom tools 后，数据工具不会和已有工具重名。
- 调用 `data_list_input_tables`。
- 调用 `data_create_input_table` 创建 CSV/Excel/文件夹输入表，未授权路径返回 `FILE_ACCESS_DENIED`。
- 调用 `data_create_output_table` 创建输出表，同名时返回冲突或候选。
- 调用 `data_create_task` 创建数据任务。
- 调用 `data_apply_operator_dsl` 修改 filter。
- 调用 `data_run_task` 临时运行并返回 preview。
- `data_preview_table` 默认不超过 20 行，最大不超过 100 行。
- 名称匹配多个表时返回 `AMBIGUOUS_DATA_RESOURCE`。
- 权限拒绝时工具返回 `PERMISSION_REQUIRED` 或用户拒绝错误。
- `toolHelpers.tsx` 能为 `data_*` 工具返回正确图标和标题。

### 14.4 回归测试

建议命令：

```bash
npm run typecheck
npx eslint src/main/data src/cli src/main/claude src/main/mcp tests
npx vitest run tests/data-duckdb-store.test.ts tests/prep-dsl/parser-compiler.test.ts
```

---

## 15. 示例端到端脚本

```bash
sophron data input create \
  --name "销售明细" \
  --kind csv \
  --file ./sales.csv \
  --json

sophron data task create --name "销售清洗" --json

sophron data workflow import-dsl \
  --task task_xxx \
  --file ./sales-clean.prep \
  --json

sophron data task run --id task_xxx --mode persisted --preview 20 --json
```

`sales-clean.prep`：

```text
input source dataset "销售明细" as sales

from sales
  | cast [revenue] as double on_error null
  | filter [revenue] > 0
  | output table "销售清洗结果" mode replace
```

---

## 16. 开放问题

1. CLI 默认 workspace 是否使用 app 的默认 userData，还是要求显式指定。
2. tool_call 的文件导入只允许用户选择或明确授权的路径；仍需细化授权来源如何从 UI/会话传入工具。
3. 外部 MCP server 是否进入首期，还是等 custom tools 稳定后再做。
4. 运行任务是否需要后台任务队列和取消按钮作为首期能力。
5. CLI 是否需要支持批量命令文件，例如 `sophron data apply plan.json`。

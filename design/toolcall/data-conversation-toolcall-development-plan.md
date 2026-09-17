# 对话中调用数据处理能力开发计划 v0.1

## 1. 目标

基于 `design/toolcall/data-cli-and-toolcall-design.md`，优先落地“用户在和九思助理对话时，可以安全、准确地调用本地数据处理能力”的主链路。

本计划聚焦对话内 tool call 能力，不把 CLI 作为首要交付物。CLI 仍作为统一命令服务的验证入口和后续自动化入口，但对话体验优先。

目标效果：

- 用户可以在普通会话中把固定、可复用的数据处理流程沉淀为输入表、数据任务和输出表。
- 用户可以在对话中创建数据任务、创建输入表、创建输出表，并继续配置和运行。
- LLM 通过 `data_*` custom tools 调用数据模块，不直接读取 SQLite、DuckDB 或文件系统。
- LLM 能先发现真实输入表、输出表、任务和字段，再生成 DSL 或配置任务。
- 一次性探索分析不自动创建数据任务；只有用户表达固定流程意图时，才使用数据处理工具。
- 持久化任务、覆盖输出、删除、导入文件等操作必须走权限确认。
- 对话里展示紧凑、可读的数据工具调用记录和结果摘要。

非目标：

- 不新增通用 SQL 对话工具。
- 不开放任意本地文件读取。
- 不在本轮实现外部 MCP server。
- 不把完整表数据塞进上下文。
- 不替代数据页面 UI，只让对话能复用同一套数据能力。

---

## 2. 当前基础

已有能力：

| 模块           | 可复用基础                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------- |
| 数据存储与执行 | `src/main/data/data-task-store.ts` 已支持任务、输入表、输出表、工作流保存、运行和预览       |
| DSL            | `src/shared/prep-dsl` 已支持任务级和单算子 DSL 解析、编译、导出、校验                       |
| Agent 扩展     | `AgentRuntimeExtensionManager.beforeSessionRun(...)` 可注入 `promptPrefix` 和 `customTools` |
| Tool 合并      | `src/main/agent/agent-runner.ts` 已合并 MCP tools 和 extension custom tools                 |
| 工具展示       | `src/renderer/components/message/toolHelpers.tsx` 可扩展 `data_*` 图标和标题                |

需要补齐：

- 数据命令统一门面，避免 tool、CLI、UI 分叉实现。
- `DataToolService` 和 `DataAgentRuntimeExtension`。
- `data_*` 工具 schema、权限分级、返回摘要和结构化 details。
- 对话上下文中的当前数据对象绑定。
- 数据工具 trace 展示和预览行数限制。

---

## 3. 架构路线

### 3.1 主链路

```text
用户对话
  -> AgentRunner
  -> AgentRuntimeExtensionManager
  -> DataAgentRuntimeExtension
  -> data_* custom tools
  -> DataToolService
  -> DataCommandService
  -> DataTaskStore + prep-dsl + DuckDB
```

### 3.2 新增文件

```text
src/main/data/
  data-command-types.ts
  data-command-service.ts
  data-tool-types.ts
  data-tool-service.ts
  data-tool-definitions.ts
  data-tool-prompt.ts
  data-agent-extension.ts

tests/
  data-command-service.test.ts
  data-tool-service.test.ts
  data-agent-extension.test.ts
```

其中 `data-tool-prompt.ts` 的上下文注入内容必须遵循：

```text
design/toolcall/data-tool-context-injection-design.md
```

后续 CLI 再增加：

```text
src/main/data/data-cli-runtime.ts
src/cli/data-cli.ts
```

---

## 4. 关键设计

### 4.1 DataCommandService

`DataCommandService` 是 UI、tool call、CLI 的共享业务门面。

第一批方法：

```ts
listInputTables(input);
createInputTable(input);
updateInputTable(input);
listOutputTables(input);
createOutputTable(input);
updateOutputTable(input);
previewTable(input);
listTasks(input);
createTask(input);
updateTask(input);
getTaskWorkflow(input);
applyWorkflowDsl(input);
exportWorkflowDsl(input);
configureInputOperator(input);
applyOperatorDsl(input);
configureOutputOperator(input);
runTask(input);
getRunResult(input);
```

职责：

- 校验参数和资源存在性。
- 统一错误码。
- 统一名称匹配和歧义处理。
- 统一 preview 行数限制。
- 统一 dry-run、temporary、persisted 语义。
- 统一输入表/输出表创建时的路径权限、配置校验和覆盖策略。
- 统一审计事件记录。
- 禁止直接暴露任意 SQL 或任意文件路径读取。

### 4.2 DataToolService

`DataToolService` 把 LLM tool 参数转换为命令服务调用。

职责：

- 创建 tool actor：`actorType='tool'`、`sessionId`、`toolCallId`。
- 处理 `current: true` 上下文解析。
- 压缩结果为对话可读摘要。
- 把结构化结果放进 `details`。
- 给长任务发送 `onUpdate` 进度。
- 根据权限等级标记危险操作。

工具结果原则：

- `content[0].text` 是短摘要。
- `details` 保存机器可读结果。
- 表预览默认 20 行，最大 100 行。
- 超长字段截断，结果中不泄露未授权绝对路径。

### 4.3 DataAgentRuntimeExtension

注册为 agent runtime 扩展：

```ts
agentRuntimeExtensionManager.register(createDataAgentRuntimeExtension(dataToolService));
```

`beforeSessionRun` 返回：

- `promptPrefix`：告诉 LLM 只有固定/可复用数据处理流程才使用 `data_*` 工具。
- `customTools`：当前可用的数据工具定义。

Prompt 重点：

- 只有用户表达创建、保存、运行或修改固定数据处理流程时，才进入 `data_*` 工作流。
- 固定流程中先 list/preview 确认表、任务、字段，再处理。
- 不读取整表到对话。
- 固定流程内先 dryRun 或 temporary run。
- 持久化、覆盖、删除、导入文件必须确认。
- 遇到候选歧义要追问用户。

### 4.4 对话上下文

新增轻量上下文：

```ts
interface DataConversationContext {
  sessionId: string;
  workspacePath?: string;
  selectedDataTaskId?: string;
  selectedInputTableId?: string;
  selectedOutputTableId?: string;
}
```

MVP 可先只支持显式 ID。第二步再让数据页面在打开任务、输入表、输出表时把当前对象写入会话上下文。

### 4.5 权限等级

| 等级         | 工具                                             | 策略                         |
| ------------ | ------------------------------------------------ | ---------------------------- |
| read         | list、preview、get workflow、export DSL          | 默认允许，限制返回规模       |
| validate     | dry-run DSL、schema 检查                         | 默认允许                     |
| write_config | create/update/apply DSL/configure operator       | 需要确认或会话授权           |
| execute      | run task temporary/persisted                     | 需要确认，temporary 风险较低 |
| destructive  | delete、overwrite output、replace physical table | 必须明确确认                 |
| file_access  | import file/folder                               | 必须确认路径权限             |

---

## 5. 工具 MVP

第一版只做对话最常用链路。

### 5.1 输入表、输出表和任务创建

- `data_list_input_tables`
- `data_create_input_table`
- `data_update_input_table`
- `data_list_output_tables`
- `data_create_output_table`
- `data_update_output_table`
- `data_list_tasks`
- `data_create_task`

验收：

- LLM 能在用户确认后创建数据任务。
- LLM 能基于用户提供或选择的本地文件创建输入表。
- 输入表创建支持 CSV、Excel 和文件夹来源，文件/文件夹路径必须通过权限确认。
- LLM 能创建输出表，并可指定来源输入表或仅创建空的输出目标配置。
- 同名资源创建时返回冲突或候选提示，不静默覆盖。

### 5.2 只读发现与预览

- `data_preview_table`
- `data_get_task_workflow`
- `data_export_workflow_dsl`

验收：

- LLM 能找到用户提到的表名候选。
- 表名匹配多个时返回 `AMBIGUOUS_DATA_RESOURCE`。
- `data_preview_table` 默认 20 行，最大 100 行。
- 预览结果包含列名、行数摘要、少量样本。

### 5.3 工作流与 DSL 应用

- `data_apply_workflow_dsl`
- `data_apply_operator_dsl`
- `data_configure_input_operator`
- `data_configure_output_operator`

验收：

- LLM 能创建任务并用 DSL 写入工作流。
- `dryRun=true` 只返回编译后的节点、边和诊断，不写库。
- 单算子 DSL 类型不匹配返回 `OPERATOR_TYPE_MISMATCH`。
- 输入算子只能绑定已存在输入表。
- 输出算子支持 existing 和 auto 两种策略。

### 5.4 执行与结果读取

- `data_run_task`
- `data_get_run_result`

验收：

- temporary 运行不会覆盖正式输出表。
- persisted 运行会使用已保存任务配置。
- 执行进度至少包含：`validating workflow`、`reading inputs`、`executing operators`、`writing output`、`preparing preview`。
- 运行完成后返回输出表或临时结果 ID，以及最多 20 行预览。

---

## 6. 分阶段实施

### Phase 0：现状梳理与边界固定

工作项：

- 梳理 `DataTaskStore` 方法入参、返回值和当前 IPC 使用点。
- 梳理 `prep-dsl` 的任务级、单算子级解析和错误结构。
- 明确数据工具第一版支持受控的输入表文件导入，但不支持任意路径读取，也不支持 MCP server。
- 明确 preview 最大行数、字段截断长度、错误码列表。

交付：

- `data-command-types.ts` 初稿。
- 工具清单和权限矩阵定稿。

验收：

- 每个 MVP tool 都能映射到一个或多个已有 store/DSL 能力。
- 没有 tool 需要直接访问 UI 状态。

### Phase 1：DataCommandService

工作项：

- 新增 `DataCommandService` 和统一结果类型。
- 包装 list/preview/task/workflow/run 核心能力。
- 实现名称查询、分页、limit clamp、错误码转换。
- 实现 `applyWorkflowDsl(dryRun)` 和 `applyOperatorDsl(dryRun)`。
- 增加审计事件接口，MVP 可先内存/日志，后续落表。

验收：

- 单测覆盖 read、preview、DSL dry-run、DSL 保存、temporary run。
- 现有数据页面不改行为，后续可逐步切到服务层。

建议测试：

```bash
npx vitest run tests/data-duckdb-store.test.ts tests/prep-dsl/parser-compiler.test.ts
```

### Phase 2：DataToolService 与工具定义

工作项：

- 新增 `data-tool-types.ts`，定义 tool params/result。
- 使用 TypeBox 定义 `data_*` schemas。
- 新增 `DataToolService`，把 tool 参数转换为 `DataCommandService` 命令。
- 格式化工具返回摘要和 `details`。
- 实现 `onUpdate` 进度回调。
- 对写入、执行、破坏性操作接入现有权限标记。
- 对 `data_create_input_table` 增加路径权限校验和来源类型校验。

验收：

- 直接调用 custom tool execute 可以完成 list、preview、create input table、create output table、create task、apply DSL、temporary run。
- 所有工具返回 `content` 和结构化 `details`。
- 错误返回包含稳定 `code` 和用户可读 `message`。

### Phase 3：DataAgentRuntimeExtension 注册

工作项：

- 新增 `data-tool-prompt.ts`。
- 新增 `data-agent-extension.ts`。
- 按 `design/toolcall/data-tool-context-injection-design.md` 实现 `buildDataToolPrompt(...)`，确保 LLM 上下文包含创建输入表、输出表和数据任务的调用文档。
- 在 `src/main/index.ts` 初始化时创建 `DataCommandService`、`DataToolService` 并注册扩展。
- 确保和 `MemoryExtension` 共存，工具名不冲突。
- 在 agent runner 日志中能看到 `data_*` custom tools。

验收：

- 开启普通会话时，LLM 上下文包含数据工具路由 prompt，并明确一次性探索不能自动创建或运行数据任务。
- `AgentRuntimeExtensionManager.beforeSessionRun` 返回完整数据工具列表。
- MCP tools 和 data tools 合并后无重名。

### Phase 4：对话体验与工具展示

工作项：

- 在 `toolHelpers.tsx` 中为 `data_*` 增加数据库/表格图标。
- 为核心工具增加紧凑标题：
  - `data_preview_table` -> `预览表：<name/id>`
  - `data_run_task` -> `执行数据任务：<name/id>`
  - `data_apply_operator_dsl` -> `更新算子 DSL：<node>`
- 工具结果正文使用紧凑 Markdown。
- 后续可基于 `details.kind='data.preview'` 渲染专用表格卡片。

验收：

- 对话中能看清数据工具调用名称和结果。
- 预览不会把大量表格文本撑爆消息卡片。
- 远程控制通道能收到同样的 tool trace。

### Phase 5：数据页面上下文绑定

工作项：

- 在数据任务编辑页打开时记录 `selectedDataTaskId`。
- 在输入表/输出表编辑或预览时记录当前表 ID。
- 对话从数据页面发起时，将当前数据上下文传给 agent session。
- 工具支持 `current: true`。

验收：

- 用户说“把当前任务里的筛选条件改一下”时，LLM 能读取当前任务。
- 如果没有当前任务，LLM 会调用 list 工具并让用户选择。
- 当前对象不存在或已删除时返回 `RESOURCE_NOT_FOUND`。

### Phase 6：CLI 衔接与回归

工作项：

- 基于同一 `DataCommandService` 实现 CLI MVP。
- 用 CLI 覆盖端到端数据任务自动化测试。
- 保持 CLI、UI、tool call 输出语义一致。

验收：

- CLI 可完整执行：创建任务 -> 导入 DSL -> 运行 -> 预览。
- tool call 与 CLI 对相同命令返回同类错误码。

### Phase 7：可选 MCP server

工作项：

- 将 `DataToolService` 包装为 MCP server。
- 设置页增加启用开关。
- 默认关闭，仅本机可访问。

验收：

- 外部 agent 可在用户启用后调用同一组数据工具。
- 关闭后无端口监听、无工具暴露。

---

## 7. 端到端对话验收剧本

### 7.1 查询和预览输入表

用户：

```text
帮我看一下有没有销售相关的输入表。
```

期望：

1. LLM 调用 `data_list_input_tables`，`query="销售"`。
2. 如果有候选，返回表名、ID、行列数。
3. LLM 询问是否预览，或直接预览最相关候选的 20 行。

### 7.2 临时清洗试算

用户：

```text
把销售明细按地区汇总 GMV，先给我看结果，不要保存。
```

期望：

1. `data_list_input_tables`
2. `data_preview_table`
3. `data_create_task` 或使用临时任务上下文
4. `data_apply_workflow_dsl(dryRun=true)`
5. `data_run_task(mode=temporary, previewRows=20)`
6. 对话返回预览和“未保存正式输出”的说明。

### 7.3 从本地文件创建输入表

用户：

```text
把我刚选的 sales.csv 建成一个输入表，名字叫“销售明细”。
```

期望：

1. LLM 识别这是文件导入和输入表创建。
2. 权限确认通过后调用 `data_create_input_table`。
3. 工具返回输入表 ID、名称、来源类型、行列数和少量预览。
4. 如果路径未授权，返回 `FILE_ACCESS_DENIED` 并引导用户选择文件。

### 7.4 创建输出表

用户：

```text
创建一个输出表，叫“地区 GMV 汇总”，后面任务就输出到这里。
```

期望：

1. LLM 调用 `data_create_output_table`。
2. 如果同名输出表已存在，返回候选并询问是否复用。
3. 返回输出表 ID，后续 `data_configure_output_operator` 可以绑定该输出表。

### 7.5 保存正式任务和输出表

用户：

```text
这个方案可以，保存成一个任务，并输出到“地区 GMV 汇总”。
```

期望：

1. LLM 说明将创建/更新任务和输出表。
2. 权限确认通过后调用 `data_apply_workflow_dsl(dryRun=false)`。
3. 调用 `data_run_task(mode=persisted)`。
4. 返回任务 ID、输出表 ID、行列数和预览。

### 7.6 修改当前任务

用户：

```text
把当前任务里的筛选条件改成只保留华东和华南，先给我看结果。
```

期望：

1. 如果有 `selectedDataTaskId`，调用 `data_get_task_workflow(current=true)`。
2. 如果多个筛选节点，LLM 追问。
3. `data_apply_operator_dsl(dryRun=true)`。
4. `data_run_task(mode=temporary)`。
5. 用户确认后才保存节点配置。

---

## 8. 测试计划

### 8.1 单元测试

- `DataCommandService` 参数校验和错误码。
- 名称匹配歧义。
- preview limit clamp。
- 输入表创建的路径权限、CSV/Excel/文件夹配置校验。
- 输出表创建的同名冲突和来源输入表校验。
- workflow DSL dry-run/save。
- operator DSL 类型校验。
- temporary run 不污染 persisted output。

### 8.2 Tool 测试

- TypeBox schema 接受合法参数、拒绝非法参数。
- `data_list_input_tables` 返回摘要和 details。
- `data_create_input_table` 未授权路径返回 `FILE_ACCESS_DENIED`。
- `data_create_output_table` 同名冲突返回稳定错误或候选。
- `data_preview_table` 不超过最大行数。
- `data_apply_workflow_dsl(dryRun=true)` 不写库。
- `data_run_task` 发送进度事件。
- 权限拒绝时返回可读错误。

### 8.3 Agent 集成测试

- `DataAgentRuntimeExtension.beforeSessionRun` 返回 promptPrefix 和 customTools。
- agent runner 合并工具后包含 `data_*`。
- data tools 和 MCP/memory tools 不重名。
- 工具展示标题和图标正确。

### 8.4 回归命令

```bash
npm run typecheck
npx vitest run tests/data-duckdb-store.test.ts tests/prep-dsl/parser-compiler.test.ts
npx vitest run tests/data-command-service.test.ts tests/data-tool-service.test.ts tests/data-agent-extension.test.ts
```

---

## 9. 风险与对策

| 风险                           | 对策                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| LLM 猜表名或字段名             | prompt 要求先 list/preview；工具对名称歧义返回候选                                           |
| LLM 把一次性分析误判为数据任务 | prompt 明确只有固定/可复用流程才使用工作流写入和执行工具；一次性探索先追问是否沉淀为数据任务 |
| 预览数据过大                   | 默认 20 行、最大 100 行、字段截断                                                            |
| 临时运行污染正式结果           | `temporary` 和 `persisted` 类型强制区分，测试覆盖                                            |
| 权限绕过                       | tool 只走 `DataCommandService`，写入/执行/删除统一确认                                       |
| UI、CLI、tool 行为分叉         | 所有入口共享 `DataCommandService`                                                            |
| DuckDB/SQLite 并发写冲突       | MVP 全局串行写队列，后续引入 lock 文件和任务级队列                                           |
| 工具结果难读                   | `toolHelpers.tsx` 增加 data 工具标题，结果正文只放摘要                                       |

---

## 10. MVP 完成定义

MVP 完成时应满足：

- 用户能在九思助理对话中发现、预览输入表。
- 用户能在九思助理对话中创建输入表、输出表和数据任务。
- 用户的一次性分析请求不会自动创建或运行数据任务，会先确认是否需要固定流程。
- 用户能要求 LLM 生成数据任务 DSL 并 dry-run 校验。
- 用户能临时运行数据处理并查看预览。
- 用户确认后，LLM 能保存任务并运行到正式输出表。
- 所有写入和执行操作都有权限确认。
- 工具调用 trace 在对话中显示为数据相关标题。
- 自动化测试覆盖主要成功路径和关键风险路径。

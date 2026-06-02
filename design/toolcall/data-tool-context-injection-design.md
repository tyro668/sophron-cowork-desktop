# 数据处理 Tools 的 LLM 上下文注入设计文档 v0.1

## 1. 目标

为了让九思助理在普通对话中正确调用数据处理 tools，需要在每次 Agent 会话运行前注入一段稳定、精简、可执行的工具调用文档。

这段上下文由 `DataAgentRuntimeExtension.beforeSessionRun(...)` 通过 `promptPrefix` 注入，和 `data_*` custom tools 同时注册。它要解决的问题是：

- LLM 知道什么时候应该使用数据处理 tools，什么时候不应该自动使用。
- LLM 知道如何创建输入表、数据任务和输出表。
- LLM 知道如何先发现资源，再引用真实 ID。
- LLM 知道哪些操作必须请求确认。
- LLM 不会把本地文件、SQLite、DuckDB 或整表数据直接读进对话。

本设计只描述注入到 LLM 上下文中的“调用文档”和动态上下文，不定义工具底层实现。底层工具定义见 `design/toolcall/data-cli-and-toolcall-design.md`，落地计划见 `design/toolcall/data-conversation-toolcall-development-plan.md`。

---

## 2. 注入入口

新增模块：

```text
src/main/data/data-tool-prompt.ts
src/main/data/data-agent-extension.ts
```

运行时链路：

```text
AgentRunner
  -> AgentRuntimeExtensionManager.beforeSessionRun(context)
  -> DataAgentRuntimeExtension.beforeSessionRun(context)
  -> buildDataToolPrompt(dataContext)
  -> promptPrefix + data_* customTools
```

示意：

```ts
export function createDataAgentRuntimeExtension(
  dataToolService: DataToolService
): AgentRuntimeExtension {
  return {
    name: 'data-tools',
    async beforeSessionRun(context) {
      const dataContext = await dataToolService.resolveConversationContext(context);
      return {
        promptPrefix: buildDataToolPrompt(dataContext),
        customTools: createDataCustomTools(dataToolService, dataContext),
      };
    },
  };
}
```

---

## 3. 注入内容组成

`buildDataToolPrompt(...)` 输出由四部分组成，顺序固定：

1. **工具路由规则**：只有哪些固定流程意图应使用 `data_*` tools。
2. **当前数据上下文**：当前任务、输入表、输出表 ID，仅当存在时注入。
3. **核心工具调用文档**：创建输入表、创建输出表、创建数据任务、应用 DSL、运行任务。
4. **标准工作流配方**：从文件创建输入表、从已有输入表建固定任务、保存正式输出。

不注入：

- 不注入完整输入表列表、输出表列表或任务列表。
- 不注入完整表格数据。
- 不注入任意本机路径扫描结果。
- 不注入大型 DSL 示例库。

原因：具体资源必须通过实时 tool 调用获取，避免上下文过大或过期。

---

## 4. 动态数据上下文

### 4.1 数据结构

```ts
interface DataToolPromptContext {
  workspacePath?: string;
  sessionId: string;
  selectedDataTaskId?: string;
  selectedDataTaskName?: string;
  selectedInputTableId?: string;
  selectedInputTableName?: string;
  selectedOutputTableId?: string;
  selectedOutputTableName?: string;
  capabilities: {
    canCreateInputTable: boolean;
    canCreateOutputTable: boolean;
    canCreateTask: boolean;
    canRunTask: boolean;
    canImportLocalFiles: boolean;
  };
}
```

### 4.2 注入格式

如果存在当前对象，注入：

```text
Current data context:
- currentDataTask: task_xxx ("销售清洗")
- currentInputTable: dataset_xxx ("销售明细")
- currentOutputTable: output_xxx ("地区 GMV 汇总")
```

如果不存在当前对象，注入：

```text
Current data context:
- No current data task/table is selected. Use list tools before referencing resources by name.
```

### 4.3 使用规则

- 用户说“当前任务”时，如果 `currentDataTask` 存在，LLM 可以用 `current: true` 或显式 `taskId`。
- 用户只说“销售表”“那个输出表”时，LLM 必须先调用 list/preview 工具解析候选。
- 候选超过一个时，LLM 必须追问或展示候选，不能猜 ID。

---

## 5. 注入的工具调用文档

以下内容是 `promptPrefix` 中必须包含的语义。实际实现时可以压缩措辞，但不能删除约束。

### 5.1 总规则

```text
You have access to data_* tools for local data processing.
Use workflow/data-processing tools only when the user asks to create, manage, save, run, or modify a fixed reusable data-processing workflow.

Never read the app SQLite database, DuckDB files, or raw local data files directly for data processing.
Do not load entire tables into chat.

Use data_* tools when the user explicitly asks to:
- create an input table, output table, or data task;
- save a reusable processing workflow;
- output results to a reusable output table;
- run an existing data task;
- modify the current/existing data task;
- define a repeatable/fixed flow that can be rerun later.

Do not automatically create a data task or run a workflow for one-off exploration, casual analysis, or simple questions.
For one-off data analysis, ask whether the user wants to save it as a reusable data task before using workflow write/execute tools.

Before using a table/task/output by name in a fixed workflow, call the relevant list tool and use returned IDs.
If multiple resources match, ask the user to choose.
Within a fixed workflow, use dryRun and temporary run for validation before persisted run.
For creating input tables from local files/folders, persisted runs, output overwrite, delete, or replacing physical data, request permission through normal tool permission flow.
```

### 5.1.1 不触发数据处理工具的情况

以下请求不应自动使用数据任务写入或执行工具：

```text
帮我随便看看这个文件
分析一下这份数据有什么问题
算一下这个 CSV 里大概有哪些趋势
用 Python 帮我处理这个文件
```

处理原则：

- 如果用户没有表达“固定流程、可复用、保存任务、输出表、以后重复执行、修改当前任务”等意图，不调用 `data_create_task`、`data_apply_workflow_dsl`、`data_run_task`。
- 可以追问：“要把这个处理沉淀为可复用的数据任务吗？”
- 用户确认要固定流程后，才进入 `data_*` 工作流。

### 5.2 创建输入表

注入给 LLM 的调用说明：

```text
To create an input table:
1. Confirm the user selected or explicitly provided the local file/folder path.
2. Call data_create_input_table with name, sourceKind, filePath or folderPath, config, and previewRows.
3. Use the returned inputTable.id in later workflow DSL or data_configure_input_operator calls.
4. If FILE_ACCESS_DENIED is returned, ask the user to select/authorize the file or folder.
5. If RESOURCE_ALREADY_EXISTS is returned, ask whether to reuse, rename, or cancel. Never silently overwrite.
```

工具调用形态：

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

Excel：

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

### 5.3 创建输出表

注入给 LLM 的调用说明：

```text
To create an output table:
1. Call data_create_output_table with a user-facing name.
2. If the output table should be based on an existing input table, include sourceInputTableId.
3. Use the returned outputTable.id in data_configure_output_operator or workflow DSL.
4. Creating an output table creates configuration only. Physical data is written by data_run_task.
5. If RESOURCE_ALREADY_EXISTS is returned, ask whether to reuse the existing output table, rename, or cancel.
```

工具调用形态：

```json
{
  "name": "地区 GMV 汇总",
  "sourceInputTableId": "dataset_xxx"
}
```

或：

```json
{
  "name": "地区 GMV 汇总"
}
```

### 5.4 创建数据任务

注入给 LLM 的调用说明：

```text
To create a data task:
1. Call data_create_task with the task name.
2. Build or validate workflow DSL with real input/output IDs or names confirmed through tools.
3. Call data_apply_workflow_dsl with dryRun=true first for generated DSL.
4. If diagnostics are clean and user wants to save, call data_apply_workflow_dsl with dryRun=false.
5. Run with data_run_task. Use mode=temporary for trials and mode=persisted only after confirmation.
```

工具调用形态：

```json
{
  "name": "销售数据清洗"
}
```

### 5.5 应用工作流 DSL

注入给 LLM 的调用说明：

```text
When generating workflow DSL:
- Use input tables discovered or created through tools.
- Use output table names/IDs discovered or created through tools.
- First call data_apply_workflow_dsl with dryRun=true.
- Do not save generated DSL until diagnostics are clean and the user confirms persistence.
```

示例 DSL：

```text
input source dataset "销售明细" as sales

from sales
  | cast [gmv] as double on_error null
  | filter [gmv] > 0
  | aggregate by [region] metrics sum([gmv]) as total_gmv
  | output table "地区 GMV 汇总" mode replace
```

### 5.6 运行任务

注入给 LLM 的调用说明：

```text
Use data_run_task:
- mode=temporary only for validating a fixed workflow before saving or persisted execution.
- mode=persisted only when the user asks to save/run formally or confirms.
- Always request confirmation for persisted runs that overwrite or replace output data.
- After running, summarize row count, output/temporary result ID, and include only a small preview.
```

---

## 6. 标准调用配方

### 6.1 用户从本地文件开始

用户：

```text
把 sales.csv 建成输入表，按地区汇总 GMV，输出到“地区 GMV 汇总”。
```

LLM 必须按顺序：

1. 确认文件路径来自用户选择或授权。
2. `data_create_input_table`
3. `data_create_output_table`
4. `data_create_task`
5. `data_apply_workflow_dsl(dryRun=true)`
6. 如需保存：`data_apply_workflow_dsl(dryRun=false)`
7. `data_run_task(mode=persisted)`
8. `data_preview_table(tableKind="output")`

### 6.2 用户已有输入表且要求固定任务

用户：

```text
用销售明细生成一个清洗任务，先给我看试算结果。
```

LLM 必须按顺序：

1. `data_list_input_tables(query="销售明细")`
2. 必要时 `data_preview_table(tableKind="input")`
3. `data_create_task`
4. `data_apply_workflow_dsl(dryRun=true)`
5. `data_run_task(mode=temporary)`
6. 返回预览，并说明尚未保存正式输出。

### 6.2.1 用户只要求一次性分析

用户：

```text
帮我看一下销售明细里 GMV 的地区分布。
```

LLM 不应自动调用 `data_create_task` 或 `data_run_task`。

应先判断用户是否要固定流程：

```text
这是一次性分析，还是要保存成可重复执行的数据任务？
```

用户确认要保存成任务后，才进入 `data_create_task`、`data_apply_workflow_dsl`、`data_run_task`。

### 6.3 用户要求创建空输出表

用户：

```text
先创建一个输出表，叫“地区 GMV 汇总”。
```

LLM 调用：

1. `data_create_output_table`
2. 返回输出表 ID，并说明尚未写入数据。

### 6.4 用户要求修改当前任务

用户：

```text
把当前任务改成只保留华东和华南，先看结果。
```

LLM 必须按顺序：

1. 如果有 `currentDataTask`，`data_get_task_workflow(current=true)`；否则 `data_list_tasks`。
2. 找到候选 filter 节点；多个候选时追问。
3. `data_apply_operator_dsl(dryRun=true)`。
4. `data_run_task(mode=temporary)`。
5. 用户确认后才 `data_apply_operator_dsl(dryRun=false)`。

---

## 7. 上下文长度控制

`promptPrefix` 目标长度：

- 默认不超过 1800-2400 tokens。
- 动态上下文不超过 20 行。
- 工具调用文档只保留核心 tools，不把全部 schema 完整展开。
- 复杂示例最多保留 1 个 DSL 示例。

当上下文预算紧张时，按以下顺序裁剪：

1. 裁剪示例 DSL。
2. 裁剪非当前场景的配方。
3. 保留总规则、当前数据上下文、创建输入表/输出表/任务的核心流程。

不可裁剪：

- 不直接读 SQLite/DuckDB/本地文件。
- 先 list/preview 再引用 ID。
- 文件导入必须授权。
- 固定流程内先 dryRun/temporary，再 persisted。
- 持久化和覆盖必须确认。

---

## 8. 实现要求

### 8.1 `buildDataToolPrompt`

建议接口：

```ts
export function buildDataToolPrompt(context: DataToolPromptContext): string;
```

要求：

- 输出稳定文本，便于快照测试。
- 根据 `capabilities` 裁剪不可用工具说明。
- 当前 ID/name 要做安全转义，避免把用户输入直接变成 prompt 指令。
- 不读取表数据；只使用当前会话已知上下文。

### 8.2 测试

新增测试：

```text
tests/data-tool-prompt.test.ts
tests/data-agent-extension.test.ts
```

覆盖：

- 无当前数据上下文时，prompt 要求先 list。
- 有当前任务时，prompt 注入 currentDataTask。
- prompt 包含 `data_create_input_table`、`data_create_output_table`、`data_create_task` 的调用顺序。
- prompt 包含文件权限、临时运行、持久化确认约束。
- prompt 明确说明一次性探索不能自动创建或运行数据任务。
- prompt 不包含完整表数据或未授权路径扫描内容。

---

## 9. 验收标准

- LLM 在“创建输入表”请求中优先调用 `data_create_input_table`，而不是读文件或写脚本。
- LLM 在“创建输出表”请求中调用 `data_create_output_table`，并说明该操作不写入物理数据。
- LLM 在“创建数据任务”请求中调用 `data_create_task`，再用 DSL 或 operator tools 配置工作流。
- LLM 对自然语言表名会先 list/preview 获取 ID。
- LLM 对本地文件导入、持久化运行、覆盖输出会请求确认。
- LLM 对一次性探索不会自动创建数据任务或运行数据工作流，而是先询问是否保存为固定流程。
- 对话中返回的是摘要和小样本预览，不返回整表。

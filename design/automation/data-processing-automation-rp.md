# 自动化-数据处理 AI 生成任务 RP v0.2

## 1. 背景与问题

自动化里的“数据处理”面向的是定时、无人值守或低干预的数据加工场景。用户期望用自然语言描述处理要求，例如：

```text
过滤掉 Profit < 0 的数据，并按照过滤后的 Profit 升序排列
```

系统需要把这段自然语言稳定转成可复用的数据任务。早期如果直接让大模型输出 DSL，会遇到几个问题：

- 大模型容易输出非 DSL 内容，例如 Markdown、解释文本、JSON 或 SQL。
- 大模型可能引用不存在的字段，导致运行期才失败。
- DSL 语法细节容易出错，例如字段引用、输出表声明、操作符参数。
- 自动化运行期如果每次重新调用大模型，成本高、稳定性差，也不适合无人值守。
- 用户看到“AI 处理”会误以为运行期持续由 AI 处理数据，而不是执行确定的数据任务。

本方案解决的核心问题是：

```text
把一次性的自然语言意图，可靠地转换为可校验、可保存、可复用的数据任务。
```

## 2. 设计目标

- AI 只参与配置期生成任务，不参与每次自动化运行。
- 大模型主路径输出结构化 JSON 计划，而不是直接输出 DSL。
- 后端负责把结构化 JSON 编译成 Prep DSL，掌控语法、字段校验和资源绑定。
- 编译后的 DSL 必须经过 dry-run 校验，确认可保存后才沉淀为数据任务。
- 当结构化编译器无法覆盖复杂需求时，允许大模型生成完整 DSL 作为兜底，但仍必须经过解析和校验。
- 前端文案明确区分：
  - `AI 生成任务`
  - `复用数据任务`
- 生成成功后提示用户后续会复用该任务执行。

## 3. 非目标

- 不让自动化运行期每次重新生成 DSL。
- 不把任意 SQL 作为数据任务生成结果。
- 不在本轮扩展复杂多表 DAG 或条件分支。
- 不把大模型输出作为可信执行内容直接落库。

## 4. 总体方案

自动化“数据处理”只有一个动作入口，内部有两种处理方式：

```text
数据处理
  ├─ AI 生成任务
  └─ 复用数据任务
```

其中 `AI 生成任务` 是配置期能力。用户选择输入表、填写处理要求、选择输出方式后，前端调用：

```text
data.generateTaskFromRequirement
```

后端完成：

```text
自然语言要求
  -> 大模型生成结构化 JSON operations
  -> 后端编译 JSON operations 为 Prep DSL
  -> dry-run 校验 DSL
  -> 必要时修复或走高级 DSL 兜底
  -> 保存为数据任务 workflow
  -> 自动化运行期复用 taskId 执行
```

## 5. 技术链路

### 5.1 前端入口

前端数据处理配置位于：

- `src/renderer/components/settings/schedule/editorPanels.tsx`

关键行为：

- `AI 生成任务` 模式保存的是尚未沉淀的数据处理配置。
- 点击生成后调用 `window.electronAPI.data.generateTaskFromRequirement`。
- 生成成功后，节点变成可运行的数据任务配置，包含 `taskId`、`workflowDsl` 等信息。
- 页面短暂提示：

```text
数据任务已生成，后续将复用该任务执行。
```

### 5.2 IPC 与命令服务

IPC 入口：

- `src/main/data/ipc/data-tasks-ipc.ts`

后端主流程：

- `src/main/data/data-command-service.ts`
- `DataCommandService.generateTaskFromRequirement`

主流程包括：

1. 校验处理要求。
2. 准备输入表：
   - 本地输入表直接使用。
   - 云端表先导入成本地输入表。
3. 准备输出表：
   - 新建输出表。
   - 或绑定已有输出表。
4. 复用已有生成任务，或创建新的数据任务。
5. 调用大模型生成 workflow。
6. dry-run 校验 DSL。
7. 必要时修复。
8. 保存 workflow 到数据任务。
9. 返回自动化节点需要持久化的生成结果。

## 6. 主路径：结构化 JSON 计划

### 6.1 为什么先生成 JSON

大模型不直接生成 DSL，而是先输出结构化操作计划：

```json
{
  "operations": [
    { "type": "filter", "column": "Profit", "operator": ">=", "value": 0 },
    { "type": "sort", "column": "Profit", "direction": "asc" }
  ],
  "requiredColumns": [{ "name": "Profit" }],
  "changeSummary": "过滤负利润并按利润升序排列"
}
```

这样做的原因：

- JSON operations 比 DSL 更容易约束。
- 后端可以白名单化支持的操作类型。
- 字段必须从输入表 columns 中解析，不能凭空创造。
- DSL 语法由应用生成，减少模型语法漂移。
- 后续可以继续扩展 operation registry，而不改自动化动作协议。

### 6.2 Prompt 约束

系统提示要求模型：

- 只返回严格 JSON。
- 不返回 Markdown、注释、解释或代码块。
- 只使用输入表已有字段。
- 不写 Prep DSL 或 SQL。
- 对金额、价格、比例等固定精度字段优先使用 decimal。
- 不确定时生成最安全的有效操作。

### 6.3 Operation Registry

后端维护结构化操作编译器：

```text
GeneratedWorkflowOperationRegistry
  filter
  sort
  convert_type
  select
  drop
  rename
  derive
  aggregate
```

每个 operation 定义两部分：

- `promptSpec`：告诉模型如何输出该操作。
- `compile`：把操作编译为 Prep DSL 片段。

示例：

```text
{ type: "filter", column: "Profit", operator: ">=", value: 0 }
  -> | filter [Profit] >= 0

{ type: "sort", column: "Profit", direction: "asc" }
  -> | sort by [Profit] asc
```

最终 DSL 由后端统一拼装：

```text
input source dataset "<inputTableId>" as src
  | filter [Profit] >= 0
  | sort by [Profit] asc
  | output table "<outputTableName>" mode replace
```

## 7. 校验与编译

结构化 JSON 计划不会直接落库。后端会执行多层校验：

### 7.1 字段校验

编译前构建输入字段索引：

```text
columnsByName: Map<lowercaseName, column>
```

每个 operation 引用字段时都必须通过 `requireColumn`：

- 字段为空：报错。
- 字段不存在：报错。
- 字段存在：记录到 `requiredColumns`。

### 7.2 DSL 解析校验

编译后调用 Prep DSL parser：

```text
parsePrepDsl(workflowDsl)
compilePrepWorkflowToFlow(ast)
```

如果解析或编译诊断包含 error，则不允许保存。

### 7.3 dry-run 校验

生成 DSL 后先调用：

```text
applyWorkflowDsl({ dryRun: true })
```

只有 dry-run 没有错误时，才会正式保存：

```text
applyWorkflowDsl({ dryRun: false })
```

这保证了自动化最终复用的是已经通过后端校验的数据任务。

## 8. 兜底策略

生成链路分三层：

```text
第一层：结构化 JSON operations -> 后端编译 DSL
第二层：带诊断信息让模型修复 operations
第三层：高级需求由模型生成完整 DSL，再由后端校验
```

### 8.1 第一层：稳定编译器

默认路径是：

```text
模型输出 JSON operations
  -> compileGeneratedWorkflowPlan
  -> parseGeneratedWorkflowDslResponse
```

适合过滤、排序、字段选择、重命名、类型转换、聚合等常见需求。

### 8.2 第二层：诊断驱动修复

如果解析模型输出、编译 operations 或 dry-run 时失败，后端会把失败内容和 diagnostics 传回模型：

```text
previousFailedAttempt:
  compiledWorkflowDsl
  diagnostics
  instruction: Return corrected operations. Do not return DSL.
```

模型仍然需要返回结构化 operations。后端重新编译和 dry-run。

### 8.3 第三层：高级 DSL 兜底

如果模型给出的 operation 类型不在 registry 中，说明需求可能超出稳定编译器表达范围。此时进入高级 DSL 兜底：

```text
generateAdvancedWorkflowDslFromPlan
```

高级兜底要求模型返回：

```json
{
  "workflowDsl": "完整多行 Prep DSL",
  "requiredColumns": [{ "name": "字段名" }],
  "explanation": "为什么需要高级 DSL"
}
```

但兜底 DSL 仍然不是直接信任：

- 必须以指定 input source 行开始。
- 必须以指定 output table 行结束。
- 必须通过 `parsePrepDsl`。
- 必须包含 input source 和 output table。
- 必须通过字段引用校验。
- 必须通过 dry-run。

如果兜底后仍有错误，向前端返回 `DSL_PARSE_FAILED` 或 `VALIDATION_FAILED`，不保存不可运行任务。

## 9. 生成结果持久化

生成成功后返回：

```ts
interface DataGenerateTaskFromRequirementResult {
  taskId: string;
  taskName: string;
  outputTableId: string;
  outputTableName: string;
  workflowDsl: string;
  requiredColumns: DataAutomationColumnSnapshot[];
  columnsSnapshot: DataAutomationColumnSnapshot[];
  sourceSummaryHash: string;
  version: number;
  generatedAt: number;
}
```

自动化节点保存这些信息后，运行期不再需要自然语言要求或模型参与，而是执行 `taskId` 对应的数据任务。

再次生成时，如果来源表匹配，可以传入：

- `reuseTaskId`
- `currentVersion`
- 已有输出表 ID

后端优先复用原任务并更新 workflow，避免重复创建数据任务。

## 10. 运行期行为

自动化运行时只有确定性动作：

```text
automation trigger
  -> data.task.run / cloud.table.process
  -> DataTaskStore 执行 workflow
  -> 写入本地输出表或上传云端表
```

运行期不调用大模型生成 DSL，因此：

- 可预测。
- 可复用。
- 成本低。
- 更适合定时与无人值守场景。

## 11. UI 与 i18n 调整

为匹配技术语义，前端文案需要从“AI 处理”改成“AI 生成任务”：

```text
处理方式：AI 生成任务 | 复用数据任务
```

生成成功提示：

```text
数据任务已生成，后续将复用该任务执行。
```

保留的 i18n key：

| key                   | zh                                     | en                                                     |
| --------------------- | -------------------------------------- | ------------------------------------------------------ |
| `dataProcessModeAi`   | AI 生成任务                            | AI-generated task                                      |
| `dataProcessModeTask` | 复用数据任务                           | Reuse data task                                        |
| `generatedTaskReady`  | 数据任务已生成，后续将复用该任务执行。 | Data task generated. Future runs will reuse this task. |

删除的旧 key：

- `generateTaskHint`
- `zeroTokenRuntime`

## 12. 风险与约束

- 结构化编译器覆盖范围有限，复杂变形需要依赖高级 DSL 兜底。
- 高级 DSL 兜底仍可能失败，因此必须保留诊断信息并阻止不可运行任务保存。
- 字段名称严格来自输入表，用户自然语言中的近义字段不会自动映射到不存在字段。
- 运行期复用数据任务意味着输入表结构变化可能导致任务失效，需要通过 `requiredColumns` 和 `sourceSummaryHash` 做后续风险提示或重新生成判断。

## 13. 验收标准

- AI 生成任务主路径要求模型返回结构化 JSON operations。
- 后端能把 supported operations 编译为 Prep DSL。
- 生成 DSL 必须通过 parser、compiler 和 dry-run 校验后才保存。
- operations 修复路径能携带 diagnostics 再次请求模型。
- unsupported operation 能进入高级 DSL 兜底。
- 高级 DSL 兜底输出仍需通过后端校验。
- 自动化运行期复用生成后的 `taskId`，不重新调用模型生成任务。
- 前端处理方式显示为 `AI 生成任务 | 复用数据任务`。
- 生成成功后显示轻提示：`数据任务已生成，后续将复用该任务执行。`
- i18n 中不保留未使用的 `generateTaskHint` 和 `zeroTokenRuntime`。

## 14. 相关代码

- `src/renderer/components/settings/schedule/editorPanels.tsx`
  - 数据处理动作 UI。
  - 生成成功提示。
  - AI 生成任务 / 复用数据任务模式切换。
- `src/main/data/ipc/data-tasks-ipc.ts`
  - `data.generateTaskFromRequirement` IPC 入口。
- `src/main/data/data-command-service.ts`
  - `generateTaskFromRequirement`
  - `generateWorkflowDslFromRequirement`
  - `repairWorkflowDslFromDiagnostics`
  - `generateAdvancedWorkflowDslFromPlan`
  - `compileGeneratedWorkflowPlan`
  - `parseGeneratedWorkflowDslResponse`
- `src/shared/prep-dsl`
  - Prep DSL 解析、编译和诊断。
- `src/renderer/i18n/locales/zh.json`
- `src/renderer/i18n/locales/en.json`

# Pseudo Tool Use Leak Recovery

## 背景

多轮对话后，模型偶现把内部工具调用格式直接输出到聊天正文：

```xml
<tool_use name="data_list_cloud_tables" id="call_xxx">
{"spaceId":"space-growth","projectId":"project-sales"}
</tool_use>
```

这类内容本应进入结构化 tool call 流程，由 agent runner 执行工具并渲染为工具卡片；实际却被当作普通 assistant 文本展示给用户，形成工具调用协议泄漏。

## 问题分析

正常链路：

```text
模型产生结构化 toolCall
  -> agent runner 收到 toolcall_start / tool_execution_* 事件
  -> UI 展示 tool_use 卡片
  -> 工具执行完成后展示 tool_result
```

异常链路：

```text
模型在 text block 中输出 <tool_use>...</tool_use>
  -> message_end 将其当作普通文本处理
  -> MessageCard 直接渲染 XML 文本
  -> 下一轮上下文可能继续携带该文本，加剧格式模仿
```

该问题不是 Personal Analysis API 或 datasource 逻辑问题，而是模型输出格式与工具调用解析链路不匹配。`data-tool-prompt` 已经提示模型不要写伪工具标记，但 prompt 约束不能完全防止长上下文下的格式漂移。

## 修复目标

1. 不再向用户展示 `<tool_use>...</tool_use>` 内部标记。
2. 对明确安全的只读 data list 工具，尽量恢复为真实工具卡片和工具结果。
3. 不自动执行写入、上传、文件、shell 等有副作用的伪工具调用。
4. 避免 recovered tool result 与 SDK 内部缓存上下文不一致导致后续轮次继续污染。

## 方案

### 1. 新增伪工具调用解析器

新增：

```text
src/main/claude/pseudo-tool-use-parser.ts
```

职责：

- 识别 assistant 文本中的 `<tool_use ...>...</tool_use>`。
- 解析 `name`、`id` 和 JSON input。
- 返回剥离伪工具标记后的 `cleanText`。
- 支持 XML-escaped JSON，例如 `&quot;spaceId&quot;`。
- 没有命中伪工具标记时保持原始文本不变，避免影响普通 assistant 输出。

### 2. message_end 阶段拦截 text block

在 `src/main/claude/agent-runner.ts` 的 `message_end` 处理中：

```text
text block
  -> extractPseudoToolUsesFromText
  -> cleanText 继续走 artifact 提取和普通文本渲染
  -> 合法伪 tool_use 转成结构化 tool_use content block
```

这样 UI 会看到正常工具卡片，而不是 XML 文本。

### 3. 只恢复执行只读 cloud list 工具

当前白名单：

```text
data_list_cloud_spaces
data_list_cloud_projects
data_list_cloud_tables
```

这些工具是只读查询，自动恢复执行风险较低。

不在白名单内的伪工具调用只会被抑制，不会执行。这样避免模型通过文本伪造方式绕过权限或触发有副作用操作，例如上传、删除、shell 命令等。

### 4. 补发 tool_result 并清理 SDK session 缓存

恢复执行后，runner 会：

- 发送 `trace.step`，状态为 running。
- 执行匹配的 custom tool。
- 发送 `trace.update`，标记 completed/error。
- 发送 assistant `tool_result` message。

因为这次执行发生在 SDK 结构化 tool call 流程之外，SDK 内部缓存的会话历史并不知道这条恢复出的工具结果。为避免下一轮继续基于旧上下文漂移，恢复执行后会清理当前 session 的 SDK 缓存：

```text
clearSdkSession(session.id)
```

下一轮会从 DB 中保存的结构化 `tool_use` / `tool_result` 消息重建上下文。

## 安全边界

- 只解析完整、合法的 `<tool_use>` 标签。
- 必须包含非空 `name` 和 `id`。
- body 必须是 JSON object。
- 只允许白名单内只读工具自动执行。
- 未注册工具或执行失败会生成 error tool_result，而不是展示 XML。

## 测试

新增：

```text
tests/pseudo-tool-use-parser.test.ts
```

覆盖：

- 从 assistant 文本中提取伪 tool_use 并清理正文。
- 无伪 tool_use 时保持文本原样。
- 支持 XML-escaped JSON body。

本次验证命令：

```bash
npm test -- --run tests/pseudo-tool-use-parser.test.ts tests/config-store-env.test.ts tests/data-command-service.test.ts tests/personal-analysis-client.test.ts
npm run typecheck
```

## 后续优化

1. 将白名单扩展为工具元数据，例如 `sideEffect: false`，避免在 runner 中硬编码工具名。
2. 在 renderer 层增加最后兜底：即使后端未拦截，也不直接展示 `<tool_use>` 内部标记。
3. 在历史上下文构造层过滤普通 text block 中残留的伪工具标记，进一步降低模型模仿概率。
4. 如果 SDK 后续支持文本工具调用恢复入口，可将当前 runner 内恢复逻辑下沉到统一 tool call parser。

# 会话与 Agent 运行时

会话模块是项目的核心。普通聊天、远程控制和定时任务最终都会走 [`SessionManager`](../../src/main/session/session-manager.ts) 和 [`ClaudeAgentRunner`](../../src/main/claude/agent-runner.ts)。维护时要把“会话生命周期”和“单次模型执行”分开看。

## 核心职责划分

| 文件                                                                                                                     | 职责                                                                           |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [`src/main/session/session-manager.ts`](../../src/main/session/session-manager.ts)                                       | 会话 CRUD、消息/Trace 持久化、提示队列、权限/密码回调、沙盒初始化、附件处理    |
| [`src/main/claude/agent-runner.ts`](../../src/main/claude/agent-runner.ts)                                               | 创建 pi-coding-agent session、模型路由、工具组装、MCP/扩展工具桥接、流事件转换 |
| [`src/main/extensions/agent-runtime-extension.ts`](../../src/main/extensions/agent-runtime-extension.ts)                 | Agent 运行时扩展接口                                                           |
| [`src/main/extensions/agent-runtime-extension-manager.ts`](../../src/main/extensions/agent-runtime-extension-manager.ts) | 合并扩展 promptPrefix 和 customTools，隔离扩展异常                             |
| [`src/main/session/session-title-flow.ts`](../../src/main/session/session-title-flow.ts)                                 | 会话标题生成流程                                                               |
| [`src/main/session/session-title-utils.ts`](../../src/main/session/session-title-utils.ts)                               | 标题 prompt、默认标题和归一化                                                  |
| [`src/main/claude/pi-model-resolution.ts`](../../src/main/claude/pi-model-resolution.ts)                                 | provider/model 到 pi-ai runtime 的解析和 fallback                              |
| [`src/main/claude/pi-session-runtime.ts`](../../src/main/claude/pi-session-runtime.ts)                                   | 运行时签名，用于判断 SDK session 是否要重建                                    |
| [`src/main/claude/think-tag-parser.ts`](../../src/main/claude/think-tag-parser.ts)                                       | Thinking 标签流式解析                                                          |
| [`src/main/claude/agent-runner-loop-guard.ts`](../../src/main/claude/agent-runner-loop-guard.ts)                         | 工具调用循环保护                                                               |
| [`src/main/claude/tool-result-utils.ts`](../../src/main/claude/tool-result-utils.ts)                                     | 工具结果给模型和 UI 的归一化                                                   |

## SessionManager

`SessionManager` 负责“会话级状态”，不是具体模型协议。

关键成员：

- `activeSessions: Map<string, AbortController>`：当前正在执行的会话。
- `promptQueues`：同一会话连续输入时排队，避免并发破坏上下文。
- `pendingPermissions`：等待 UI 返回工具权限决定。
- `pendingSudoPasswords`：等待 UI 返回 sudo 密码。
- `sandboxInitPromises`：同一工作区的沙盒初始化去重。
- `messageCache`：减少频繁从 SQLite 读取消息历史。

关键流程：

1. `startSession(title, prompt, cwd, allowedTools, content, memoryEnabled)` 创建 `Session`，写入 SQLite，然后 `enqueuePrompt`。
2. `continueSession(sessionId, prompt, content)` 加载已有 session，然后 `enqueuePrompt`。
3. `enqueuePrompt` 会把 prompt 放入会话队列；如果该会话当前不在执行，则启动处理。
4. `processPrompt` 会：
   - 初始化沙盒。
   - 处理图片/文件附件，把外部文件复制到工作区 `.tmp`。
   - 同步附件到 WSL/Lima sandbox。
   - 保存用户消息。
   - 读取现有消息历史。
   - 调用 `agentRunner.run(session, prompt, existingMessages)`。
5. `stopSession` 使用 `AbortController` 取消执行，并清理队列、权限和缓存。
6. `deleteSession` 删除 SQLite 会话、消息和 Trace，并通知扩展 `onSessionDeleted`。

维护注意：

- 同一会话的并发输入必须走 `promptQueues`。不要从 UI 或远程控制直接并发调用 runner。
- `sendToRenderer` 被包装过，`trace.step` 和 `trace.update` 会同步写入数据库。
- 附件路径必须经过 basename 处理，避免把用户本地绝对路径暴露给模型。
- 修改会话状态时要同时考虑 SQLite、前端 `session.update`、前端 optimistic message 三者的一致性。

## ClaudeAgentRunner

`ClaudeAgentRunner` 负责“单次 turn 的执行”。它把项目内部概念转换为 pi-coding-agent SDK 能理解的会话、工具和流事件。

主要步骤：

1. 读取 [`configStore`](../../src/main/config/config-store.ts)，解析 provider、model、thinking、token 配置。
2. 通过 `AgentRuntimeExtensionManager.beforeSessionRun` 收集：
   - `MemoryExtension` 的记忆 promptPrefix。
   - `DataAgentRuntimeExtension` 的数据工具 promptPrefix 和 custom tools。
3. 根据是否冷启动重建历史：
   - `serializeMessageContentForHistory` 会保留 `text`、`thinking`、`tool_use`、`tool_result`，避免 provider 在续聊时丢工具上下文。
4. 构建 MCP server 配置和 MCP custom tools。
5. 创建或复用 pi-coding-agent session。
6. 给 built-in bash 工具加两层包装：
   - sudo 命令询问密码。
   - 缺省 timeout，避免命令无限挂起。
7. 安装 permission hook：
   - 先查 [`permission-rules-store`](../../src/main/config/permission-rules-store.ts)。
   - `allow` 直接执行。
   - `deny` 阻断。
   - `ask` 发送 `permission.request` 给渲染端。
8. 消费 SDK stream：
   - 文本 delta -> `stream.partial`。
   - thinking delta -> `stream.thinking`。
   - tool start -> `trace.step`。
   - tool end -> `trace.update` + `stream.message(tool_result)`。
   - message end -> `stream.message(assistant)`。
9. 执行结束后调用 `AgentRuntimeExtensionManager.afterSessionRun`，触发记忆 ingestion。

维护注意：

- 新增会话级能力，优先写 `AgentRuntimeExtension`，不要直接把逻辑塞进 `ClaudeAgentRunner.run`。
- 新增 provider 时要同时检查 `config-store`、`api-model-presets`、`pi-model-resolution`、`useApiConfigState` 和设置 UI。
- 修改工具名时要考虑权限规则、UI label、MCP tool display name、历史消息兼容。
- `LoopGuard` 是防止模型无限工具调用的重要保护，不要绕过。

## AgentRuntimeExtension

扩展接口定义在 [`src/main/extensions/agent-runtime-extension.ts`](../../src/main/extensions/agent-runtime-extension.ts)：

- `beforeSessionRun(context)`：返回 `promptPrefix` 和 `customTools`。
- `afterSessionRun(context)`：主模型执行结束后处理，例如 memory ingestion。
- `onSessionDeleted(context)`：会话删除时清理外部状态。

当前注册的扩展在 [`main/index.ts`](../../src/main/index.ts)：

- [`MemoryExtension`](../../src/main/memory/memory-extension.ts)：注入历史记忆，执行后异步提取。
- [`createDataAgentRuntimeExtension`](../../src/main/data/data-agent-extension.ts)：注入数据工具说明和数据 custom tools。

扩展合并规则：

- 多个 `promptPrefix` 用空行拼接。
- custom tools 按工具名去重，后注册的同名工具会覆盖前者并记录 warning。
- 单个扩展异常不会中断其它扩展。

## 消息和 Trace

消息类型在 [`src/renderer/types/index.ts`](../../src/renderer/types/index.ts)：

- `Message.role`: `user`、`assistant`、`system`。
- `ContentBlock`: `text`、`image`、`file_attachment`、`tool_use`、`tool_result`、`thinking`。
- `TraceStep`: `thinking`、`text`、`tool_call`、`tool_result`。

UI 渲染路径：

- [`useIPC`](../../src/renderer/hooks/useIPC.ts) 接收 `ServerEvent`。
- 高频 `stream.partial`、`stream.thinking`、`trace.step/update` 用 `requestAnimationFrame` 批处理，降低 React 重渲染压力。
- 状态进入 [`sessionStates`](../../src/renderer/store/index.ts)。
- [`ChatView`](../../src/renderer/components/ChatView.tsx) 合成 streaming message。
- [`MessageCard`](../../src/renderer/components/MessageCard.tsx) 和 [`ContentBlockView`](../../src/renderer/components/message/ContentBlockView.tsx) 渲染内容块。

维护注意：

- 工具结果可能和工具调用不在同一条消息里，`ToolUseBlock` 会跨 session messages 查找匹配结果。
- Orphan `tool_result` 由 `ToolResultBlock` 兜底渲染。
- 文件链接和数据资源链接在 `ContentBlockView` 中被规范化并转成按钮，不应让任意 `file://` 或不安全协议直接导航。

## 权限和 sudo

权限默认规则在 [`src/shared/permission-policies.ts`](../../src/shared/permission-policies.ts)。

主进程使用 [`permission-rules-store`](../../src/main/config/permission-rules-store.ts) 做同步决策：

- renderer 中的 settings 是源头，但主进程 tool hook 需要同步读取。
- `settings.update` 会把 `permissionRules` 发送到主进程。
- 主进程会 sanitize renderer payload，非法 action 回退 `ask`。
- “always allow” 是 session-scoped，删除会话或停止时要清理。

sudo 密码流程：

1. `ClaudeAgentRunner` 包装 bash tool。
2. 发现 sudo 命令时调用 `SessionManager.requestSudoPassword`。
3. 主进程发送 `sudo.password.request`。
4. UI 弹出 [`SudoPasswordDialog`](../../src/renderer/components/SudoPasswordDialog.tsx)。
5. 用户响应经 `sudo.password.response` 回主进程。

## 标题生成

标题生成分两类：

- 普通会话标题：`maybeGenerateSessionTitle` 会在会话启动后基于 prompt 尝试生成。
- 定时任务标题：`ScheduledTaskManager` 执行前可能调用 `resolveScheduledTaskTitle`，复用会话标题生成。

相关测试：

- [`tests/session-title-flow.test.ts`](../../tests/session-title-flow.test.ts)
- [`tests/session-title-utils.test.ts`](../../tests/session-title-utils.test.ts)
- [`tests/session-manager-title-unified.test.ts`](../../tests/session-manager-title-unified.test.ts)
- [`tests/session-title-flow-abort.test.ts`](../../tests/session-title-flow-abort.test.ts)

## 常见修改场景

### 新增一个会话级工具

1. 如果工具只给某一业务域使用，写一个 `AgentRuntimeExtension`。
2. 用 `TypeBox` 定义 input schema。
3. 在 `beforeSessionRun` 返回 `customTools`。
4. 工具内部调用 service，不直接写数据库散逻辑。
5. 在权限默认规则中决定是否 allow/ask。
6. 给工具结果补 UI 展示或 `DataLinkedText` 解析。
7. 增加 service 测试和 `data-agent-extension` 类测试。

### 修改消息结构

1. 先改 `ContentBlock` 类型。
2. 改 `serializeMessageContentForHistory`，确保冷启动历史可重放。
3. 改 SQLite 读写兼容旧数据。
4. 改 `ContentBlockView` 和相关 message block。
5. 覆盖历史消息、streaming、工具结果合并测试。

### 修改队列或停止逻辑

重点跑：

- [`tests/session-manager-queue-concurrency.test.ts`](../../tests/session-manager-queue-concurrency.test.ts)
- [`tests/session-manager-crud.test.ts`](../../tests/session-manager-crud.test.ts)
- [`tests/chat-view-stop-entry.test.ts`](../../tests/chat-view-stop-entry.test.ts)
- [`tests/use-ipc-session-start-error-handling.test.ts`](../../tests/use-ipc-session-start-error-handling.test.ts)

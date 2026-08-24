# 远程控制、定时任务与记忆

远程控制、定时任务和记忆都不是独立 Agent。远程控制和定时任务复用 `SessionManager` 执行任务，记忆通过 `AgentRuntimeExtension` 注入和提取上下文。

## 远程控制

代码位于 [`src/main/remote`](../../src/main/remote)，UI 位于 [`RemoteControlPanel`](../../src/renderer/components/RemoteControlPanel.tsx)。

### 架构

```text
Remote channel
  -> ChannelBase subclass
  -> RemoteGateway
  -> MessageRouter
  -> RemoteManager
  -> AgentExecutor(SessionManager)
  -> response buffer
  -> Channel send
```

核心文件：

| 文件                                                                                       | 职责                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [`remote-manager.ts`](../../src/main/remote/remote-manager.ts)                             | 整合 Gateway、channels、MessageRouter，维护远程会话映射和 pending interactions |
| [`gateway.ts`](../../src/main/remote/gateway.ts)                                           | HTTP/WebSocket 控制平面、webhook 路由、认证、配对                              |
| [`message-router.ts`](../../src/main/remote/message-router.ts)                             | 远程消息排队、session key、工作目录解析、调用 Agent callback                   |
| [`remote-config-store.ts`](../../src/main/remote/remote-config-store.ts)                   | encrypted 远程配置、配对用户、迁移                                             |
| [`tunnel-manager.ts`](../../src/main/remote/tunnel-manager.ts)                             | ngrok/frp/cloudflare tunnel 状态和启动                                         |
| [`remote-title.ts`](../../src/main/remote/remote-title.ts)                                 | 远程会话标题                                                                   |
| [`channels/channel-base.ts`](../../src/main/remote/channels/channel-base.ts)               | channel 抽象、长消息切分、错误事件                                             |
| [`channels/feishu`](../../src/main/remote/channels/feishu)                                 | 飞书 API、webhook、WebSocket 长连接                                            |
| [`channels/dingtalk`](../../src/main/remote/channels/dingtalk)                             | 钉钉 Stream/Webhook 接收、sessionWebhook 与机器人 OpenAPI                      |
| [`channels/slack/slack-channel.ts`](../../src/main/remote/channels/slack/slack-channel.ts) | Slack bot/socket/webhook                                                       |

### RemoteManager

[`RemoteManager`](../../src/main/remote/remote-manager.ts) 的关键职责：

- `setAgentExecutor`：由主进程注入 `SessionManager` 包装的 executor。
- `start` / `stop` / `restart`：启动 gateway、channel 和 tunnel。
- 管理远程 session ID 和真实 session ID 映射。
- 管理 channel/session/owner 映射，用于把回复发回正确平台。
- 维护 pending question/permission interactions。
- 缓冲 assistant partial 和 tool steps，降低远程平台刷屏。
- 配对用户和 pending pairing 操作。

AgentExecutor 接口：

- `startSession(title, prompt, cwd)`
- `continueSession(sessionId, prompt, content, cwd)`
- `stopSession(sessionId)`
- `validateWorkingDirectory(cwd)`

注意：远程控制不应该直接调用 `ClaudeAgentRunner`。

### RemoteGateway

[`RemoteGateway`](../../src/main/remote/gateway.ts) 做协议入口：

- 创建 HTTP server 和 WebSocket server。
- `/ws` 支持 WebSocket 客户端。
- webhook 路由到已注册 channel。
- 按 gateway auth config 做认证：
  - token
  - allowlist
  - pairing
  - open
- 管理 pairing request 和 paired users。
- 调 `MessageRouter.routeMessage`。
- 接收 `MessageRouter` response 并调用 channel `send`。

安全点：

- WebSocket auth 有简单 rate limiting。
- channel message 会先检查授权，再交给 interaction interceptor 或 Agent。
- 飞书 webhook signature 必须校验。
- Slack signature 有 5 分钟 replay 防护。

### MessageRouter

[`MessageRouter`](../../src/main/remote/message-router.ts) 负责把远程平台消息映射成 Agent 会话：

- DM session key：`<channelType>:dm:<userId>`。
- 群 session key：`<channelType>:group:<channelId>`。
- 每个 session key 对应一个 `RemoteSessionMapping`。
- 每个远程 session 有队列，避免同一远程会话并发执行。
- 支持默认工作目录和相对 cwd 解析。
- 定时清理 stale sessions。

维护注意：

- 远程工作目录必须通过 `validateWorkingDirectory` 和 workspace path 解析。
- 群聊和 DM 的 session key 不一样，不要混用 userId/channelId。
- 远程平台的 content 需要转换为内部 `ContentBlock[]`。

### Channels

所有 channel 继承 [`ChannelBase`](../../src/main/remote/channels/channel-base.ts)：

- `start`
- `stop`
- `send`
- `onMessage`
- `onError`

Feishu：

- [`feishu-channel.ts`](../../src/main/remote/channels/feishu/feishu-channel.ts)
- [`feishu-api.ts`](../../src/main/remote/channels/feishu/feishu-api.ts)
- [`feishu-ws-client.ts`](../../src/main/remote/channels/feishu/feishu-ws-client.ts)

支持：

- webhook 模式。
- WebSocket 长连接模式。
- bot 信息获取。
- DM/group 消息解析。
- 发送文本/富文本。
- signature 校验。

Slack：

- [`slack-channel.ts`](../../src/main/remote/channels/slack/slack-channel.ts)
- lazy import `@slack/bolt` 和 `@slack/web-api`。
- 支持 socket mode 和 webhook mode。
- 自动过滤 bot 消息和自身消息。
- group 需要 mention。

DingTalk：

- 使用官方 `dingtalk-stream` SDK 建立 Stream 长连接，不要求公网回调地址。
- 也可使用应用内机器人的 HTTP/Webhook 模式，公网入口为 `/webhook/dingtalk`；该模式需要 HTTPS 公网地址，可复用内置 ngrok 隧道。
- Webhook 按钉钉协议校验 `timestamp` 和 `sign` 请求头：签名为以 AppSecret 为 key、对 `timestamp + "\n" + AppSecret` 计算的 HMAC-SHA256 Base64 值；超过一小时的请求会被拒绝。
- Webhook 收到合法请求后立即返回空 JSON ACK，异步回复继续复用 `sessionWebhook` 或机器人 OpenAPI，避免等待模型执行导致平台超时。
- 回调入队后立即 ACK，并按 Stream message ID 与机器人 message ID 去重。
- 回复优先使用当前会话的 `sessionWebhook`，失效后降级到机器人 OpenAPI。
- 群聊与私聊目标分别编码为 `group:<conversationId>` 和 `dm:<senderStaffId>`。
- 当前接收文本消息；图片、文件和互动卡片留待统一媒体管线接入。

### 远程 UI

[`RemoteControlPanel`](../../src/renderer/components/RemoteControlPanel.tsx) 负责：

- 加载 config/status/paired users/pending pairings/tunnel/webhook URL。
- 5 秒轮询状态。
- 启停 gateway。
- 保存 gateway、Feishu 和 DingTalk 配置。
- 配对 approve/reject/revoke。
- 拆分配置步骤：
  - [`FeishuConfigStep`](../../src/renderer/components/remote/FeishuConfigStep.tsx)
  - [`ConnectionConfigStep`](../../src/renderer/components/remote/ConnectionConfigStep.tsx)
  - [`AdvancedConfigStep`](../../src/renderer/components/remote/AdvancedConfigStep.tsx)
  - [`GatewayControlCard`](../../src/renderer/components/remote/GatewayControlCard.tsx)
  - [`AuthorizedUsersSection`](../../src/renderer/components/remote/AuthorizedUsersSection.tsx)
  - [`PairingRequestsSection`](../../src/renderer/components/remote/PairingRequestsSection.tsx)

相关测试：

- [`tests/remote-manager-port-conflict.test.ts`](../../tests/remote-manager-port-conflict.test.ts)
- [`tests/remote-cwd-state.test.ts`](../../tests/remote-cwd-state.test.ts)
- [`tests/remote-cwd-propagation.test.ts`](../../tests/remote-cwd-propagation.test.ts)
- [`tests/remote-default-workdir.test.ts`](../../tests/remote-default-workdir.test.ts)
- [`tests/remote-control-panel-links.test.ts`](../../tests/remote-control-panel-links.test.ts)
- [`tests/remote-user-message-ui.test.ts`](../../tests/remote-user-message-ui.test.ts)

## 定时任务

代码位于 [`src/main/schedule`](../../src/main/schedule)，UI 位于 [`SettingsSchedule`](../../src/renderer/components/settings/SettingsSchedule.tsx)，页面入口是 [`AutomationView`](../../src/renderer/components/AutomationView.tsx)。

### ScheduledTaskManager

[`ScheduledTaskManager`](../../src/main/schedule/scheduled-task-manager.ts) 负责：

- 定时任务 CRUD。
- 支持一次性、interval、daily、weekly。
- 根据 `nextRunAt` 创建 timer。
- 处理超长 delay，按 `MAX_TIMER_DELAY_MS` clamp。
- 防止同一个 task 并发执行。
- 记录 `lastRunAt`、`lastRunSessionId`、`lastError`。
- 计算下一次执行时间。

任务执行由主进程注入：

```text
ScheduledTaskManager.executeTask
  -> 校验 cwd
  -> 生成或修正标题
  -> sessionManager.startSession(title, prompt, cwd)
  -> send session.update 给渲染端
```

### ScheduledTaskStore

[`scheduled-task-store.ts`](../../src/main/schedule/scheduled-task-store.ts) 用 `DatabaseInstance.scheduledTasks` 访问 SQLite。

SQLite 表在 [`database.ts`](../../src/main/db/database.ts)：

- `scheduled_tasks`
- `idx_scheduled_tasks_next_run`

### UI

[`SettingsSchedule`](../../src/renderer/components/settings/SettingsSchedule.tsx) 是一个紧凑的自动化任务页面：

- 汇总卡片：total、enabled、running、today。
- 搜索和分页。
- 新增/编辑表单。
- 标题内联编辑。
- once/daily/weekly/interval 模式。
- run now、toggle、delete。
- 5 秒轮询刷新状态。

维护注意：

- 一次性任务过期后不能直接重新 enable，需要用户编辑时间。
- `runNow` 不改变原 schedule 配置，但会记录执行结果。
- 定时任务启动的 session 不会经过用户主动点击，所以必须由主进程推 `session.update` 插入前端列表。
- 标题生成失败要有 fallback。

相关测试：

- [`tests/scheduled-task-manager.test.ts`](../../tests/scheduled-task-manager.test.ts)
- [`tests/scheduled-task-edge-cases.test.ts`](../../tests/scheduled-task-edge-cases.test.ts)
- [`tests/scheduled-task-session-title-entry.test.ts`](../../tests/scheduled-task-session-title-entry.test.ts)
- [`tests/schedule-task-title.test.ts`](../../tests/schedule-task-title.test.ts)
- [`tests/settings-panel-schedule-entry.test.ts`](../../tests/settings-panel-schedule-entry.test.ts)

## 记忆

记忆代码位于 [`src/main/memory`](../../src/main/memory)，UI 位于 [`SettingsMemory`](../../src/renderer/components/settings/SettingsMemory.tsx)。

### 目标

记忆模块把历史会话提炼为：

- Core memory：长期偏好、稳定事实、全局记忆。
- Experience memory：会话经验、工作区相关知识、chunk。

在新会话开始前，记忆模块检索相关内容并生成 promptPrefix 注入主模型。会话结束后，后台提取和更新记忆。

### 核心文件

| 文件                                                                                     | 职责                                                             |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`memory-service.ts`](../../src/main/memory/memory-service.ts)                           | 总服务，路径管理、overview、search/read、promptPrefix、ingestion |
| [`memory-extension.ts`](../../src/main/memory/memory-extension.ts)                       | AgentRuntimeExtension，负责 before/after/session delete hook     |
| [`memory-llm-client.ts`](../../src/main/memory/memory-llm-client.ts)                     | LLM 调用适配                                                     |
| [`core-memory-store.ts`](../../src/main/memory/core-memory-store.ts)                     | Core memory JSON store                                           |
| [`experience-memory-store.ts`](../../src/main/memory/experience-memory-store.ts)         | Experience memory JSON store                                     |
| [`core-memory-extractor.ts`](../../src/main/memory/core-memory-extractor.ts)             | Core memory 提取                                                 |
| [`experience-memory-extractor.ts`](../../src/main/memory/experience-memory-extractor.ts) | 会话经验和 chunk 提取                                            |
| [`memory-retriever.ts`](../../src/main/memory/memory-retriever.ts)                       | 搜索和读取                                                       |
| [`memory-navigator.ts`](../../src/main/memory/memory-navigator.ts)                       | progressive retrieval 导航                                       |
| [`memory-ingestion-queue.ts`](../../src/main/memory/memory-ingestion-queue.ts)           | 异步 ingestion 队列                                              |
| [`memory-tools.ts`](../../src/main/memory/memory-tools.ts)                               | 给模型使用的记忆工具定义                                         |
| [`memory-state-store.ts`](../../src/main/memory/memory-state-store.ts)                   | 每个 session 的 ingestion 状态                                   |
| [`memory-eval-harness.ts`](../../src/main/memory/memory-eval-harness.ts)                 | 记忆评估工具                                                     |

### MemoryService

[`MemoryService`](../../src/main/memory/memory-service.ts) 主要能力：

- `isEnabled` / `setEnabled`。
- `getOverview(cwd)`：UI 概览和统计。
- `search(params)` / `read(id)`。
- `buildPromptPrefix(session, prompt)`：会话前注入。
- `enqueueIngestion({ session, prompt, messages })`：执行后异步提取。
- `rebuildWorkspace(cwd)`、`clearWorkspace(cwd)`、`rebuildAll()`、`clearCoreMemory()`。
- `listFiles()`、`readFile()`、`inspectSession()`：debug UI。
- `deleteSession(sessionId)`：会话删除时清理 experience/state。

路径安全：

- `storageRoot` 不能是文件系统根。
- `evalArtifactsRoot` 必须在 `storageRoot` 下。
- 使用 materialized real path 校验，防止 symlink 绕过。

### MemoryExtension

[`MemoryExtension`](../../src/main/memory/memory-extension.ts)：

- `beforeSessionRun`：如果全局 memory 和 session memory 都启用，则返回 `promptPrefix`。
- `afterSessionRun`：会话结束后入队 ingestion。
- `onSessionDeleted`：删除 session 相关记忆。

### UI

[`SettingsMemory`](../../src/renderer/components/settings/SettingsMemory.tsx) 提供：

- 开关。
- storage path 和文件列表。
- 搜索 core/experience/current workspace/all。
- 读取详情。
- inspect session。
- 重建当前工作区。
- 重建全部。
- 清空当前工作区。
- 清空 Core memory。
- 配置 memory runtime。

手动 smoke checklist 见 [`docs/memory-live-smoke-checklist.md`](../memory-live-smoke-checklist.md)。

相关测试：

- [`src/tests/memory/memory-service.test.ts`](../../src/tests/memory/memory-service.test.ts)
- [`src/tests/memory/core-memory-store.test.ts`](../../src/tests/memory/core-memory-store.test.ts)
- [`src/tests/memory/memory-llm-client.test.ts`](../../src/tests/memory/memory-llm-client.test.ts)
- [`src/tests/memory/memory-eval-harness.test.ts`](../../src/tests/memory/memory-eval-harness.test.ts)
- [`src/tests/memory/memory-integration-files.test.ts`](../../src/tests/memory/memory-integration-files.test.ts)
- [`tests/memory-manager-no-fts.test.ts`](../../tests/memory-manager-no-fts.test.ts)

# 整体架构

九思助理是 Electron 桌面应用，主进程负责本地能力、持久化、安全边界和 Agent 运行，渲染端负责工作台 UI。项目不是一个普通网页应用，维护时要始终区分“渲染端状态”和“主进程真实能力”。

## 分层结构

```text
用户
  -> React Renderer 工作台
  -> Preload 安全桥 window.electronAPI
  -> Electron Main IPC handlers
  -> 主进程服务层
       SessionManager / ClaudeAgentRunner
       ConfigStore / MCPManager / SkillsManager
       DataCommandService / DataTaskStore
       SandboxAdapter / RemoteManager / ScheduledTaskManager / MemoryService
  -> 本地存储、沙盒、MCP servers、模型 API、远程平台
```

关键边界：

- `src/renderer` 只能通过 `window.electronAPI` 调用主进程能力。
- `src/preload/index.ts` 是渲染端唯一的 Electron 能力入口，必须保持 allowlist。
- `src/main/index.ts` 是服务装配和 IPC hub，不应无限堆业务逻辑。新增复杂业务应放进对应 service。
- `src/shared` 放可被主进程、预加载脚本、渲染端共同引用的纯类型或纯函数。

## 启动流程

主入口是 [`src/main/index.ts`](../../src/main/index.ts)。

1. 读取 `.env`，再用 [`configStore.applyToEnv`](../../src/main/config/config-store.ts) 覆盖运行时环境。
2. 禁用硬件加速，配置 Electron app 生命周期。
3. `app.whenReady()` 后初始化持久化和服务：
   - [`initDatabase`](../../src/main/db/database.ts) 打开 `userData/data/cowork.db`。
   - [`createDataTaskStore`](../../src/main/data/data-task-store.ts) 创建数据工作区 store，主流程传入 SQLite 作为数据任务 metadata store，并使用 `userData/data/workspace.duckdb` 存放真实数据表。
   - [`UpdateService`](../../src/main/update/update-service.ts) 初始化在线更新。
   - [`PluginRuntimeService`](../../src/main/skills/plugin-runtime-service.ts)、[`MemoryService`](../../src/main/memory/memory-service.ts)、[`DataCommandService`](../../src/main/data/data-command-service.ts) 和 [`DataToolService`](../../src/main/data/data-tool-service.ts) 初始化。
   - [`AgentRuntimeExtensionManager`](../../src/main/extensions/agent-runtime-extension-manager.ts) 注册记忆和数据工具扩展。
   - [`SessionManager`](../../src/main/session/session-manager.ts) 初始化会话管理，并在内部初始化 MCP。
   - [`SkillsManager`](../../src/main/skills/skills-manager.ts) 加载内置和全局 Skills，并监听存储变化。
   - [`ScheduledTaskManager`](../../src/main/schedule/scheduled-task-manager.ts) 启动定时任务。
   - [`remoteManager`](../../src/main/remote/remote-manager.ts) 在配置启用时启动远程控制。
4. 创建 [`BrowserWindow`](../../src/main/index.ts)，使用 preload、禁用 `nodeIntegration`、启用 `contextIsolation` 和 `sandbox`。
5. 启动 [`nav-server`](../../src/main/nav-server.ts)，供外部工具通过本机 HTTP 导航 UI。

维护建议：新增服务时应放在 `app.whenReady()` 的服务装配区，明确它依赖哪些已有服务，并考虑关闭时是否需要 cleanup。

## IPC 事件模型

项目同时使用两类 IPC：

- 事件式：渲染端通过 `window.electronAPI.send(ClientEvent)` 发出，主进程通过 `server-event` 推送 [`ServerEvent`](../../src/renderer/types/index.ts)。
- 调用式：渲染端通过 `window.electronAPI.invoke(ClientEvent)` 或命名 API 调用主进程 handler，适合需要返回值的场景。

核心定义：

- [`ClientEvent`](../../src/renderer/types/index.ts) 包括 `session.start`、`session.continue`、`permission.response`、`workdir.set` 等。
- [`ServerEvent`](../../src/renderer/types/index.ts) 包括 `stream.message`、`stream.partial`、`trace.step`、`permission.request`、`config.status`、`sandbox.sync` 等。
- [`src/shared/ipc-types.ts`](../../src/shared/ipc-types.ts) 放 MCP 和远程控制等无法直接从 `main` 引入的结构化类型。

新增 IPC 的标准步骤：

1. 在共享类型中声明输入输出结构。
2. 在 [`preload`](../../src/preload/index.ts) 暴露最小 API，必要时加入 allowlist。
3. 在 [`main/index.ts`](../../src/main/index.ts) 注册 handler，并把业务委托给 service。
4. 在渲染端封装 hook 或组件调用，不要散落复杂 IPC 逻辑。
5. 增加 IPC 或 service 测试。

## 主要数据流

### 聊天会话

```text
ChatView / WelcomeView
  -> useIPC.startSession / continueSession
  -> preload allowlist
  -> main handleClientEvent
  -> SessionManager
  -> ClaudeAgentRunner
  -> pi-coding-agent + MCP + custom tools + sandbox
  -> stream/trace ServerEvent
  -> useIPC RAF batch
  -> Zustand sessionStates
  -> ChatView / MessageCard
```

### 数据页

```text
DataView
  -> window.electronAPI.data.*
  -> main data.* IPC handlers
  -> DataTaskStore / DataCommandService
  -> SQLite metadata + DuckDB table data + normalizer project files
  -> DataView lists, preview table, workflow editor
```

### 远程控制

```text
Feishu / Slack / WebSocket
  -> RemoteGateway
  -> MessageRouter
  -> RemoteManager.executeAgent
  -> SessionManager.startSession / continueSession
  -> Agent stream events
  -> RemoteManager buffered response
  -> channel.send
```

### 定时任务

```text
SettingsSchedule
  -> schedule.* IPC
  -> ScheduledTaskManager
  -> timer trigger
  -> SessionManager.startSession
  -> session.update 推送到渲染端列表
```

### 记忆注入

```text
ClaudeAgentRunner.beforeSessionRun
  -> AgentRuntimeExtensionManager
  -> MemoryExtension.beforeSessionRun
  -> MemoryService.buildPromptPrefix
  -> promptPrefix 注入主模型

ClaudeAgentRunner after run
  -> MemoryExtension.afterSessionRun
  -> MemoryService.enqueueIngestion
  -> Core/Experience extraction and stores
```

## 持久化地图

| 数据                                   | 存储                                                                 | 代码                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 会话、消息、Trace、定时任务、Skills 表 | SQLite `userData/data/cowork.db`                                     | [`src/main/db/database.ts`](../../src/main/db/database.ts)                                   |
| 数据任务元数据                         | 主流程下通过 `metadataDb` 落在 SQLite；无 `metadataDb` 时回落 DuckDB | [`src/main/data/data-task-store.ts`](../../src/main/data/data-task-store.ts)                 |
| 导入表、输出表、流程中间表             | DuckDB `userData/data/workspace.duckdb`                              | [`src/main/data/data-task-store.ts`](../../src/main/data/data-task-store.ts)                 |
| API 配置和配置集                       | encrypted `electron-store`                                           | [`src/main/config/config-store.ts`](../../src/main/config/config-store.ts)                   |
| MCP 配置                               | `electron-store`                                                     | [`src/main/mcp/mcp-config-store.ts`](../../src/main/mcp/mcp-config-store.ts)                 |
| 远程控制配置和配对用户                 | encrypted `electron-store`                                           | [`src/main/remote/remote-config-store.ts`](../../src/main/remote/remote-config-store.ts)     |
| 插件注册信息                           | `electron-store`                                                     | [`src/main/skills/plugin-registry-store.ts`](../../src/main/skills/plugin-registry-store.ts) |
| Memory JSON 文件                       | `userData/memory` 或配置中的 `memoryRuntime.storageRoot`             | [`src/main/memory/memory-service.ts`](../../src/main/memory/memory-service.ts)               |
| 日志                                   | app log directory                                                    | [`src/main/utils/logger.ts`](../../src/main/utils/logger.ts)                                 |

## 共享代码边界

`src/shared` 中的代码必须是平台中立、无 Electron runtime 副作用的逻辑：

- [`prep-dsl`](../../src/shared/prep-dsl)：数据流程 DSL。
- [`permission-policies.ts`](../../src/shared/permission-policies.ts)：权限策略默认规则。
- [`api-model-presets.ts`](../../src/shared/api-model-presets.ts)：模型 preset。
- [`workspace-path.ts`](../../src/shared/workspace-path.ts)、[`local-file-path.ts`](../../src/shared/local-file-path.ts)：路径解析工具。
- [`data-resource-link.ts`](../../src/shared/data-resource-link.ts)：消息中的数据资源链接协议。

如果共享代码开始 import `electron`、`fs` 或主进程 service，说明边界已经错了。

## 维护原则

- 主进程能力优先封装成 service，`main/index.ts` 只做装配和 IPC 转发。
- 渲染端不要直接拼接文件系统路径执行敏感操作，应交给 preload + main 做校验。
- 类型契约优先放在 `renderer/types` 或 `shared`，不要让主进程和渲染端各写一份不同结构。
- Agent 运行时扩展优先走 `AgentRuntimeExtension`，避免硬改 `ClaudeAgentRunner.run`。
- 新 UI 必须遵循 [`UI_STYLE_GUIDE.md`](../../UI_STYLE_GUIDE.md)，保持紧凑操作台样式。

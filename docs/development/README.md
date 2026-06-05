# 开发维护架构入口

本文档面向刚接手项目的新开发者，帮助快速理解九思助理桌面端的功能模块、代码边界、数据流和维护落点。所有路径均相对仓库根目录。

## 建议阅读顺序

1. [整体架构](./architecture-overview.md)：先理解 Electron 主进程、预加载脚本、React 渲染端、共享类型和持久化层的分工。
2. [会话与 Agent 运行时](./runtime-and-sessions.md)：理解一次用户请求如何进入 `SessionManager`、如何被 Agent SDK 执行、如何流式回到 UI。
3. [渲染端工作台](./renderer-ui.md)：理解 `App`、Zustand、`useIPC`、聊天视图、数据页、设置页和 UI 风格边界。
4. [数据工作区](./data-workspace.md)：理解数据任务、输入表、输出表、Prep DSL、DuckDB 表数据和 Agent 数据工具。
5. [能力扩展与安全边界](./capabilities-sandbox-mcp-skills.md)：理解沙盒、工具执行、权限、MCP、Skills 和插件。
6. [远程控制、定时任务与记忆](./remote-schedule-memory.md)：理解非聊天入口如何复用会话运行时。
7. [配置、存储、更新与启动辅助](./config-storage-update.md)：理解配置集、数据库、日志、自动更新和导航服务。
8. [测试与维护指南](./testing-maintenance.md)：按模块查找测试、添加功能时的检查清单和常见风险。

## 模块导航

| 模块            | 主要代码                                                                                                                                                               | 说明                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Electron 主入口 | [`src/main/index.ts`](../../src/main/index.ts)                                                                                                                         | 应用生命周期、窗口、IPC handler、服务初始化、更新、远程控制、定时任务启动 |
| 预加载桥        | [`src/preload/index.ts`](../../src/preload/index.ts)                                                                                                                   | `contextBridge` 暴露受控 `window.electronAPI`，隔离渲染端和主进程         |
| 渲染根组件      | [`src/renderer/App.tsx`](../../src/renderer/App.tsx)                                                                                                                   | 单页工作台路由、懒加载视图、全局弹窗和主题                                |
| 全局状态        | [`src/renderer/store/index.ts`](../../src/renderer/store/index.ts)                                                                                                     | Zustand session state、布局、设置、通知、沙盒状态                         |
| IPC 类型        | [`src/renderer/types/index.ts`](../../src/renderer/types/index.ts), [`src/shared/ipc-types.ts`](../../src/shared/ipc-types.ts)                                         | ClientEvent、ServerEvent、配置、数据、远程控制类型                        |
| 会话管理        | [`src/main/session/session-manager.ts`](../../src/main/session/session-manager.ts)                                                                                     | 会话 CRUD、消息持久化、队列、沙盒初始化、权限回调                         |
| Agent 执行      | [`src/main/claude/agent-runner.ts`](../../src/main/claude/agent-runner.ts)                                                                                             | pi-coding-agent 会话、模型路由、工具、MCP、Skills、流事件                 |
| 配置管理        | [`src/main/config/config-store.ts`](../../src/main/config/config-store.ts)                                                                                             | API provider、模型、配置集、主题、沙盒、记忆配置                          |
| SQLite 存储     | [`src/main/db/database.ts`](../../src/main/db/database.ts)                                                                                                             | 会话、消息、Trace、Skills、定时任务、数据任务元数据                       |
| 数据工作区      | [`src/main/data/data-task-store.ts`](../../src/main/data/data-task-store.ts), [`src/renderer/components/DataView.tsx`](../../src/renderer/components/DataView.tsx)     | 数据任务、输入/输出表、DuckDB 表、流程图、DSL                             |
| Prep DSL        | [`src/shared/prep-dsl`](../../src/shared/prep-dsl)                                                                                                                     | 数据流程文本 DSL 的 AST、解析、校验、导出和编译                           |
| 沙盒            | [`src/main/sandbox`](../../src/main/sandbox)                                                                                                                           | WSL/Lima/native 执行适配、路径转换、文件同步                              |
| MCP             | [`src/main/mcp/mcp-manager.ts`](../../src/main/mcp/mcp-manager.ts)                                                                                                     | MCP server 生命周期、工具发现和工具调用                                   |
| Skills/插件     | [`src/main/skills`](../../src/main/skills)                                                                                                                             | 内置/全局 Skills 发现、插件安装、运行时 materialize                       |
| 远程控制        | [`src/main/remote`](../../src/main/remote), [`src/renderer/components/RemoteControlPanel.tsx`](../../src/renderer/components/RemoteControlPanel.tsx)                   | Gateway、Feishu/Slack channel、远程会话映射、配对和 UI                    |
| 定时任务        | [`src/main/schedule`](../../src/main/schedule), [`src/renderer/components/settings/SettingsSchedule.tsx`](../../src/renderer/components/settings/SettingsSchedule.tsx) | 定时任务 CRUD、执行计时器、自动创建会话                                   |
| 记忆            | [`src/main/memory`](../../src/main/memory), [`src/renderer/components/settings/SettingsMemory.tsx`](../../src/renderer/components/settings/SettingsMemory.tsx)         | Core memory、experience memory、检索、注入、后台 ingestion                |
| UI 风格         | [`UI_STYLE_GUIDE.md`](../../UI_STYLE_GUIDE.md), [`src/renderer/styles/globals.css`](../../src/renderer/styles/globals.css)                                             | 紧凑操作台视觉规范、主题 token、全局组件风格                              |

## 新功能落点速查

- 新增一个主进程能力：先定义共享类型，再在 `preload` 暴露受控方法，最后在 `src/main/index.ts` 注册 IPC handler。
- 新增一个会话内 Agent 工具：优先通过 [`AgentRuntimeExtensionManager`](../../src/main/extensions/agent-runtime-extension-manager.ts) 注入 `promptPrefix` 和 `customTools`，不要直接修改渲染端消息结构。
- 新增数据处理能力：优先扩展 `DataCommandService`、`DataToolService` 和 Prep DSL，再让 `DataView` 调用已有 IPC。
- 新增页面或改造 UI：必须遵循 [`UI_STYLE_GUIDE.md`](../../UI_STYLE_GUIDE.md)，保持紧凑、克制、数据操作台风格。
- 涉及文件或命令执行：必须经过工作区路径校验、权限策略和沙盒适配层。
- 涉及远程、定时或记忆：不要复制 Agent 执行逻辑，应复用 `SessionManager.startSession` / `continueSession`。

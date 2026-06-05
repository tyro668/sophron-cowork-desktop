# 渲染端工作台

渲染端是 React + Vite + Tailwind + Zustand。它不是业务能力的真实执行层，主要负责工作台布局、状态展示、用户输入、IPC 调用和本地交互反馈。

## 入口和应用框架

| 文件                                                                       | 说明                                                                    |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`src/renderer/main.tsx`](../../src/renderer/main.tsx)                     | React 挂载入口，桥接 renderer 日志到主进程                              |
| [`src/renderer/App.tsx`](../../src/renderer/App.tsx)                       | 根组件、主视图切换、主题、全局弹窗、沙盒状态 Toast                      |
| [`src/renderer/store/index.ts`](../../src/renderer/store/index.ts)         | Zustand store，保存 session、UI、settings、working dir、全局通知        |
| [`src/renderer/store/selectors.ts`](../../src/renderer/store/selectors.ts) | 细粒度 selector，减少流式消息造成的重渲染                               |
| [`src/renderer/hooks/useIPC.ts`](../../src/renderer/hooks/useIPC.ts)       | IPC listener 单例、事件批处理、session action 封装                      |
| [`src/preload/index.ts`](../../src/preload/index.ts)                       | `window.electronAPI` 定义，不属于 renderer bundle，但决定 UI 可调用能力 |

## 主视图结构

[`App`](../../src/renderer/App.tsx) 使用一个 `mainView` 状态和 `activeSessionId` 决定当前主区域：

- `showSettings` 为 true：显示 [`SettingsPanel`](../../src/renderer/components/SettingsPanel.tsx)。
- `mainView === 'skills'`：显示 [`SkillsView`](../../src/renderer/components/SkillsView.tsx)。
- `mainView === 'automation'`：显示 [`AutomationView`](../../src/renderer/components/AutomationView.tsx)。
- 有 `activeSessionId`：显示 [`ChatView`](../../src/renderer/components/ChatView.tsx)，并在右侧显示 [`ContextPanel`](../../src/renderer/components/ContextPanel.tsx)。
- `mainView === 'data'`：显示 [`DataView`](../../src/renderer/components/DataView.tsx)。
- 其它情况：显示 [`WelcomeView`](../../src/renderer/components/WelcomeView.tsx)。

懒加载组件都包在 [`PanelErrorBoundary`](../../src/renderer/components/PanelErrorBoundary.tsx) 中，单个面板崩溃不应拖垮整个应用。

## Zustand 状态模型

[`useAppStore`](../../src/renderer/store/index.ts) 的重要状态：

- `sessions`：左侧会话列表。
- `activeSessionId`：当前会话。
- `sessionStates`：按 sessionId 保存消息、partial、thinking、trace、pending turns 和执行时钟。
- `mainView`、`showSettings`、`settingsTab`：主视图导航。
- `settings`：UI 设置、权限策略、全局 skills path、memory strategy。
- `appConfig`、`isConfigured`：API provider 配置快照。
- `workingDir`：当前工作区。
- `sandboxSetupProgress`、`sandboxSyncStatus`：沙盒启动和同步状态。
- `pendingDataNavigation`：消息内数据资源链接跳转到 DataView 的桥。

维护注意：

- 高频消息流不要直接订阅整个 store，应使用 [`selectors.ts`](../../src/renderer/store/selectors.ts) 中的 selector。
- `sessionStates` 是按会话隔离的统一状态，新增会话内 UI 状态优先放这里，不要新增一堆平行 map。
- `applySessionUpdate` 允许主进程对前端没有的 session 发送完整 `session.update` 并插入列表，定时任务依赖这一点。

## IPC Hook

[`useIPC`](../../src/renderer/hooks/useIPC.ts) 是渲染端和主进程的主要桥：

- 使用 module-level `ipcListenerInstalled`，确保只有第一个 `useIPC()` 安装 `server-event` listener。
- 对 `stream.partial`、`stream.thinking`、Trace 事件做 RAF batching。
- 初始化时并行拉取 `config.get`、`config.isConfigured`、`getSystemTheme`。
- 启动后把 renderer 中的 `permissionRules` 同步给主进程。
- 封装 `startSession`、`continueSession`、`stopSession`、`listSessions` 等方法。

维护注意：

- 不要在多个组件中手写 `window.electronAPI.on` 监听 `server-event`，会破坏单槽 listener。
- `startSession` 和 `continueSession` 都有 optimistic user message。改后端事件时要检查 UI 是否重复插入或漏插入消息。
- Browser mode mock 仍存在，用于非 Electron 环境预览；新增字段时也要给 mock session 填安全默认值。

## Preload API

[`src/preload/index.ts`](../../src/preload/index.ts) 暴露 `window.electronAPI`：

- `send` / `invoke` 只允许 `ALLOWED_CLIENT_EVENTS` 中的事件。
- `openExternal` 只允许 `http:`、`https:`、`mailto:`，并清理 mailto 附件参数。
- `data`、`config`、`mcp`、`skills`、`plugins`、`sandbox`、`logs`、`remote`、`schedule`、`memory` 是命名 API。
- `onInputTableNormalizerDraftProgress`、`update.onState` 这类长期监听返回 cleanup。

新增 preload API 时：

1. 先确认是否可以复用已有 `send/invoke`。
2. 命名 API 应返回结构化 Promise，不直接暴露 `ipcRenderer`。
3. 对路径、URL、事件名做最小权限暴露。
4. 更新类型声明区，避免 `window.electronAPI` 变成隐式 any。

## 会话 UI

### Sidebar

[`Sidebar`](../../src/renderer/components/Sidebar.tsx) 负责：

- 会话列表、搜索、按日期分组。
- 批量删除。
- 主视图导航：data、skills、automation、settings。
- 点击会话时懒加载消息和 Trace。
- 主题切换和更新提示。

注意：点击会话时读取 store 的当前状态，而不是闭包里的 `sessionStates`，避免流式消息导致 callback 高频重建。

### ChatView

[`ChatView`](../../src/renderer/components/ChatView.tsx) 负责：

- prompt 输入、IME composition、拖拽/粘贴图片、文件附件。
- 模型配置集切换。
- MCP connector 状态摘要。
- pending turns、running 状态、stop 按钮。
- 自动滚动和“回到顶部/底部”控制。
- 合成 streaming message。

注意：

- 附件在 UI 中保留路径和可选 inline base64，真正落盘由 `SessionManager.processFileAttachments` 做。
- 正在执行或已有 pending turn 时，新的 user message 标记为 `queued`。
- 自动滚动逻辑依赖多个 ref，改消息列表布局时要验证长会话和 streaming。

### MessageCard 和内容块

消息渲染拆分如下：

- [`MessageCard`](../../src/renderer/components/MessageCard.tsx)：区分 user/assistant，合并 tool result。
- [`ContentBlockView`](../../src/renderer/components/message/ContentBlockView.tsx)：按 block type 派发，处理 Markdown 链接、文件链接、数据资源链接、KaTeX。
- [`ToolUseBlock`](../../src/renderer/components/message/ToolUseBlock.tsx)：工具调用卡片，跨消息匹配 tool_result。
- [`ToolResultBlock`](../../src/renderer/components/message/ToolResultBlock.tsx)：孤立工具结果兜底。
- [`ThinkingBlock`](../../src/renderer/components/message/ThinkingBlock.tsx)：thinking 内容。
- [`AskUserQuestionBlock`](../../src/renderer/components/message/AskUserQuestionBlock.tsx)、[`TodoWriteBlock`](../../src/renderer/components/message/TodoWriteBlock.tsx)：特殊工具 UI。

安全规则：

- Markdown 链接只允许安全外链、工作区内文件链接或数据资源链接。
- 工具输出图片只允许安全 MIME 类型：png、jpeg、gif、webp。
- 文件打开优先走 `showItemInFolder` 或 `openGeneratedReport`，不要让渲染端直接导航到本地文件。

## DataView

[`DataView`](../../src/renderer/components/DataView.tsx) 是数据工作台，功能较重：

- 任务、输入表、输出表三类 tab。
- 统计卡片、搜索、分页、批量删除。
- 输入表导入、配置、预览。
- 自定义 normalizer 生成、代码预览、版本发布。
- 任务编辑器、React Flow 流程图、operator palette。
- Prep DSL dialog，支持 DSL 导入/导出和节点配置摘要。
- 数据资源链接跳转。

维护建议：

- 新增数据业务逻辑时，优先放在 `DataCommandService` 或 `DataTaskStore`，`DataView` 只做 UI 状态和 API 调用。
- `DataView` 内有大量局部 helper，改 operator 类型时要同时修改 operator catalog、summary、配置面板、DSL parse/export、后端执行。
- 该页面是 UI 风格基准，新增页面应参考它的紧凑行高、统计卡片和表格密度。

## Settings

设置页由 [`SettingsPanel`](../../src/renderer/components/SettingsPanel.tsx) 统一装配：

- [`SettingsAPI`](../../src/renderer/components/settings/SettingsAPI.tsx)：API provider、模型、配置集。
- [`SettingsSandbox`](../../src/renderer/components/settings/SettingsSandbox.tsx)：WSL/Lima/native 状态和安装动作。
- [`SettingsConnectors`](../../src/renderer/components/settings/SettingsConnectors.tsx)：MCP server 配置、状态和工具列表。
- [`SettingsMemory`](../../src/renderer/components/settings/SettingsMemory.tsx)：记忆开关、检索、重建、清理、debug 文件。
- [`RemoteControlPanel`](../../src/renderer/components/RemoteControlPanel.tsx)：远程控制配置。
- [`SettingsLogs`](../../src/renderer/components/settings/SettingsLogs.tsx)：日志查看、导出、清理。
- [`SettingsGeneral`](../../src/renderer/components/settings/SettingsGeneral.tsx)：通用信息。

`SettingsPanel` 会记录已访问 tab，只对已访问 tab 懒加载内容，避免初始化时同时请求过多主进程 API。

## 样式系统

必须遵循 [`UI_STYLE_GUIDE.md`](../../UI_STYLE_GUIDE.md)。

主要实现：

- [`src/renderer/styles/globals.css`](../../src/renderer/styles/globals.css) 定义深色/浅色 CSS token、全局字体和组件基础类。
- [`tailwind.config.js`](../../tailwind.config.js) 把 CSS variables 映射成 Tailwind color token。
- 公共控件包括 [`GlassSelect`](../../src/renderer/components/GlassSelect.tsx)、[`GlassDropdownMenu`](../../src/renderer/components/GlassDropdownMenu.tsx)、[`GlassDataGridPreview`](../../src/renderer/components/GlassDataGridPreview.tsx)。

新增或修改页面时：

- 字号默认 12-14px，控件高度 32-36px。
- 使用 `text-text-primary`、`text-text-secondary`、`text-text-muted`，不要硬编码黑灰。
- 表格、列表、统计卡片保持高信息密度。
- 不做营销页、hero、装饰性大卡片。
- 不要卡片套卡片。

## 渲染端测试落点

常用测试：

- [`tests/chat-view-width-layout.test.ts`](../../tests/chat-view-width-layout.test.ts)
- [`tests/chat-view-stop-entry.test.ts`](../../tests/chat-view-stop-entry.test.ts)
- [`tests/message-card-file-attachment-layout.test.ts`](../../tests/message-card-file-attachment-layout.test.ts)
- [`tests/message-card-citation-link-normalization.test.ts`](../../tests/message-card-citation-link-normalization.test.ts)
- [`tests/message-card-ask-user-question-state.test.ts`](../../tests/message-card-ask-user-question-state.test.ts)
- [`tests/sidebar-active-session.test.ts`](../../tests/sidebar-active-session.test.ts)
- [`tests/main-view-navigation.test.ts`](../../tests/main-view-navigation.test.ts)
- [`tests/app-layout-scroll-lock.test.ts`](../../tests/app-layout-scroll-lock.test.ts)
- [`tests/provider-guidance-ui.test.ts`](../../tests/provider-guidance-ui.test.ts)
- [`tests/settings-panel-plugin-entry.test.ts`](../../tests/settings-panel-plugin-entry.test.ts)
- [`tests/settings-panel-schedule-entry.test.ts`](../../tests/settings-panel-schedule-entry.test.ts)
- [`tests/dark-theme-palette.test.ts`](../../tests/dark-theme-palette.test.ts)

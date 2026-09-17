# 测试与维护指南

本项目测试覆盖主进程服务、渲染端组件逻辑、路径安全、数据 DSL、配置、远程控制、记忆和构建脚本。新增功能时应按影响范围选择测试，而不是只跑一个全量命令。

## 常用命令

```bash
npm run typecheck
npm run test
npm run lint
npm run pre-build-check
```

按文件跑 Vitest：

```bash
npx vitest run tests/session-manager-crud.test.ts
npx vitest run tests/data-command-service.test.ts
npx vitest run tests/prep-dsl/parser-compiler.test.ts
```

开发启动：

```bash
npm run dev
```

带 Python 准备：

```bash
npm run dev:with-python
```

## 模块测试索引

### 会话和 Agent

- [`tests/session-manager-crud.test.ts`](../../tests/session-manager-crud.test.ts)
- [`tests/session-manager-queue-concurrency.test.ts`](../../tests/session-manager-queue-concurrency.test.ts)
- [`tests/session-manager-message-cache.test.ts`](../../tests/session-manager-message-cache.test.ts)
- [`tests/session-manager-title-unified.test.ts`](../../tests/session-manager-title-unified.test.ts)
- [`tests/agent-runner-loop-guard.test.ts`](../../tests/agent-runner-loop-guard.test.ts)
- [`tests/agent-runner-loop-guard-abort.test.ts`](../../tests/agent-runner-loop-guard-abort.test.ts)
- [`tests/agent-runner-message-end.test.ts`](../../tests/agent-runner-message-end.test.ts)
- [`src/tests/agent/agent-runner-history-rebuild.test.ts`](../../src/tests/agent/agent-runner-history-rebuild.test.ts)
- [`tests/pi-model-resolution.test.ts`](../../tests/pi-model-resolution.test.ts)
- [`tests/pi-session-runtime.test.ts`](../../tests/pi-session-runtime.test.ts)
- [`tests/think-tag-parser.test.ts`](../../tests/think-tag-parser.test.ts)
- [`tests/tool-result-utils.test.ts`](../../tests/tool-result-utils.test.ts)

### IPC 和渲染端

- [`tests/use-ipc-config-modal-gate.test.ts`](../../tests/use-ipc-config-modal-gate.test.ts)
- [`tests/use-ipc-session-start-error-handling.test.ts`](../../tests/use-ipc-session-start-error-handling.test.ts)
- [`tests/session-update-event.test.ts`](../../tests/session-update-event.test.ts)
- [`tests/main-view-navigation.test.ts`](../../tests/main-view-navigation.test.ts)
- [`tests/sidebar-active-session.test.ts`](../../tests/sidebar-active-session.test.ts)
- [`src/tests/renderer/sidebar-session-click.test.ts`](../../src/tests/renderer/sidebar-session-click.test.ts)
- [`tests/chat-view-stop-entry.test.ts`](../../tests/chat-view-stop-entry.test.ts)
- [`tests/chat-view-width-layout.test.ts`](../../tests/chat-view-width-layout.test.ts)
- [`tests/message-card-file-attachment-layout.test.ts`](../../tests/message-card-file-attachment-layout.test.ts)
- [`tests/message-card-link-handling.test.ts`](../../tests/message-card-link-handling.test.ts)
- [`tests/message-markdown-katex.test.ts`](../../tests/message-markdown-katex.test.ts)
- [`tests/renderer-crash-safety.test.ts`](../../src/tests/renderer-crash-safety.test.ts)

### 数据工作区

- [`tests/data-command-service.test.ts`](../../tests/data-command-service.test.ts)
- [`tests/data-tool-service.test.ts`](../../tests/data-tool-service.test.ts)
- [`tests/data-agent-extension.test.ts`](../../tests/data-agent-extension.test.ts)
- [`tests/data-tool-prompt.test.ts`](../../tests/data-tool-prompt.test.ts)
- [`tests/data-duckdb-store.test.ts`](../../tests/data-duckdb-store.test.ts)
- [`tests/data-operator-dsl-execution.test.ts`](../../tests/data-operator-dsl-execution.test.ts)
- [`tests/input-table-normalizer.test.ts`](../../tests/input-table-normalizer.test.ts)
- [`tests/prep-dsl/parser-compiler.test.ts`](../../tests/prep-dsl/parser-compiler.test.ts)
- [`tests/prep-dsl/operator-dsl-cases.test.ts`](../../tests/prep-dsl/operator-dsl-cases.test.ts)
- [`tests/prep-dsl/reference.test.ts`](../../tests/prep-dsl/reference.test.ts)
- [`tests/data-resource-link-navigation.test.ts`](../../tests/data-resource-link-navigation.test.ts)

### 沙盒、路径和工具

- [`tests/path-containment.test.ts`](../../src/tests/path-containment.test.ts)
- [`tests/path-resolver-containment.test.ts`](../../tests/path-resolver-containment.test.ts)
- [`tests/path-guard-command-conversion.test.ts`](../../tests/path-guard-command-conversion.test.ts)
- [`tests/workspace-path.test.ts`](../../src/tests/workspace-path.test.ts)
- [`tests/workspace-path-constraints.test.ts`](../../tests/workspace-path-constraints.test.ts)
- [`tests/sandbox-command-injection.test.ts`](../../tests/sandbox-command-injection.test.ts)
- [`tests/sandbox-executor-containment.test.ts`](../../tests/sandbox-executor-containment.test.ts)
- [`tests/tool-executor-sandbox.test.ts`](../../tests/tool-executor-sandbox.test.ts)
- [`tests/tool-executor-unc-paths.test.ts`](../../tests/tool-executor-unc-paths.test.ts)
- [`tests/tool-output-path.test.ts`](../../tests/tool-output-path.test.ts)

### MCP、Skills 和插件

- [`src/tests/mcp/mcp-manager.test.ts`](../../src/tests/mcp/mcp-manager.test.ts)
- [`tests/mcp-npx-resolution.test.ts`](../../tests/mcp-npx-resolution.test.ts)
- [`tests/mcp-manager-env-merge.test.ts`](../../tests/mcp-manager-env-merge.test.ts)
- [`tests/mcp-tool-name.test.ts`](../../tests/mcp-tool-name.test.ts)
- [`tests/plugin-runtime-service.test.ts`](../../tests/plugin-runtime-service.test.ts)
- [`tests/plugin-catalog-service.test.ts`](../../tests/plugin-catalog-service.test.ts)
- [`tests/plugin-catalog-dev-impl.test.ts`](../../tests/plugin-catalog-dev-impl.test.ts)
- [`tests/skills-manager-storage-path.test.ts`](../../tests/skills-manager-storage-path.test.ts)
- [`tests/skills-manager-plugin-install.test.ts`](../../tests/skills-manager-plugin-install.test.ts)
- [`src/tests/skills/dangling-symlink.test.ts`](../../src/tests/skills/dangling-symlink.test.ts)

### 远程、定时和记忆

- [`tests/remote-manager-port-conflict.test.ts`](../../tests/remote-manager-port-conflict.test.ts)
- [`tests/remote-cwd-state.test.ts`](../../tests/remote-cwd-state.test.ts)
- [`tests/remote-cwd-propagation.test.ts`](../../tests/remote-cwd-propagation.test.ts)
- [`tests/remote-default-workdir.test.ts`](../../tests/remote-default-workdir.test.ts)
- [`tests/remote-user-message-ui.test.ts`](../../tests/remote-user-message-ui.test.ts)
- [`tests/scheduled-task-manager.test.ts`](../../tests/scheduled-task-manager.test.ts)
- [`tests/scheduled-task-edge-cases.test.ts`](../../tests/scheduled-task-edge-cases.test.ts)
- [`tests/scheduled-task-session-title-entry.test.ts`](../../tests/scheduled-task-session-title-entry.test.ts)
- [`src/tests/memory/memory-service.test.ts`](../../src/tests/memory/memory-service.test.ts)
- [`src/tests/memory/core-memory-store.test.ts`](../../src/tests/memory/core-memory-store.test.ts)
- [`src/tests/memory/memory-llm-client.test.ts`](../../src/tests/memory/memory-llm-client.test.ts)

### 配置、日志、构建

- [`tests/config-store-config-sets.test.ts`](../../tests/config-store-config-sets.test.ts)
- [`tests/config-store-profiles.test.ts`](../../tests/config-store-profiles.test.ts)
- [`tests/config-store-env.test.ts`](../../tests/config-store-env.test.ts)
- [`tests/api-diagnostics.test.ts`](../../tests/api-diagnostics.test.ts)
- [`tests/api-config-state.test.ts`](../../tests/api-config-state.test.ts)
- [`tests/logger-level-persistence.test.ts`](../../tests/logger-level-persistence.test.ts)
- [`tests/database-path-recovery.test.ts`](../../tests/database-path-recovery.test.ts)
- [`tests/nav-server-session-id-validation.test.ts`](../../tests/nav-server-session-id-validation.test.ts)
- [`src/tests/pre-build-check.test.ts`](../../src/tests/pre-build-check.test.ts)
- [`tests/build-windows-script.test.ts`](../../tests/build-windows-script.test.ts)
- [`tests/bundle-mcp-script.test.ts`](../../tests/bundle-mcp-script.test.ts)

## 新增功能检查清单

### 新增或修改用户可见文案

1. 按照 [`src/renderer/i18n/README.md`](../../src/renderer/i18n/README.md) 使用项目原生 i18n，不在业务代码中硬编码用户可见文案。
2. 渲染进程使用 `useTranslation()` 和 `t()`，不要在组件内维护双语常量或直接读取 locale JSON。
3. 主进程、preload 和远程通道不得导入浏览器专用的 `src/renderer/i18n/config.ts`；根据明确的语言上下文读取现有 locale 资源。
4. 新增或修改翻译 key 时，同步更新 `en.json`、`zh.json`，并确认两份文件层级一致。
5. 为本地化行为补充中英文测试；用户可见错误、Toast 和机器人回复同样适用。

### 新增主进程 API

1. 定义类型：`src/renderer/types/index.ts` 或 `src/shared/ipc-types.ts`。
2. 暴露 preload API：`src/preload/index.ts`。
3. 注册 IPC handler：`src/main/index.ts`。
4. 业务逻辑放 service，不把复杂逻辑写在 handler 中。
5. 渲染端封装 hook 或组件调用。
6. 增加主进程 handler/service 测试。
7. 检查错误是否被转换为 UI 可理解的通知。

### 新增 Agent 工具

1. 优先通过 `AgentRuntimeExtension` 注入。
2. 定义 TypeBox schema。
3. 写 service 方法，避免工具直接操作存储细节。
4. 决定权限默认规则。
5. 设计工具结果文本，必要时输出数据资源链接。
6. 更新 message/tool UI label。
7. 增加工具服务测试和权限测试。

### 新增数据 operator

1. 更新共享类型和 renderer 类型。
2. 更新 Prep DSL parser/validator/exporter/compiler。
3. 更新 `DataTaskStore` SQL 编译和执行。
4. 更新 `DataView` operator catalog、配置面板、摘要、预览。
5. 更新 `docs/prep-dsl-reference.md`。
6. 跑 `tests/prep-dsl/*` 和数据执行测试。

### 新增页面或修改页面

1. 遵循 [`UI_STYLE_GUIDE.md`](../../UI_STYLE_GUIDE.md)。
2. 使用现有 `GlassSelect`、`GlassDropdownMenu`、主题 token 和 lucide icons。
3. 避免大标题、hero、营销式布局。
4. 使用 selector 降低重渲染。
5. 检查 800px 宽度和 1100px 宽度下的布局。
6. 增加渲染端测试。

### 修改路径、沙盒或命令执行

1. 明确输入来自 renderer、Agent、远程平台还是本地配置。
2. 路径必须做 containment 检查。
3. 命令必须经过权限策略。
4. WSL、Lima、native 三种模式都要考虑。
5. 跑路径和 sandbox 测试。

## 常见风险

- `useIPC` listener 被重复安装或被后来的组件卸载清理，导致主进程事件丢失。
- `main/index.ts` 增长过快，新逻辑没有抽 service。
- 数据模块 metadata 和 DuckDB 表数据不同步。
- 新 provider 只改了 UI，没有改 config store、auth utils、诊断或 pi model resolution。
- 新工具没有权限规则，未知工具默认 ask 但 UI label 不友好。
- 本地文件链接没有经过 workspace 解析和协议限制。
- 沙盒 fallback native 后假设仍在隔离环境内。
- 远程群聊和 DM session key 混淆。
- 定时任务启动的 session 没有推送到 renderer 会话列表。
- Memory storage root 或 eval artifacts root 配置不安全。

## 手动验收建议

涉及 UI 的改动：

1. 启动 `npm run dev`。
2. 选择工作区，启动一次普通聊天。
3. 切换 Data、Skills、Automation、Settings。
4. 检查窗口宽度 800px、1100px、1400px。
5. 检查浅色和深色主题。

涉及 Agent 执行：

1. 新会话一次。
2. 同一会话连续发送两条，确认排队。
3. 停止执行，确认 pending 消息清理。
4. 触发一个读工具和一个写/编辑/bash 权限请求。
5. 检查 Trace 和消息历史重新打开后仍在。

涉及数据：

1. 导入 CSV。
2. 预览输入表。
3. 创建任务和简单 workflow。
4. 运行任务并查看输出表。
5. 用 DSL 导出再导入。
6. 删除输入/输出/任务，确认列表和表数据一致。

涉及远程/定时/记忆：

- 远程控制参考 `RemoteControlPanel` 的配置步骤和实际平台回调。
- 定时任务至少测试 run now 和一次未来时间触发。
- 记忆参考 [`docs/memory-live-smoke-checklist.md`](../memory-live-smoke-checklist.md)。

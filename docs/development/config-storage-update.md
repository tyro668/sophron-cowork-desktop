# 配置、存储、更新与启动辅助

本篇说明应用的配置持久化、数据库、日志、更新、导航服务和打包辅助。它们通常不直接影响单个功能页面，但会影响所有模块的运行环境。

## 配置管理

主要文件：

- [`src/main/config/config-store.ts`](../../src/main/config/config-store.ts)
- [`src/main/config/auth-utils.ts`](../../src/main/config/auth-utils.ts)
- [`src/main/config/config-test-routing.ts`](../../src/main/config/config-test-routing.ts)
- [`src/main/config/api-diagnostics.ts`](../../src/main/config/api-diagnostics.ts)
- [`src/main/config/ollama-api.ts`](../../src/main/config/ollama-api.ts)
- [`src/shared/api-model-presets.ts`](../../src/shared/api-model-presets.ts)
- [`src/shared/api-provider-guidance.ts`](../../src/shared/api-provider-guidance.ts)

[`configStore`](../../src/main/config/config-store.ts) 用 encrypted `electron-store` 保存 `AppConfig`。

重要配置：

- `provider`：openrouter、anthropic、custom、openai、deepseek、moonshot、aliyun、zai、gemini、ollama。
- `activeProfileKey`：当前 provider profile。
- `profiles`：每个 provider 的 apiKey、baseUrl、model、contextWindow、maxTokens。
- `activeConfigSetId` 和 `configSets`：最多 20 个配置集。
- `defaultWorkdir`。
- `globalSkillsPath`。
- `enableDevLogs`。
- `theme`。
- `sandboxEnabled`。
- `memoryEnabled` 和 `memoryRuntime`。
- `enableThinking`。
- `isConfigured`。

主进程配置变更流程：

1. UI 调 `window.electronAPI.config.save` 或配置集 API。
2. `main/index.ts` 中对应 handler 调 `configStore.update/createSet/renameSet/deleteSet/switchSet`。
3. `syncConfigAfterMutation`：
   - 根据是否有可用凭据更新 `isConfigured`。
   - `configStore.applyToEnv()`。
   - 判断 Agent runtime 签名是否变化。
   - 需要时调用 `sessionManager.reloadConfig()`。
   - sandboxEnabled 变化时调用 `sessionManager.reloadSandbox()`。
   - 发送 `config.status` 给 renderer。

渲染端配置 UI：

- [`ConfigModal`](../../src/renderer/components/ConfigModal.tsx) 是首次配置和全局弹窗。
- [`SettingsAPI`](../../src/renderer/components/settings/SettingsAPI.tsx) 是设置页 API tab。
- [`useApiConfigState`](../../src/renderer/hooks/useApiConfigState.ts) 管理 provider/profile/config set 本地状态、测试、诊断和保存。
- [`ApiConfigSetManager`](../../src/renderer/components/ApiConfigSetManager.tsx) 管理配置集切换/新增/重命名/删除。

维护注意：

- 新增 provider 要同时改主进程类型、renderer 类型、shared presets、UI option、auth normalization、诊断逻辑和测试。
- API key 相关日志必须脱敏。
- Ollama 允许空 key，部分 Anthropic/Gemini 兼容本地网关也允许特殊空 key，需走 `auth-utils`。
- 配置集切换要处理 unsaved changes。

相关测试：

- [`tests/config-store-config-sets.test.ts`](../../tests/config-store-config-sets.test.ts)
- [`tests/config-store-profiles.test.ts`](../../tests/config-store-profiles.test.ts)
- [`tests/config-store-env.test.ts`](../../tests/config-store-env.test.ts)
- [`tests/config-test-routing.test.ts`](../../tests/config-test-routing.test.ts)
- [`tests/api-diagnostics.test.ts`](../../tests/api-diagnostics.test.ts)
- [`tests/api-config-state.test.ts`](../../tests/api-config-state.test.ts)
- [`tests/api-config-state-config-sets.test.ts`](../../tests/api-config-state-config-sets.test.ts)
- [`tests/ollama-api.test.ts`](../../tests/ollama-api.test.ts)
- [`tests/ollama-discovery.test.ts`](../../tests/ollama-discovery.test.ts)

## 数据库

[`src/main/db/database.ts`](../../src/main/db/database.ts) 用 `better-sqlite3` 管理通用 SQLite 数据库。

路径：

- Electron `app.getPath('userData')`
- 数据库目录：`userData/data`
- 数据库文件：`cowork.db`

Schema：

- `sessions`
- `messages`
- `trace_steps`
- `memory_entries`
- `skills`
- `scheduled_tasks`

初始化特性：

- WAL mode。
- foreign keys。
- `ensureColumn` 做安全列迁移。
- 数据库路径冲突或 legacy SQLite 文件会尝试备份/恢复。
- `DatabaseInstance` 暴露 typed table operation，同时保留 `prepare/exec/pragma` 兼容高级查询。

维护注意：

- 新增列请用 `ensureColumn`，不要无校验拼接 SQL。
- 动态 update 要 validate identifier。
- 大数据表不要放进 SQLite；数据工作区实际表应使用 DuckDB。
- 会话删除依赖 foreign key cascade 和显式清理 Trace/消息。

相关测试：

- [`tests/database-path-recovery.test.ts`](../../tests/database-path-recovery.test.ts)
- [`tests/session-manager-crud.test.ts`](../../tests/session-manager-crud.test.ts)
- [`tests/session-manager-message-cache.test.ts`](../../tests/session-manager-message-cache.test.ts)

## 日志

日志工具在 [`src/main/utils/logger.ts`](../../src/main/utils/logger.ts)。

能力：

- app log file path。
- logs directory。
- all log files。
- export、open、clear。
- developer logs enabled 开关。
- log context 和 traceId。

IPC：

- `logs.getPath`
- `logs.getDirectory`
- `logs.getAll`
- `logs.export`
- `logs.open`
- `logs.clear`
- `logs.setEnabled`
- `logs.isEnabled`
- `logs.write`

渲染端：

- [`src/renderer/main.tsx`](../../src/renderer/main.tsx) 会把部分 console 日志写到主进程 logs。
- [`SettingsLogs`](../../src/renderer/components/settings/SettingsLogs.tsx) 提供日志 UI。

相关测试：

- [`tests/logger-level-persistence.test.ts`](../../tests/logger-level-persistence.test.ts)
- [`tests/logger-context.test.ts`](../../tests/logger-context.test.ts)
- [`tests/logger-fallback.test.ts`](../../tests/logger-fallback.test.ts)

## 更新服务

[`UpdateService`](../../src/main/update/update-service.ts) 包装 `electron-updater`。

行为：

- 非 packaged build 状态为 `unsupported`。
- `autoDownload = false`，用户触发后下载。
- `autoInstallOnAppQuit = false`。
- 支持 `SOPHRON_UPDATE_CHANNEL`: stable、beta、canary。
- 支持 `SOPHRON_UPDATE_URL`，但只接受 HTTPS。
- `update.state` 推送给 renderer。
- 下载完成后调用 `beforeInstall` 清理，再 `quitAndInstall`。

UI：

- [`Sidebar`](../../src/renderer/components/Sidebar.tsx) 获取 update state 并显示更新 badge。

维护注意：

- 安装前清理要 best effort，不应阻断安装。
- 不要在开发模式误报可更新。
- 自定义 update URL 必须 HTTPS。

相关测试：

- [`tests/app-startup-lazy-load.test.ts`](../../tests/app-startup-lazy-load.test.ts)
- 更新设计文档见 [`design/update/electron-online-update-design.md`](../../design/update/electron-online-update-design.md)。

## Nav Server

[`nav-server.ts`](../../src/main/nav-server.ts) 在 `127.0.0.1:19888` 启动本地 HTTP 服务，供外部工具导航 UI。

接口：

- `GET /status`
- `GET /navigate?page=welcome`
- `GET /navigate?page=data`
- `GET /navigate?page=skills`
- `GET /navigate?page=automation`
- `GET /navigate?page=settings&tab=api|sandbox|connectors|skills|remote|logs|general`
- `GET /navigate?page=session&id=<sessionId>`

实现方式：

- 主进程通过 `BrowserWindow.webContents.executeJavaScript` 调 renderer 注入的 `window.__navigate`。
- `sessionId` 只允许 `[0-9a-zA-Z_-]{1,128}`。
- `executeJavaScript` 有 3 秒 timeout。
- server `unref()`，不阻止 app 退出。

renderer 侧函数在 [`src/renderer/store/index.ts`](../../src/renderer/store/index.ts) 中挂载：

- `window.__navigate`
- `window.__getNavStatus`

相关测试：

- [`tests/nav-server-session-id-validation.test.ts`](../../tests/nav-server-session-id-validation.test.ts)
- [`tests/index-file-navigation-handling.test.ts`](../../tests/index-file-navigation-handling.test.ts)
- [`tests/main-view-navigation.test.ts`](../../tests/main-view-navigation.test.ts)

## Preflight

[`preflight.ts`](../../src/main/preflight.ts) 只在 packaged 模式运行，用于检查关键资源是否存在。

检查内容：

- GUI MCP server。
- 平台对应 bundled Node。
- WSL/Lima agent。
- built-in skills。

结果按 critical/warning 记录日志。新增打包资源时应考虑是否加入 preflight。

## 打包和脚本

重要脚本见 [`package.json`](../../package.json)：

- `npm run dev`：下载 Node、构建 WSL/Lima agent、构建 MCP、启动 Vite。
- `npm run build`：通过 `scripts/build-brands.js all` 构建品牌包。
- `npm run build:sophron` / `build:sophron-cn`：品牌构建。
- `npm run build:win`：Windows 构建。
- `npm run build:wsl-agent` / `build:lima-agent`：沙盒 agent 构建。
- `npm run build:mcp`：打包 MCP servers。
- `npm run pre-build-check`：构建前检查。
- `npm run typecheck`、`npm run test`、`npm run lint`。

关键构建脚本：

- [`scripts/download-node.js`](../../scripts/download-node.js)：下载 bundled Node。
- [`scripts/bundle-mcp.js`](../../scripts/bundle-mcp.js)：打包内置 MCP server。
- [`scripts/build-brands.js`](../../scripts/build-brands.js)：多品牌构建。
- [`scripts/build-windows.js`](../../scripts/build-windows.js)：Windows 构建入口。
- [`scripts/prepare-python.js`](../../scripts/prepare-python.js)：准备 bundled Python。
- [`scripts/prepare-gui-tools.js`](../../scripts/prepare-gui-tools.js)：准备 GUI 操作工具。
- [`scripts/pre-build-check.js`](../../scripts/pre-build-check.js)：构建前校验。
- [`scripts/after-pack.js`](../../scripts/after-pack.js)：electron-builder afterPack。
- [`scripts/notarize.js`](../../scripts/notarize.js)：macOS notarization。

相关测试：

- [`tests/pre-build-check.test.ts`](../../src/tests/pre-build-check.test.ts)
- [`tests/build-windows-script.test.ts`](../../tests/build-windows-script.test.ts)
- [`tests/bundle-mcp-script.test.ts`](../../tests/bundle-mcp-script.test.ts)
- [`tests/dev-script-guard.test.ts`](../../tests/dev-script-guard.test.ts)
- [`tests/vite-config-watch-ignore.test.ts`](../../tests/vite-config-watch-ignore.test.ts)
- [`tests/windows-installer-process.test.ts`](../../tests/windows-installer-process.test.ts)

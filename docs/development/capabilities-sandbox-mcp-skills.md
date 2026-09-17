# 能力扩展与安全边界

本项目的本地能力主要来自沙盒执行、MCP 外部工具、Skills/插件和权限系统。维护这些模块时要先确认执行边界，再考虑功能实现。

## 沙盒执行

沙盒代码在 [`src/main/sandbox`](../../src/main/sandbox)。

目标：

- Windows 优先使用 WSL2。
- macOS 优先使用 Lima。
- Linux 或用户禁用沙盒时使用 native executor。
- 对外提供统一的 `SandboxExecutor` 接口：执行命令、读写文件、列目录、建目录、路径转换和关闭。

关键文件：

| 文件                                                                  | 职责                                               |
| --------------------------------------------------------------------- | -------------------------------------------------- |
| [`sandbox-adapter.ts`](../../src/main/sandbox/sandbox-adapter.ts)     | 平台选择、初始化、fallback、统一代理               |
| [`wsl-bridge.ts`](../../src/main/sandbox/wsl-bridge.ts)               | WSL 状态检查、依赖安装、agent 通信、路径转换       |
| [`lima-bridge.ts`](../../src/main/sandbox/lima-bridge.ts)             | Lima 实例创建/启动、依赖安装、agent 通信、路径转换 |
| [`native-executor.ts`](../../src/main/sandbox/native-executor.ts)     | native fallback 执行                               |
| [`sandbox-bootstrap.ts`](../../src/main/sandbox/sandbox-bootstrap.ts) | 应用启动时预检查并缓存 WSL/Lima 状态               |
| [`sandbox-sync.ts`](../../src/main/sandbox/sandbox-sync.ts)           | WSL 文件同步                                       |
| [`lima-sync.ts`](../../src/main/sandbox/lima-sync.ts)                 | Lima 文件同步                                      |
| [`path-resolver.ts`](../../src/main/sandbox/path-resolver.ts)         | session mount 和虚拟路径解析                       |
| [`path-guard.ts`](../../src/main/sandbox/path-guard.ts)               | 路径守卫                                           |
| [`types.ts`](../../src/main/sandbox/types.ts)                         | executor、status、path converter 类型              |

初始化流程：

1. `SessionManager.processPrompt` 调 `ensureSandboxInitialized`。
2. `initializeSandbox({ workspacePath })` 进入 `SandboxAdapter`。
3. 如果 `configStore.get('sandboxEnabled') === false`，直接 native。
4. Windows：
   - 用 `SandboxBootstrap` 缓存的 WSL status，或重新检查。
   - 检查 Node/Python/pip。
   - 需要时提示安装。
   - 启动 WSL bridge。
5. macOS：
   - 检查 Lima。
   - 创建/启动内部 Lima 实例。
   - 检查 Node/Python/pip。
   - 启动 Lima bridge。
6. 失败时 fallback native，并记录 warning。

维护注意：

- `SandboxAdapter` 有 `initPromise` 防重复初始化，有 `reinitialize` 支持配置变更后重建。
- bridge agent 运行在 WSL/Lima 内，打包时要保证 `dist-wsl-agent`、`dist-lima-agent` 产物存在。
- `SandboxSync.syncAndCleanup` 在退出或会话结束时负责同步回宿主和清理。
- Windows/macOS 路径转换是高风险代码，改动后跑路径 containment 和 sandbox 相关测试。

## 工具执行和路径 containment

工具执行代码在 [`src/main/tools`](../../src/main/tools)。

| 文件                                                                        | 职责                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`tool-executor.ts`](../../src/main/tools/tool-executor.ts)                 | native 文件工具、webFetch、webSearch 等旧执行器               |
| [`sandbox-tool-executor.ts`](../../src/main/tools/sandbox-tool-executor.ts) | 通过 `SandboxAdapter` 执行读写、列目录、bash、edit、glob/grep |
| [`path-containment.ts`](../../src/main/tools/path-containment.ts)           | POSIX、Windows drive、UNC 路径 containment 判断               |

路径安全规则：

- 输入路径可为虚拟路径、工作区内绝对路径或相对路径。
- 相对路径默认基于 session 的第一个 mount root。
- 已存在路径会尝试 `realpath`，防止 symlink 逃逸。
- Windows 比较大小写不敏感。
- UNC 和 drive path 需要分别 canonicalize。

修改建议：

- 新增文件类工具必须复用 `resolveWorkspacePath` 或等价的 containment 检查。
- 不要把 renderer 传来的路径直接传给 `fs` 或 shell。
- 搜索和 glob 要限制结果量和忽略 `node_modules` / `.git`。
- bash 执行必须经过权限策略和沙盒。

相关测试：

- [`src/tests/path-containment.test.ts`](../../src/tests/path-containment.test.ts)
- [`tests/path-resolver-containment.test.ts`](../../tests/path-resolver-containment.test.ts)
- [`tests/path-guard-command-conversion.test.ts`](../../tests/path-guard-command-conversion.test.ts)
- [`tests/sandbox-command-injection.test.ts`](../../tests/sandbox-command-injection.test.ts)
- [`tests/sandbox-executor-containment.test.ts`](../../tests/sandbox-executor-containment.test.ts)
- [`tests/tool-executor-sandbox.test.ts`](../../tests/tool-executor-sandbox.test.ts)
- [`tests/tool-executor-unc-paths.test.ts`](../../tests/tool-executor-unc-paths.test.ts)

## 权限策略

权限默认策略在 [`src/shared/permission-policies.ts`](../../src/shared/permission-policies.ts)，主进程缓存和决策在 [`src/main/config/permission-rules-store.ts`](../../src/main/config/permission-rules-store.ts)。

策略：

- `default`：读、搜索和部分只读数据工具 allow；写、编辑、bash ask。
- `auto_review`：默认 ask 的常用写操作变为 allow，未知工具 ask。
- `full_access`：所有工具 allow。

决策顺序：

1. session-scoped always allow。
2. 第一条匹配 tool 和 pattern 的规则。
3. 默认 ask。

安全边界：

- renderer 同步来的规则被视为不可信，主进程会 sanitize。
- 无效 action 回退 ask。
- unknown tool 默认 ask。
- “always allow” 只对当前 session 生效。

## MCP

MCP 代码在 [`src/main/mcp`](../../src/main/mcp)。

关键文件：

- [`mcp-manager.ts`](../../src/main/mcp/mcp-manager.ts)：MCP client、transport、server 生命周期、工具发现、工具调用。
- [`mcp-config-store.ts`](../../src/main/mcp/mcp-config-store.ts)：MCP server 配置和 presets。
- [`gui-operate-server.ts`](../../src/main/mcp/gui-operate-server.ts)：内置 GUI 自动化 MCP server。
- [`software-dev-server-example.ts`](../../src/main/mcp/software-dev-server-example.ts)：内置 software-development preset server。
- [`mcp-logger.ts`](../../src/main/mcp/mcp-logger.ts)：MCP 日志。

支持 transport：

- `stdio`
- `sse`
- `streamable-http`

MCP 工具进入 Agent 的两条路径：

1. `MCPManager` 连接 server，发现工具，保存到 `tools` map。
2. `AgentRunner` 每轮读取 `MCPManager.getTools()`，用 `buildMcpCustomTools` 转成 pi-coding-agent custom tools。

工具名规则：

- Agent SDK 侧使用 `mcp__<ServerKey>__<toolName>`。
- `mcp-manager.ts` 会 sanitize 和 truncate，避免超过模型工具名长度限制。
- UI 用 `getToolDisplayName` 尽量显示原始工具名。

配置流程：

- UI：[`SettingsConnectors`](../../src/renderer/components/settings/SettingsConnectors.tsx)
- preload：`window.electronAPI.mcp.*`
- main IPC：`mcp.getServers`、`mcp.saveServer`、`mcp.deleteServer`、`mcp.getTools`、`mcp.getServerStatus`、`mcp.getPresets`
- store：[`mcpConfigStore`](../../src/main/mcp/mcp-config-store.ts)
- runtime：[`MCPManager.updateServer`](../../src/main/mcp/mcp-manager.ts)

维护注意：

- `mcp.saveServer` 失败时会把启用失败的 server 回滚为 `enabled: false`，避免下次启动反复失败。
- Windows 上 `npx` 解析有 trusted directory 逻辑，改 PATH 行为要跑相关测试。
- 内置 preset 的 `{GUI_OPERATE_SERVER_PATH}` 和 `{SOFTWARE_DEV_SERVER_PATH}` 由 config store 运行时解析，打包脚本必须包含 `dist-mcp`。

相关测试：

- [`src/tests/mcp/mcp-manager.test.ts`](../../src/tests/mcp/mcp-manager.test.ts)
- [`tests/mcp-npx-resolution.test.ts`](../../tests/mcp-npx-resolution.test.ts)
- [`tests/mcp-manager-env-merge.test.ts`](../../tests/mcp-manager-env-merge.test.ts)
- [`tests/mcp-tool-name.test.ts`](../../tests/mcp-tool-name.test.ts)
- [`tests/remote-control-panel-imports.test.ts`](../../tests/remote-control-panel-imports.test.ts)

## GUI 操作 MCP

[`gui-operate-server.ts`](../../src/main/mcp/gui-operate-server.ts) 是一个大型内置 MCP server，面向桌面 GUI 自动化。

能力概览：

- 截屏和截图缓存。
- 鼠标点击、键盘输入、快捷键。
- macOS `cliclick`、系统工具和 Python 辅助脚本。
- 应用识别、Dock 相关启发式。
- 视觉模型调用，用于定位和判断操作是否成功。
- 点击历史记录，辅助多屏和重复操作。

维护注意：

- 该文件体量很大，改动前先定位具体工具 schema 和执行函数。
- 截图输出会进入 tool result images，UI 只渲染安全 MIME。
- 视觉 API key 选择逻辑和主模型配置有关，改 provider 时要检查这里。
- 打包时需要 `scripts/bundle-mcp.js` 输出可被 Node 直接执行的 JS。

## Skills

Skills 管理在 [`src/main/skills/skills-manager.ts`](../../src/main/skills/skills-manager.ts)。

职责：

- 加载内置 Skills。
- 管理全局 skills storage path。
- 解析 `SKILL.md` metadata。
- 安装、删除、启停、校验 skills。
- 使用 `chokidar` 监听 storage 变化并发 `skills.storageChanged`。

加载优先级：

1. 项目级 `.skills/` 或 `skills/`。
2. 全局 `<userData>/claude/skills/`，也兼容 `~/.claude/skills`。
3. 内置 skills。

安全规则：

- skill name 不能包含路径分隔符或 `..`。
- 全局 skills path 必须在允许目录中。
- dangling symlink 会被跳过。
- 迁移 global skills path 时要统计 migrated/skipped。

UI：

- [`SkillsView`](../../src/renderer/components/SkillsView.tsx) 只是设置页 skills tab 的页面化入口。
- 主要管理 UI 在 [`SettingsSkills`](../../src/renderer/components/settings/SettingsSkills.tsx)。

## 插件

插件运行时在 [`src/main/skills/plugin-runtime-service.ts`](../../src/main/skills/plugin-runtime-service.ts)。

职责：

- 从 marketplace catalog 列出插件。
- 调 Claude CLI 安装插件。
- 解析插件 manifest 和组件数量。
- 把插件 source copy 到用户数据目录。
- materialize runtime path。
- 按组件启停：skills、commands、agents、hooks、mcp。
- 通过 [`plugin-registry-store`](../../src/main/skills/plugin-registry-store.ts) 保存安装状态。

插件 catalog 在 [`plugin-catalog-service.ts`](../../src/main/skills/plugin-catalog-service.ts)，会访问 `https://claude.com/plugins` 并有短 TTL cache。

维护注意：

- `installFromDirectory` 会删除旧 source/runtime 后复制，路径必须留在用户数据目录。
- 组件启停后要重新 materialize runtime，并通知 session invalidation。
- 插件 runtime 改动可能影响 Skills、MCP 和 Agent 工具，需要跑插件和 skills 相关测试。

相关测试：

- [`tests/plugin-runtime-service.test.ts`](../../tests/plugin-runtime-service.test.ts)
- [`tests/plugin-catalog-service.test.ts`](../../tests/plugin-catalog-service.test.ts)
- [`tests/plugin-catalog-dev-impl.test.ts`](../../tests/plugin-catalog-dev-impl.test.ts)
- [`tests/skills-manager-plugin-install.test.ts`](../../tests/skills-manager-plugin-install.test.ts)
- [`tests/skills-manager-storage-path.test.ts`](../../tests/skills-manager-storage-path.test.ts)
- [`src/tests/skills/dangling-symlink.test.ts`](../../src/tests/skills/dangling-symlink.test.ts)

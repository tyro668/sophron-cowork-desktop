# Electron 在线更新设计方案

## 背景

sophron 当前使用 Electron + electron-builder 打包，Windows 目标为 NSIS，macOS 当前配置为 `dir` 输出。现有工程没有接入在线更新能力，也没有生成更新所需的 `latest.yml` / `latest-mac.yml` manifest。

目标是在已安装应用内通过主页标题后的“有新版本”标签提供立即更新能力：用户点击标签后，应用自动下载更新文件、完成安装并自动重启到新版本，不再要求用户手动下载或再次运行安装包。

## 目标

- 点击更新后自动下载最新版本。
- 下载完成后自动安装并重启应用。
- 用户不需要手动打开安装包或拖拽安装。
- 支持 Windows 和 macOS。
- 支持稳定版和后续 beta/canary 渠道扩展。
- 更新过程可观测：检查中、下载中、进度、安装中、失败、已是最新。
- 更新失败不影响当前版本继续使用。

## 非目标

- 不做增量热更新前端资源，仍以 Electron 应用包为更新单位。
- 不支持 Microsoft Store / Mac App Store 更新链路。
- 不在渲染进程开放自定义更新 URL，避免被页面脚本篡改更新源。
- 不绕过系统首次安装要求；首次安装仍通过安装包完成，后续版本在线无缝更新。

## 推荐方案

采用 `electron-updater` + `electron-builder` publish manifest。

原因：

- 与当前 `electron-builder` 打包体系匹配。
- 支持 Windows NSIS 自动下载、静默安装、重启。
- 支持 macOS zip/dmg 更新包和签名校验。
- manifest 内置 `sha512` 校验，配合代码签名满足完整性要求。
- 支持 `autoDownload: false`，可以完全由“点击更新”触发。

需要新增依赖：

```json
{
  "dependencies": {
    "electron-updater": "<compatible-version>"
  }
}
```

版本选择应与当前 `electron-builder` 版本兼容，安装后以 lockfile 固定。

## 打包配置设计

### Windows

保留 NSIS，但需要保证自动更新可以静默安装。

建议配置：

```js
win: {
  target: [{ target: 'nsis', arch: ['x64'] }],
  artifactName: `${artifactPattern}-win-${arch}.${ext}`,
}
```

NSIS 需要保留当前安装目录、应用数据目录，不在更新时清理用户数据。

自动更新依赖：

- `.exe`
- `.exe.blockmap`
- `latest.yml`

### macOS

当前 `mac.target` 是 `dir`，不适合在线更新。需要改为生成可分发安装包和更新包：

```js
mac: {
  target: [
    { target: 'dmg', arch: ['arm64'] },
    { target: 'zip', arch: ['arm64'] }
  ],
  hardenedRuntime: true,
  gatekeeperAssess: true,
  identity: 'auto'
}
```

自动更新依赖：

- `.zip`
- `.dmg`
- `latest-mac.yml`

macOS 必须完成签名和公证。未签名或未公证的包会导致更新后启动失败或被 Gatekeeper 阻止。

### publish 配置

使用 generic provider，更新源固定为 HTTPS。

```js
publish: [
  {
    provider: 'generic',
    url: 'https://download.sophron.ai/updates/stable'
  }
]
```

如果需要多渠道，主进程按渠道设置 feed URL：

```ts
autoUpdater.setFeedURL({
  provider: 'generic',
  url: `${UPDATE_BASE_URL}/${channel}/${platform}/${arch}`,
});
```

推荐目录结构：

```text
updates/
  stable/
    darwin-arm64/
      latest-mac.yml
      sophron-10.1.1-mac-arm64.zip
      sophron-10.1.1-mac-arm64.dmg
    win32-x64/
      latest.yml
      sophron-10.1.1-win-x64.exe
      sophron-10.1.1-win-x64.exe.blockmap
```

manifest 文件必须最后上传，避免客户端读到新 manifest 但安装包尚未上传完成。

## 主进程更新服务

新增 `src/main/update/update-service.ts`，只在主进程访问 `electron-updater`。

状态模型：

```ts
type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';
```

核心策略：

- `autoDownload = false`
- `autoInstallOnAppQuit = false`
- 用户点击“更新”后调用 `checkForUpdates()`
- 如有新版本，立即调用 `downloadUpdate()`
- 下载完成后保存必要状态，调用 `quitAndInstall(true, true)`
- `isSilent = true` 用于 Windows 静默安装
- `isForceRunAfter = true` 确保安装后重启

示例伪代码：

```ts
import { app, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';

export function registerUpdateService() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;

  ipcMain.handle('update.checkAndInstall', async () => {
    emitUpdateState({ status: 'checking' });
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo) {
      emitUpdateState({ status: 'not-available' });
      return;
    }
    emitUpdateState({ status: 'downloading', version: result.updateInfo.version });
    await autoUpdater.downloadUpdate();
  });

  autoUpdater.on('download-progress', (progress) => {
    emitUpdateState({
      status: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', () => {
    emitUpdateState({ status: 'installing' });
    app.once('before-quit', () => {
      // stop background tasks if needed
    });
    autoUpdater.quitAndInstall(true, true);
  });
}
```

`quitAndInstall` 前需要做轻量收尾：

- 停止正在进行的更新下载以外的长任务提示。
- flush SQLite / DuckDB 写入。
- 保存窗口状态和当前会话状态。
- 主进程广播 `update:installing`，渲染进程显示“正在安装并重启”。

## IPC 设计

preload 暴露最小 API：

```ts
window.electronAPI.update = {
  checkAndInstall: () => ipcRenderer.invoke('update.checkAndInstall'),
  getState: () => ipcRenderer.invoke('update.getState'),
  onState: (listener) => ipcRenderer.on('update.state', listener),
};
```

禁止暴露：

- 任意更新 URL 设置。
- 任意本地安装包路径执行。
- 渲染进程直接调用 `quitAndInstall`。

主进程负责校验：

- 当前环境必须是 packaged app。
- 当前平台必须支持更新。
- 当前渠道必须在 allowlist 内。
- 更新源必须是内置 HTTPS URL。

## 渲染进程交互

入口放在主页侧边栏标题后：

- 应用启动后主进程静默检查更新。
- 检查到新版本时，在“九思助理”标题后显示小号可点击标签：`有新版本`。
- 点击标签后自动下载、安装并重启。
- 设置页不展示更新入口，避免把主路径藏在配置页里。

点击“有新版本”即代表用户同意下载并安装本次更新。更新完成自动重启，不再追加确认按钮。

为了避免误触导致正在处理的数据丢失，可以在点击后先做应用内检查：

- 如果有正在执行的数据任务，提示“有任务运行中，请稍后更新”。
- 如果没有阻塞任务，则直接进入下载和安装。

## 更新服务端设计

最低要求：HTTPS 静态文件服务。

推荐响应头：

```text
latest.yml / latest-mac.yml:
  Cache-Control: no-cache, no-store, must-revalidate

安装包 / blockmap:
  Cache-Control: public, max-age=31536000, immutable
```

上传顺序：

1. 上传安装包。
2. 上传 blockmap。
3. 校验文件大小和 sha512。
4. 最后上传 `latest*.yml`。

回滚方式：

- 将 manifest 指回上一个稳定版本。
- 不删除已发布安装包，避免正在下载的客户端失败。

## 发布流水线

1. 更新 `package.json` 版本号。
2. 运行测试和 typecheck。
3. 构建 Windows x64。
4. 构建 macOS arm64。
5. 完成 Windows 签名、macOS 签名和公证。
6. 生成安装包、blockmap、manifest。
7. 上传版本化 artifacts。
8. 上传 latest manifest。
9. 启动一台旧版本客户端做在线更新冒烟验证。

CI 需要保留产物：

- Windows：`.exe`、`.exe.blockmap`、`latest.yml`
- macOS：`.dmg`、`.zip`、`latest-mac.yml`

## 安全要求

- 更新源必须使用 HTTPS。
- 更新 URL 不允许由渲染进程传入。
- 发布包必须签名。
- macOS 必须公证。
- manifest 和安装包上传需要 CI 专用凭证。
- 客户端禁止降级更新。
- beta/canary 渠道只对明确选择该渠道的客户端开放。
- 日志中不记录下载 URL 中的临时 token。

## 异常处理

| 场景 | 处理 |
| --- | --- |
| 无网络 | 显示失败，可重试 |
| manifest 404 | 显示当前渠道暂无更新 |
| 下载中断 | 保持当前版本，允许重试 |
| sha512 校验失败 | 丢弃文件，显示更新包校验失败 |
| 安装失败 | 保持当前版本，下次启动继续可检查更新 |
| macOS 未安装到可写位置 | 提示首次安装需移动到 Applications，后续更新自动完成 |
| 有数据任务运行中 | 阻止更新或提示稍后重试 |

## 测试方案

### 单元测试

- UpdateService 状态流转。
- IPC 只接受固定命令，不接受自定义 URL。
- 错误事件能映射到 UI 文案。

### 本地集成测试

1. 构建版本 `10.1.0`。
2. 构建版本 `10.1.1`。
3. 用本地 HTTP server 暴露 `updates/stable/<platform>-<arch>`。
4. 安装并启动 `10.1.0`。
5. 确认标题后出现“有新版本”标签并点击。
6. 验证下载进度出现。
7. 验证应用自动退出、安装、重启。
8. 验证重启后版本为 `10.1.1`。

### 回归测试

- Windows NSIS 更新后用户数据不丢失。
- macOS 更新后 Gatekeeper 不拦截。
- 下载失败后当前版本仍可使用。
- beta 渠道不会影响 stable 客户端。

## 开发任务拆分

1. 增加 `electron-updater` 依赖。
2. 修改 `electron-builder.config.cjs`，增加 `publish`，mac target 改为 `dmg + zip`。
3. 新增主进程 `UpdateService`。
4. 新增 preload `update` API。
5. 新增 renderer 主页标题后的“有新版本”小标签入口。
6. 增加 i18n 文案。
7. 增加更新状态日志。
8. 配置发布目录和上传脚本。
9. 搭建本地更新测试脚本。
10. 完成 Windows 和 macOS 真机更新验证。

## 待办：真实在线更新发布侧落地

当前应用侧已经具备检查、下载、安装、重启的基础能力。真实线上可用前，还需要完成以下发布侧事项：

1. 明确最终更新源 URL 与目录结构，保证客户端 `publish.url` / feed URL 与实际上传路径完全一致。如果采用 `updates/stable/darwin-arm64`、`updates/stable/win32-x64` 这种分平台目录，主进程也要按平台和架构指向对应目录；如果采用 `updates/stable` 根目录，则 `latest.yml` / `latest-mac.yml` 必须直接放在该目录下。
2. CI 需要生成真实可安装更新产物，而不是开发包或 `dir` 输出：Windows 生成 NSIS `.exe`、`.exe.blockmap`、`latest.yml`；macOS 生成签名并公证后的 `.dmg`、`.zip`、`latest-mac.yml`。
3. 配置代码签名和公证凭证：Windows 证书、macOS Developer ID、notarytool 凭证都需要放入 CI 安全变量，并在发布流水线中验证签名结果。
4. 实现发布上传脚本，按“安装包和 blockmap 先上传、manifest 最后上传”的顺序发布，避免旧客户端读到新 manifest 但安装包尚未可下载。
5. 对上传后的 `latest.yml` / `latest-mac.yml` 做自动校验：`version`、`files.url`、`sha512`、`size`、blockmap 路径、artifact 文件名都必须和实际文件一致。
6. 配置 CDN / 静态服务缓存策略：manifest 使用 `no-cache, no-store, must-revalidate`，安装包和 blockmap 使用长期 immutable 缓存。
7. 用已安装的旧版本做端到端验证：启动旧版本后能静默检查到更新，标题后出现“有新版本”标签，点击后下载、自动安装、自动重启，并确认重启后版本号变为新版本。
8. 分别完成 Windows x64 和 macOS arm64 真机验证。开发模式下更新能力为 unsupported，不作为真实在线更新验收依据。
9. 验证失败和回滚路径：manifest 404、下载中断、sha512 校验失败、macOS 公证失败、Windows 安装失败时，旧版本仍可继续使用；需要回滚时只修改 manifest 指向上一稳定版本。
10. 发布前保留上一版本安装包和 manifest 备份，不删除历史 artifacts，避免正在下载的客户端或回滚操作失效。

## 验收标准

- 已安装旧版本应用中点击“有新版本”标签后自动下载新版本。
- 下载完成后无需用户再次安装，应用自动重启。
- 重启后版本号变为最新版本。
- 更新失败不破坏旧版本可用性。
- Windows 和 macOS 均通过真实安装包验证。

# Personal Analysis Mock Server Integration

## 目标

打通 cowork 与 Personal Analysis mock server 的本地联调链路，让用户可以在 cowork 中访问云分析空间、导入云端表，并将本地数据结果上传回 Personal Analysis。

当前产品定位：

- 默认路径：用户登录后，以当前账号身份访问有权限的分析空间。
- 高级路径：专业用户、开发者或集成场景可以配置 API Key，访问该 API Key 被授权的数据范围。
- API Key 是显式高级凭证；当用户同时已登录并配置 API Key 时，默认使用账号模式，并允许用户临时切换为 API Key 模式。

mock server 只用于本地联调。接入真实服务时，应尽量复用 cowork 侧的 client、command service、IPC 和 UI 流程。

## 访问身份模型

### 账号模式

用户通过桌面登录链路完成认证：

```text
GET  /api/desktop/auth/authorize
POST /api/desktop/auth/token
GET  /api/desktop/auth/me
```

登录成功后，cowork 使用 desktop auth token 访问 Personal Analysis 业务 API。

业务含义：

- 当前访问身份是登录用户。
- 展示当前账号有权限访问的分析空间、项目和表。
- 适合作为普通用户的默认路径。

### API Key 模式

用户在设置中配置 Personal Analysis 服务地址和 API Key：

```text
API Key
  -> POST /api/personal/api-keys/token
  -> accessToken
  -> Authorization: Bearer <accessToken>
  -> /api/personal/analysis/v1/*
```

业务含义：

- 当前访问身份是 API Key 凭证。
- 展示该 API Key 被授权访问的数据范围。
- 适合开发调试、测试环境、服务集成或特殊授权范围访问。

### 优先级

```text
isLoggedIn
  -> 账号模式
else if hasApiKeyConfig
  -> API Key 模式
else
  -> 未连接，引导登录
```

当用户同时已登录并配置了 API Key 时，页面默认处于账号模式，并提供“切换为 API Key 访问”的入口；切换为 API Key 模式后也应提供“切换为账号访问”的入口。切换访问身份不应清空 API Key 配置，只改变当前云分析页面和后续云分析请求的 `connectionMode`。

## 页面状态

### 未登录 + 无 API Key

显示登录引导页。

主操作：

- `登录并访问云分析空间`

备用入口：

- `开发者调试？使用 API Key 连接`

### 已登录 + 无 API Key

进入账号模式，自动加载当前账号有权限的云分析空间。

顶部状态示例：

```text
账号模式 · 测试用户 · http://127.0.0.1:3000
```

### 未登录 + 有 API Key

进入 API Key 模式，自动加载 API Key 授权范围内的云分析空间。

顶部状态示例：

```text
API Key 模式 · 开发者连接 · http://127.0.0.1:3000
```

### 已登录 + 有 API Key

账号模式优先，自动加载当前登录账号有权限的云分析空间。

顶部状态示例：

```text
账号模式 · 测试用户 · http://127.0.0.1:3000
```

提供：

- `切换为 API Key 访问`
- `刷新`
- `管理连接`

用户切换到 API Key 模式后，顶部状态示例：

```text
API Key 模式 · 已登录：测试用户 · http://127.0.0.1:3000
```

此时提供：

- `切换为账号访问`
- `刷新`
- `管理连接`

## 主要能力

### 浏览云分析空间

```text
space
  -> project
  -> table
```

`CloudDataView` 使用两栏结构：

- 左侧：分析空间和项目。
- 右侧：当前项目下的表列表。

表支持：

- 搜索。
- 预览。
- 导入为 cowork 输入表。

### 从云端导入到 cowork

```text
Personal Analysis table
  -> export CSV
  -> temporary CSV file
  -> cowork input table
  -> DuckDB
```

UI 入口：

```text
云分析空间
  -> 选择空间
  -> 选择项目
  -> 选择表
  -> 预览 / 导入为输入表
```

### 从 cowork 上传回 Personal Analysis

上传入口放在 `数据 > 输出表`。

原因：

- 云分析空间页面负责浏览和导入云端资源。
- 输出表是本地处理结果的主要承载对象。
- 用户处理完数据后，从输出表发起上传更符合操作心智。

上传支持：

- 新建云端表：`writeMode=CREATE`
- 替换已有云端表：`writeMode=REPLACE`

## 技术链路

UI / IPC 链路：

```text
Renderer UI
  -> preload IPC
  -> DataCommandService
  -> PersonalAnalysisClient
  -> mock server HTTP API
```

Agent 工具链路：

```text
data tools
  -> DataToolService
  -> DataCommandService
  -> PersonalAnalysisClient
  -> mock server HTTP API
```

UI 和 Agent 共用 `DataCommandService`，避免导入、预览、上传逻辑分叉。

## 关键代码

### 共享层

- `src/shared/personal-analysis.ts`
  - 默认配置。
  - Host normalize。
  - 连接校验。
  - 错误文案映射。
- `src/shared/personal-analysis-types.ts`
  - Personal Analysis 共享类型。

### 登录认证

- `src/main/auth/desktop-auth-service.ts`
  - 浏览器授权登录。
  - 本地 callback server。
  - 保存 desktop auth session。
  - 提供 `getPersonalAnalysisConnection()` 供数据层使用。

### 协议客户端

- `src/main/data/personal-analysis-client.ts`
  - API Key 换 token。
  - 复用传入的 access token。
  - 查询 spaces / projects / tables。
  - 导出云端表 CSV。
  - 上传 CSV 并提交 import。

### 数据命令服务

- `src/main/data/data-command-service.ts`
  - `listCloudSpaces`
  - `listCloudProjects`
  - `listCloudTables`
  - `previewCloudTable`
  - `importCloudTable`
  - `uploadDataTableToCloud`

创建 client 时的身份选择：

```text
connectionMode = account
  -> input accessToken / desktop auth token
connectionMode = apiKey
  -> explicit API Key / configured API Key
connectionMode omitted
  -> legacy fallback: input accessToken -> explicit API Key / configured API Key -> desktop auth token
```

### Renderer

- `src/renderer/components/CloudDataView.tsx`
  - 登录引导。
  - 账号模式 / API Key 模式状态显示。
  - 云分析空间资源浏览。
  - 表预览与导入。
  - 临时切换账号访问 / API Key 访问，不清空 API Key 配置。
- `src/renderer/components/settings/SettingsPersonalAnalysis.tsx`
  - API Key 高级连接配置。
  - 测试连接、保存、更换、断开。
- `src/renderer/components/DataView.tsx`
  - 输出表上传到 Personal Analysis。

### IPC / preload

- `src/main/index.ts`
  - `auth.*`
  - `data.listCloudSpaces`
  - `data.listCloudProjects`
  - `data.listCloudTables`
  - `data.previewCloudTable`
  - `data.importCloudTable`
  - `data.uploadDataTableToCloud`
- `src/preload/index.ts`
  - 暴露 `window.electronAPI.auth.*`
  - 暴露 `window.electronAPI.data.*`

## Mock Server 约定

业务 API：

```text
/api/personal/analysis/v1/*
```

本地调试内置：

```text
API Origin: http://127.0.0.1:3000
API Key: mock-api-key
```

桌面登录测试账号：

```text
账号: 1
密码: 1
```

mock server 当前允许两类 token 访问业务 API：

- API Key 换取的 `pat_mock_*`
- 桌面登录得到的 `dat_*`

## Datasource

Datasource 不作为全局设置保存。

上传时的解析顺序：

```text
如果入参包含 datasourceId
  -> 使用入参
否则
  -> 调用 /api/personal/analysis/v1/datasources
  -> 如果只有一个 datasource，自动使用
  -> 如果有多个，提示本次上传需要指定 datasourceId
```

cowork 客户端不写死 mock server 的 datasource。

## 错误处理

Renderer 使用 `getPersonalAnalysisErrorMessage` 将底层错误映射为用户可理解的文案。

常见类型：

- timeout：服务超时。
- API Key / unauthorized：凭证无效或过期。
- forbidden：当前凭证没有权限。
- network / ECONNREFUSED / fetch failed：服务地址错误或服务未运行。

当前第一版可以使用统一错误态：

```text
已登录，暂时无法加载云分析空间
重新加载 / 重新登录 / 使用 API Key
```

后续可再细分 mock server 未启动、token 过期、无访问权限等状态。

## 验证

cowork：

```bash
npm run typecheck
```

mock server：

```bash
npm start
curl http://127.0.0.1:3000/health
```

登录 token 访问业务 API 的验证思路：

```text
登录获取 dat_* token
  -> GET /api/personal/analysis/v1/spaces
  -> Authorization: Bearer <dat_* token>
```

在 Codex 沙箱中启动本地端口可能遇到 `listen EPERM`，需要授权在沙箱外运行。

## 注意事项

- mock server 状态保存在内存中，重启后会从 seed 数据重新初始化。
- 重新启动 mock server 会让已有 desktop token 失效，需要重新登录。
- API Key 配置是高级路径，不应在普通用户主流程中过度突出。
- 生产级大表上传需要流式导出和上传；当前 CSV 字符串方案适合 mock 联调和中小表验证。
- 后续如果真实服务返回多个 datasource，需要在上传 UI 中支持选择 datasource。

## 后续优化

- 加载失败时细分错误状态。
- 顶部增加更清晰的“当前访问身份”详情。
- 云分析空间支持分页、排序和跨空间搜索。
- 上传完成后自动刷新对应项目的云端表列表。

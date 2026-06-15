# Personal Analysis Mock Server Integration

## 背景

本方案用于打通 Personal Analysis mock server 与 cowork 的双向数据链路。

当前实现目标：

- cowork 可以连接 Personal Analysis 服务，保存服务地址和 API Key。
- 用户可以在独立的“云端数据”页面浏览分析空间、项目和表。
- 用户可以预览云端表，并将云端表导入为 cowork 输入表。
- 本地 Agent / 数据任务处理后产生的输入表或输出表，可以上传回 Personal Analysis。
- 上传回云端支持两种写入方式：
  - 新建云端表。
  - 替换已有云端表。

mock server 用于本地联调，真实云端服务接入时应尽量复用 cowork 侧的客户端、命令服务、UI 流程，只替换协议细节或服务端实现。

## 当前产品形态

### 导航

第一版采用一级入口：

```text
数据
云端数据
技能
自动化
设置
```

`云端数据` 是 Personal Analysis 云端数据能力的主要业务入口。

`设置 > Personal Analysis` 只负责连接管理：

- 服务地址。
- API Key。
- 测试连接。
- 更换连接。
- 断开连接。
- 跳转查看云端数据。

### 云端数据页

未连接状态：

```text
连接 Personal Analysis 云端数据

连接后可以：
- 浏览分析空间、项目和表
- 预览云端表
- 导入为 cowork 输入表
- 在对话和数据任务中使用

[开始连接]
```

点击“开始连接”会打开设置页的 Personal Analysis 配置。

已连接状态采用两栏资源管理结构：

```text
左侧：分析空间 / 项目
右侧：当前项目下的表列表
```

左侧空间只作为分组标题，项目是可选项。右侧表列表支持：

- 搜索当前项目下的表。
- 预览云端表。
- 导入为输入表。

“导入为输入表”会创建 cowork input table，导入后可在当前对话和数据任务中使用。

### 数据工作区上传回云端

上传回云端的入口放在 `数据 > 输出表`，而不是云端数据页。

原因：

- 云端数据页负责浏览和导入云端资源。
- 输出表是本地处理结果的主要承载对象。
- 用户处理完数据后，从输出表发起“上传到云端”最符合操作心智。

输出表工具栏新增：

```text
[预览] [编辑] [上传到云端] [删除]
```

上传弹窗支持：

```text
上传到 Personal Analysis

分析空间
项目

写入方式：
  新建表
  替换表

云端表名
```

当选择“替换表”时，会加载当前项目下的云端表，并要求用户选择替换目标表。

## 技术链路

整体链路：

```text
mock server HTTP API
  -> PersonalAnalysisClient
  -> DataCommandService
  -> IPC / preload / renderer UI
  -> DataTaskStore / DuckDB
```

Agent 工具链路：

```text
mock server HTTP API
  -> PersonalAnalysisClient
  -> DataCommandService
  -> DataToolService / data-tool-definitions
  -> cowork data tools
```

UI 和 Agent 共用 `DataCommandService` 的业务命令，避免两套导入/上传逻辑分叉。

## 配置与认证

配置项保存在 `configStore.personalAnalysis`：

- `apiOrigin`：Personal Analysis 服务 origin，例如 `http://127.0.0.1:3000`。只保存 origin，不保存具体 API path。
- `apiKey`：API Key 页面生成的 `X-API-Key` 值。只保存 key 本体，不包含 `X-API-Key:` 前缀。
- `updatedAt`：持久化配置更新时间。

认证流程：

```text
API Key
  -> POST /api/personal/api-keys/token
  -> accessToken
  -> Authorization: Bearer <accessToken>
  -> Personal Analysis business APIs
```

输入校验：

- 服务地址和 API Key 必填。
- 服务地址必须是合法 `http://` 或 `https://` URL。
- 如果用户粘贴 `X-API-Key:` 前缀，设置页会提示只填写 key 值。
- 服务地址会统一 trim 并移除末尾 `/`。

相关共享逻辑：

- `src/shared/personal-analysis.ts`
  - `EMPTY_PERSONAL_ANALYSIS_CONFIG`
  - `normalizePersonalAnalysisApiOrigin`
  - `validatePersonalAnalysisConnection`
  - `getPersonalAnalysisErrorMessage`
- `src/shared/personal-analysis-types.ts`
  - Personal Analysis 相关共享类型。
  - `PersonalAnalysisConfig`
  - `StoredPersonalAnalysisConfig`
  - `PersonalAnalysisConnectionInput`
  - `PersonalAnalysisSpace`
  - `PersonalAnalysisProject`
  - `PersonalAnalysisTable`
  - `PersonalAnalysisDatasource`
  - `PersonalAnalysisUploadInput`
  - `PersonalAnalysisUploadResult`

## Datasource 处理

Datasource 不作为全局设置保存。

它属于上传操作所需的业务参数，解析流程如下：

```text
用户发起上传
  -> 如果入参包含 datasourceId，直接使用
  -> 如果没有 datasourceId，cowork 调用 /api/personal/analysis/v1/datasources
  -> 如果服务端只返回一个 datasource，自动使用
  -> 如果返回多个，返回错误并提示为本次上传选择 datasourceId
```

mock server 可以保留 `datasource-demo` 作为本地联调数据源，但 cowork 客户端不写死默认 datasource。

## 主要代码落点

### 共享层

- `src/shared/personal-analysis-types.ts`
  - 统一 Personal Analysis 类型定义，避免 main、renderer、client 重复维护。
- `src/shared/personal-analysis.ts`
  - 统一配置默认值、Host normalize、连接校验和错误文案映射。

### 主进程协议客户端

- `src/main/data/personal-analysis-client.ts`
  - API Key 换 token。
  - 查询 datasources。
  - 查询 spaces / projects / tables。
  - 创建导出任务并轮询 downloadUrl。
  - 获取 uploadUrl。
  - PUT CSV。
  - 提交 imports。
  - 轮询 import 状态。

### 数据命令服务

- `src/main/data/data-command-service.ts`
  - `listCloudSpaces`
  - `listCloudProjects`
  - `listCloudTables`
  - `previewCloudTable`
  - `importCloudTable`
  - `uploadDataTableToCloud`

上传命令支持：

```ts
{
  tableKind: 'input' | 'output',
  id: string,
  writeMode: 'CREATE' | 'REPLACE',
  spaceId?: string,
  projectId?: string,
  folderId?: string,
  tableId?: string,
  tableName?: string,
  datasourceId?: string,
  maxRows?: number,
  waitForDone?: boolean
}
```

规则：

- `writeMode=CREATE` 时不能传 `tableId`。
- `writeMode=REPLACE` 时必须传 `tableId`。

### DataTaskStore

- `src/main/data/data-task-store.ts`
  - `exportDatasetCsv`
  - 将 cowork input/output table 导出为 CSV 字符串。
  - 支持 `maxRows` 限制，避免大表一次性进入主进程内存。

目前 `exportDatasetCsv` 适合 mock server 联调和中小表验证。后续如果要支持生产级大表上传，建议改为基于 DuckDB `COPY TO` 的文件导出，再用 stream 上传。

### IPC / preload

- `src/main/index.ts`
  - `data.listCloudSpaces`
  - `data.listCloudProjects`
  - `data.listCloudTables`
  - `data.previewCloudTable`
  - `data.importCloudTable`
  - `data.uploadDataTableToCloud`
- `src/preload/index.ts`
  - 暴露同名 `window.electronAPI.data.*` 方法给 renderer。

### Renderer UI

- `src/renderer/components/CloudDataView.tsx`
  - 云端数据主页面。
  - 未连接引导。
  - 已连接资源浏览。
  - 表预览。
  - 导入为输入表。
  - 使用 request seq 处理列表、预览、导入竞态。

- `src/renderer/components/settings/SettingsPersonalAnalysis.tsx`
  - Personal Analysis 连接管理。
  - 打开 API Key 页面。
  - 测试连接。
  - 保存/更换/断开连接。
  - 跳转云端数据页。

- `src/renderer/components/DataView.tsx`
  - 输出表工具栏新增“上传到云端”。
  - 上传弹窗支持新建云端表和替换已有云端表。
  - 上传弹窗使用 request seq 处理空间、项目、表列表加载竞态。

- `src/renderer/components/Sidebar.tsx`
  - 左侧导航新增一级入口“云端数据”。

### Data tools

- `src/main/data/data-tool-definitions.ts`
  - `data_list_cloud_spaces`
  - `data_list_cloud_projects`
  - `data_list_cloud_tables`
  - `data_import_cloud_table`
  - `data_upload_table_to_cloud`

工具提示会引导模型：

- 从 Personal Analysis 云端表导入到 cowork。
- 将 cowork input/output table 上传回 Personal Analysis。
- 当用户更新 Personal Analysis 设置后，不要沿用旧认证错误，应该重新尝试当前请求。

## 用户流程

### 首次连接

```text
云端数据
  -> 开始连接
  -> 设置 > Personal Analysis
  -> 填写服务地址和 API Key
  -> 测试连接
  -> 保存
  -> 查看云端数据
```

本地 mock server 常用配置：

```text
服务地址：http://127.0.0.1:3000
API Key：mock-api-key
```

### 从云端导入到 cowork

UI 流程：

```text
云端数据
  -> 选择分析空间
  -> 选择项目
  -> 表列表
  -> 预览
  -> 导入为输入表
```

工具流程：

```text
data_list_cloud_spaces
data_list_cloud_projects
data_list_cloud_tables
data_import_cloud_table
```

导入结果：

```text
Personal Analysis 云端表
  -> export CSV
  -> 临时 CSV 文件
  -> cowork input table
  -> DuckDB
```

### 从 cowork 上传回云端

UI 流程：

```text
数据
  -> 输出表
  -> 选择输出表
  -> 上传到云端
  -> 选择分析空间
  -> 选择项目
  -> 选择写入方式
  -> 上传
```

新建云端表：

```text
writeMode=CREATE
tableId omitted
```

替换已有云端表：

```text
writeMode=REPLACE
tableId=<selected cloud table id>
```

工具流程：

```text
data_upload_table_to_cloud
```

上传结果：

```text
cowork input/output table
  -> exportDatasetCsv
  -> Personal Analysis upload-url
  -> PUT CSV
  -> submit import
  -> optional waitForDone
```

## 错误处理

Renderer 统一使用 `getPersonalAnalysisErrorMessage` 将底层错误映射为用户可理解的文案。

常见错误：

- timeout：服务超时。
- 401 / unauthorized / API Key：API Key 无效或过期。
- 403 / forbidden：当前 API Key 没有权限。
- network / ECONNREFUSED / ENOTFOUND / fetch failed：服务地址错误或服务未运行。

Electron IPC 包装后的 `[RUN_FAILED] fetch failed` 也会归类为网络错误。

## 并发与竞态

`CloudDataView` 使用 request seq 保护：

- catalog 请求。
- tables 请求。
- preview 请求。
- import 请求。

项目选择只切换当前项目和表列表，不再取消 catalog 加载状态。

`DataView` 的上传弹窗使用 request seq 保护：

- spaces 请求。
- projects 请求。
- cloud tables 请求。

这样可以避免快速切换空间/项目时，旧请求覆盖新状态。

## 验证

已执行过的关键验证：

- `npm run typecheck`
- `npm run lint`
- `npm test -- data-command-service.test.ts`
- 相关历史验证：
  - `tests/personal-analysis-client.test.ts`
  - `tests/data-command-service.test.ts`
  - `tests/config-store-env.test.ts`

mock server 侧常用验证：

```bash
npm start
curl http://127.0.0.1:3000/health
API_ORIGIN="http://127.0.0.1:3000" PERSONAL_API_KEY="mock-api-key" npm run client:test
```

注意：在当前 Codex 沙箱中，本地端口监听可能被拦截。启动 mock server 或 Vite dev server 时，如果出现 `listen EPERM`，需要在沙箱外授权运行。

## 注意事项

- mock server 状态保存在内存中，测试创建/替换的表会在服务运行期间累积。
- 重新启动 mock server 后，会从 `catalog.json` 和 `data/seed-tables` 重新初始化。
- cowork 客户端不要写死 mock server 的 datasource。
- 设置页不要承诺“重新生成 API Key”，除非真实服务提供该能力。
- 真实服务产品化时，应优先保留 datasource 列表接口。
- 生产级大表上传需要流式导出和上传，当前 CSV 字符串方案适合 mock 联调和中小表。

## 后续可选优化

- 将“上传到云端”也扩展到输入表工具栏。
- 替换云端表前增加二次确认，展示目标表名、tableId、行列数。
- 云端数据页支持全局搜索所有空间、项目和表。
- 云端数据页支持分页和排序。
- 上传完成后自动刷新云端数据页中对应项目的表列表。
- 支持选择 datasource，当真实服务返回多个 datasource 时不再仅依赖错误提示。

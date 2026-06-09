# Personal Analysis Mock Server Integration

## 背景

本次任务是打通 personal analysis mock server 与 cowork 的数据链路：

- mock server 可以提供云端分析空间、项目、表列表，并导出表 CSV。
- cowork 可以把 mock server 表导入为本地 input table，进入现有数据处理流程。
- cowork 处理后的 input/output table 可以再以 CSV 形式上传回 mock server，创建新表或替换已有表。

## 方案

新增一层 `PersonalAnalysisClient` 封装 mock server HTTP 协议，避免把云端接口细节散落在 cowork 的数据处理逻辑里。

整体链路：

```text
mock server HTTP API
  -> PersonalAnalysisClient
  -> DataCommandService
  -> DataToolService / data-tool-definitions
  -> cowork data tools
  -> DataTaskStore / DuckDB
```

## 配置页产品化增量

为了避免用户在每次工具调用时重复传入 host、API Key 和 datasource 信息，cowork 设置页新增
“个人分析 / Personal Analysis”配置项，并将配置持久化到 `configStore`。

配置项：

- `Host`：Personal Analysis 服务 origin，例如 `http://127.0.0.1:3000`。只保存 origin，不保存具体 API path。
- `API Key`：个人 API Key 页面生成的 `X-API-Key` 值。设置页只保存 key 本体，不包含 `X-API-Key:` 前缀。
- `Datasource`：上传表格时使用的目标数据源。产品化方向是不再写死 mock 默认值，而是通过服务端接口获取可选 datasource 列表。

datasource 获取流程：

```text
用户填写 Host + API Key
  -> cowork 调用 /api/personal/api-keys/token 换 token
  -> cowork 调用 /api/personal/analysis/v1/datasources
  -> 设置页以下拉框展示可选 datasource
  -> 保存 datasourceId 到 configStore.personalAnalysis
```

如果服务端 datasource 列表接口暂不可用或返回空，设置页仍允许手动输入 datasourceId 作为联调兜底，但保存时会做基本校验。

## 主要改动

1. 新增 `src/main/data/personal-analysis-client.ts`
   - 负责 API Key 换 token。
   - 查询 datasources。
   - 查询 spaces / projects / tables。
   - 创建导出任务并轮询 downloadUrl。
   - 获取 uploadUrl、PUT CSV、提交 imports。

2. 扩展 `DataCommandService`
   - `listCloudSpaces`
   - `listCloudProjects`
   - `listCloudTables`
   - `importCloudTable`
   - `uploadDataTableToCloud`

3. 扩展 `DataTaskStore`
   - 新增 `exportDatasetCsv`，将 cowork input/output table 导出为 CSV 字符串。
   - 增加导出行数上限，避免大表一次性进入内存。
     - _目前加_ _maxRows_ _是为了保护 Electron 主进程，避免当前字符串式 CSV 导出在大表场景下 OOM。它适合 mock server 联调和中小表验证。后续如果要支持生产级大表上传，应该把_ _exportDatasetCsv_ _改造成基于 DuckDB_ _COPY TO_ _的文件导出，再用 stream 上传，届时可以去掉或放宽这个行数上限。_
4. 扩展 data tools
   - `data_list_cloud_spaces`
   - `data_list_cloud_projects`
   - `data_list_cloud_tables`
   - `data_import_cloud_table`
   - `data_upload_table_to_cloud`

5. 更新工具提示和权限
   - 让模型知道 cloud/mock 表的推荐操作流程。
   - 将只读的 cloud list 工具加入默认 allow。
   - 导入/上传仍走正常工具权限流。

6. 新增设置页与配置持久化
   - `src/renderer/components/settings/SettingsPersonalAnalysis.tsx`：个人分析配置页。
   - `src/main/config/config-store.ts`：新增 `personalAnalysis` 配置段。
   - `src/preload/index.ts` / `src/main/index.ts`：暴露 datasource 列表加载 IPC。
   - `src/renderer/i18n/locales/*.json`：补齐中英文文案。

7. 输入校验
   - Host 必填，且必须是合法 `http://` 或 `https://` URL。
   - API Key 必填；如果用户粘贴 `X-API-Key:` 前缀，设置页给出明确提示。
   - Datasource 必填；如果已加载服务端列表，保存时必须选择列表中的 datasource。

## 使用流程

从 mock server 导入到 cowork：

```text
data_list_cloud_spaces
data_list_cloud_projects
data_list_cloud_tables
data_import_cloud_table
```

从 cowork 上传回 mock server：

```text
设置页保存 Host / API Key / Datasource
data_upload_table_to_cloud
```

`writeMode=CREATE` 创建新云端表；`writeMode=REPLACE` 替换已有云端表，必须传 `tableId`。

## 验证

已完成验证：

- mock server 自测：`npm run client:test`
- mock server datasource 接口验证：`GET /api/personal/analysis/v1/datasources`
- cowork 类型检查：`npm run typecheck`
- cowork 相关单测：`npm test -- data-tool-service.test.ts data-command-service.test.ts data-tool-prompt.test.ts`
- cowork 本次相关单测：`npm test -- --run tests/personal-analysis-client.test.ts tests/data-command-service.test.ts tests/config-store-env.test.ts`
- i18n JSON 与 key 覆盖检查通过。
- UI 验证：通过 `data_import_cloud_table` 成功把 `table-demo` 导入为 cowork input table，并预览成功。
- UI 验证：通过 `data_upload_table_to_cloud` 成功将 cowork 表上传回 mock server 并创建新表。

## 注意事项

- mock server 当前状态保存在内存中，测试创建/替换的表会在服务运行期间累积。
- 重新启动 mock server 后，会从 `catalog.json` 和 `data/seed-tables` 重新初始化。
- 后续接真实云端服务时，优先替换 `PersonalAnalysisClient` 内部协议实现，尽量不改 cowork 本地数据处理链路。
- 真实服务产品化时，优先保留 datasource 列表接口，不建议在客户端写死 datasource 默认值。

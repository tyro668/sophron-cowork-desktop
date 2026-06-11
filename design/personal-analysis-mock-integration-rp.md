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

为了避免用户在每次工具调用时重复传入 host 和 API Key，cowork 设置页新增
“个人分析 / Personal Analysis”配置项，并将配置持久化到 `configStore`。

配置项：

- `Host`：Personal Analysis 服务 origin，例如 `http://127.0.0.1:3000`。只保存 origin，不保存具体 API path。
- `API Key`：个人 API Key 页面生成的 `X-API-Key` 值。设置页只保存 key 本体，不包含 `X-API-Key:` 前缀。

Datasource 不再作为全局设置保存。它属于具体上传/导入操作的业务参数，应该在用户选择 space/project/table 后由服务端推导或按本次操作选择。

datasource 上传解析流程：

```text
用户发起上传
  -> 如果工具入参包含 datasourceId，直接使用
  -> 如果没有 datasourceId，cowork 调用 /api/personal/analysis/v1/datasources
  -> 如果服务端只返回一个 datasource，自动使用
  -> 如果返回多个，提示用户为本次上传选择 datasourceId
```

mock server 可以保留 `datasource-demo` 作为本地联调数据源，但 cowork 客户端不写死该默认值。

## 配置更新后的重试问题

联调时发现一个上下文一致性问题：用户在设置页修正 Personal Analysis 的 Host / API Key 后，
`configStore` 中已经是最新配置，但模型对话上下文里仍可能保留上一轮工具调用返回的
`API Key invalid` 失败结果。模型无法天然知道配置已经变化，因此有概率沿用旧结论，直接回答
“API Key 仍无效”，而不是重新调用 cloud data tool。

这个问题本质上不是 mock server 鉴权或 datasource 解析问题，而是“配置状态已更新”与“模型上下文中
旧工具结果仍可见”之间缺少版本提示。解决时同时从运行时读取、配置版本和提示词三层收口：

1. `personalAnalysis` 配置增加 `updatedAt` 版本时间。
   - 仅当连接配置真实变化时刷新，也就是 Host / API Key 发生变化时更新。
   - 单纯重复保存相同配置不刷新版本，避免制造无意义的状态变化。

2. `DataCommandService` 每次 cloud 工具调用都读取最新 Personal Analysis 配置。
   - `apiOrigin` / `apiKey` 未显式传入工具参数时，从当前 `configStore` 读取。
   - 不缓存旧的 `PersonalAnalysisClient` 连接状态，避免设置页保存后继续使用旧 key。

3. cloud data tool 描述中加入配置更新后的重试规则。
   - 当对话里出现旧的 Personal Analysis 鉴权或连接错误时，如果用户已经更新设置，模型不能把旧错误当作当前事实。
   - 新请求应重新调用对应 cloud 工具，让工具以最新配置重新验证。

4. 设置页保存成功提示同步更新。
   - 保存成功后明确提示“新的连接信息将在下一次工具请求时生效”。
   - 这既提醒用户后续需要再次触发工具，也帮助解释为什么旧对话里曾经出现过的失败结果不应继续作为结论。

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
   - `src/main/config/config-store.ts`：新增 `personalAnalysis` 配置段，并在连接信息真实变化时刷新 `updatedAt`。
   - `src/renderer/i18n/locales/*.json`：补齐中英文文案。

7. 输入校验
   - Host 必填，且必须是合法 `http://` 或 `https://` URL。
   - API Key 必填；如果用户粘贴 `X-API-Key:` 前缀，设置页给出明确提示。

8. 配置更新重试防护
   - cloud 工具每次调用读取最新保存配置。
   - cloud 工具描述加入“用户更新 Personal Analysis 设置后，应重试工具，不沿用旧鉴权错误”的规则。
   - 保存成功提示说明新连接会在下一次工具请求生效。

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
设置页保存 Host / API Key
data_upload_table_to_cloud
缺少 datasourceId 时按服务端唯一 datasource 自动解析；多个 datasource 时提示用户选择
```

`writeMode=CREATE` 创建新云端表；`writeMode=REPLACE` 替换已有云端表，必须传 `tableId`。

## 验证

已完成验证：

- mock server 自测：`npm run client:test`
- mock server datasource 接口验证：`GET /api/personal/analysis/v1/datasources`
- cowork 类型检查：`npm run typecheck`
- cowork 相关单测：`npm test -- data-tool-service.test.ts data-command-service.test.ts data-tool-prompt.test.ts`
- cowork 本次相关单测：`npm test -- --run tests/personal-analysis-client.test.ts tests/data-command-service.test.ts tests/config-store-env.test.ts`
- 配置更新相关单测：覆盖 `updatedAt` 仅在连接信息变化时刷新，以及 `DataCommandService` 每次 cloud 命令读取最新 Personal Analysis 配置。
- i18n JSON 与 key 覆盖检查通过。
- UI 验证：通过 `data_import_cloud_table` 成功把 `table-demo` 导入为 cowork input table，并预览成功。
- UI 验证：通过 `data_upload_table_to_cloud` 成功将 cowork 表上传回 mock server 并创建新表。

## 注意事项

- mock server 当前状态保存在内存中，测试创建/替换的表会在服务运行期间累积。
- 重新启动 mock server 后，会从 `catalog.json` 和 `data/seed-tables` 重新初始化。
- 后续接真实云端服务时，优先替换 `PersonalAnalysisClient` 内部协议实现，尽量不改 cowork 本地数据处理链路。
- 真实服务产品化时，优先保留 datasource 列表接口，不建议在客户端写死 datasource 默认值。
- 对话上下文里的旧工具失败结果不会自动消失；依赖工具描述和保存成功提示引导模型/用户在配置更新后重新调用工具验证最新状态。

<p align="center"><img src="resources/logo.png" alt="九思助理标志" width="180" /></p>

<h1 align="center">九思助理 · sophron cowork</h1>

<p align="center">带有结构化数据工作台的本地桌面 Agent</p>

<p align="center"><a href="./readme.md">English</a> · <a href="#能做什么">项目能力</a> · <a href="#架构">架构</a> · <a href="#产品对比">产品对比</a> · <a href="#开始使用">开始使用</a></p>

九思助理是采用 MIT 许可证的 Electron 桌面应用。它把文件协作 Agent 和数据工作台放在一起：在电脑上导入和预览表格，编排可重复执行的数据清洗流程，得到结果表；同一个工作区还可使用 Skills、MCP 工具、定时任务、记忆和经授权的远程消息。模型推理可以使用自行配置的 API 服务、本机 Ollama、ChatGPT/Codex 订阅登录，或在可用时使用应用账号支持的内置模型服务。

应用运行在本地，**但“本地应用”不等于“完全不联网”**。模型调用、MCP 连接器、远程渠道、可选的云端表同步、账号登录和更新检查都可能访问外部服务。处理敏感数据前请阅读[数据与安全边界](#数据与安全边界)。

## 能做什么

### 用 Agent 处理工作区

- 选择工作区，让 Agent 读取、整理或创建文件；在会话中附加文件和图片，并查看流式回复、工具调用和 Trace。
- 在 DeepSeek、Moonshot、阿里云百炼/DashScope、Z.AI、Anthropic、OpenAI、OpenAI Codex 订阅、OpenRouter 和 Ollama 等预设之间选择。模型是否可用、具体能力和费用由所选服务决定；账号支持的内置模型是另一个选项。
- 使用随应用提供的 `pptx`、`docx`、`pdf`、`xlsx`、`skill-creator` Skills；添加项目级或全局 Skills，并在应用中管理。
- 通过 stdio、SSE 或 Streamable HTTP 连接 MCP 服务。预设包括 Chrome DevTools、Notion、软件开发工具和内置 GUI 操作服务。GUI 自动化需要系统权限及具备视觉能力的模型，不保证适用于所有应用。

### 做可复用的数据准备

- 将 Csv/TSV、Excel 文件或包含这类文件的文件夹导入为原始表，配置读取方式并预览行列。
- 用可视化流程画布或 Prep DSL 创建数据加工和结果表。算子包括筛选、字段选择与映射、去重、缺失值处理、类型转换、排序、关联、聚合、计算字段、透视/逆透视、集合操作、数组展开、行数限制和输出节点。
- 预览流程中的节点、运行数据加工并检查结果表。图形流程、DSL 和生成的计划都会归一化为带版本的类型化计划，保存或运行前检查图结构与字段规则。
- 让 Agent 通过与 UI 共用的命令服务列出、预览、导入和处理数据资源。需求分析可帮助生成待审阅的数据加工；生成的流程须通过校验才能执行。
- 按需连接 Personal Analysis/云端数据表 API，浏览或导入远程表，也可上传本地表。这是明确的外部数据通路，并非纯本地处理的一部分。

### 复用与触发任务

- 在桌面应用中配置一次性或周期性定时任务。它们复用本地会话运行时，到点执行需要电脑与应用保持运行。
- 启用记忆，在会话前检索相关上下文、会话后吸收有用信息，并在设置中查看和管理本地记忆。
- 启用远程控制后，可将飞书、钉钉、企业微信、Slack 或 Gateway WebSocket 入口的已授权消息路由为 Agent 会话。需要配置渠道、配对/鉴权，并保持桌面端运行。

## 架构

<p align="center"><img src="resources/sophron-architecture.png" alt="九思助理产品架构与系统交互 PNG 图：左侧为可选 Personal Analysis 云表服务，中间为 Electron 本地应用与 Agent、类型化数据工作流及 DuckDB，右侧为远程消息平台、模型与 MCP 服务、本地数据源；底部标示本地结果表、Agent 文件交付以及可选的云表回写闭环" width="100%" /></p>

图的三栏沿用历史图“云端 ↔ 本地产品 ↔ 本地数据源”的关系，但内容以当前代码为准。历史图中的 FineBI Next 是场景参考，仓库并没有硬编码 FineBI Next 接口；目前实现的是按服务地址配置的 Personal Analysis API。云表可经 API 导出 Csv，再导入本地原始表；本地表可在明确选择后导出 Csv，以 CREATE 或 REPLACE 模式上传到云端。云侧图表、看板、报表和发布属于所连接的外部系统，不能算作本应用的内置数据工作台能力。

桌面 React 工作台经 preload IPC 调用 Electron 主进程。`SessionManager` 管理会话队列、Trace 与权限；Agent 运行时组合模型路由、内置工具、MCP、Skills、记忆和数据工具。数据工作台与 Agent 数据工具共用 `DataCommandService`。本地 Csv/TSV、Excel 及文件夹，和选择导入的云表，都进入原始表通路；GUI、Prep DSL 与 AI 计划统一构建类型化工作流，先做图结构与字段规则校验，再由 DuckDB 执行。SQLite 存储会话、Trace、定时任务及数据元信息，DuckDB 存储实际表数据。数据加工生成可预览、可复用的结果表；Agent 还可通过工具与 Skills 交付文档类文件。模型、MCP 与远程消息是独立的按需外部边界，本机定时任务和远程消息最终仍进入本地会话运行时。

实现细节可从[开发文档入口](docs/development/README.md)、[数据工作区说明](docs/development/data-workspace.md)和 [Prep DSL 参考](docs/prep-dsl-reference.md)开始阅读。

## 产品对比

旧的“有/没有”对比容易误导：这三个产品都能使用工具与 Skills、执行周期任务，并可在满足权限和平台条件时操作浏览器或桌面。更重要的区别是**任务在哪里执行，以及结构化数据准备是不是产品内置的工作界面**。

| 维度           | 九思助理                                                          | Claude Cowork                                                                         | OpenClaw                                                                 |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 主要形态       | 本地 Electron 聊天 **加** 原始/结果表与数据加工工作台             | 覆盖网页、桌面和移动端的 Claude 任务工作区                                            | 自托管 Agent Gateway、消息渠道与工具体系                                 |
| 结构化数据准备 | 内置数据表、可视化流程与 Prep DSL、类型化校验、DuckDB 执行        | 可通过任务、插件和连接工具处理表格并交付文件；官方文档未介绍同类内置 Prep 画布/DSL    | 官方能力概览以通用工具/Skills/插件为主，未描述本项目这套数据加工流程界面 |
| 模型选择       | 自配 API、Ollama、Codex 订阅登录，或可用时使用账号支持的模型服务  | 付费 Claude 套餐中的 Claude 模型                                                      | 可配置模型提供商及运行策略                                               |
| 远程与定时入口 | 飞书、钉钉、企微、Slack/WebSocket；**本地**定时会话               | 跨设备会话/Dispatch 与定时任务；云端任务可在设备关机时运行，本地资源仍需 Desktop 在线 | Gateway 消息渠道及 cron/tasks/heartbeat；可在主机或符合条件的节点运行    |
| 桌面交互       | 内置 GUI 操作 MCP，受系统权限和模型能力限制                       | 在支持的套餐/平台中使用浏览器和 computer use                                          | 在已启用且受支持的主机/节点上使用浏览器与 computer 工具                  |
| 执行边界       | 工作区/路径检查；命令可选用 WSL2 或 Lima 隔离，失败时可能回退本机 | 云端隔离执行；经授权可访问桌面端连接的本地资源                                        | 可配置沙盒与工具策略；普通会话默认不开启沙盒                             |

此表比较的是**官方文档中的产品默认界面和运行方式**，不表示其他产品无法通过插件或自定义代码实现类似流程。“未见同类原生数据界面”是**根据所引文档作出的推断，不等于证明其不存在**。竞品能力及套餐随时可能变化；截至 **2026-09-16** 核对了 [Claude Cowork 入门指南](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork)、[Claude 桌面操作](https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork)、[Claude 定时任务](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork)、[Claude Dispatch](https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork)、[OpenClaw 能力概览](https://docs.openclaw.ai/tools)、[OpenClaw 渠道](https://docs.openclaw.ai/channels)、[OpenClaw 模型提供商](https://docs.openclaw.ai/concepts/model-providers)、[OpenClaw 自动化](https://docs.openclaw.ai/automation)、[OpenClaw computer use](https://docs.openclaw.ai/nodes/computer-use)及 [OpenClaw 沙盒默认设置](https://docs.openclaw.ai/gateway/sandboxing/modes-scope-and-backend)。九思助理的描述依据当前仓库代码与测试。

## 开始使用

### 安装或从源码运行

当前打包配置面向 **Windows x64**（`.exe`）和 **macOS 13.5 及以上的 Apple Silicon 设备**（`.dmg`、`.zip`）。请从项目发布渠道取得可信安装包。配置中还有 Linux AppImage 构建目标，但这里不承诺已发布 Linux 安装包；内置 Node.js 要求 glibc 2.28 及以上并安装 libatomic。安装包实际内容与签名以发布构建为准。

已有源码检出时，请使用 **Node.js 22.22.1 或更新版本**及 npm（`.nvmrc` 固定了内置 Node.js 版本）：

```bash
npm install
npm run dev
```

`npm install` 会执行原生模块重建及 Node 准备；`npm run dev` 还会构建 WSL/Lima agent 和 MCP bundle。需要准备内置 Python 的文档工作流可用 `npm run dev:with-python`。打包命令为 `npm run build:sophron`、`npm run build:sophron-cn`，或一次构建两个品牌的 `npm run build`；构建会准备更多资源，并要求相应的平台构建环境。`package.json` 中的仓库地址为 SSH 入口，可能需要访问权限。

### 第一次任务

1. 打开应用，选择一个工作区文件夹。
2. 在设置中选择模型通路：填写服务商凭据、连接 Ollama、登录支持的订阅通路，或使用可用的内置账号通路。费用及数据政策请以模型服务商为准。
3. 在聊天中试试：“总结这个文件夹里的 Csv，并生成一份简短报告。”
4. 需要重复处理表格时，打开数据工作台，导入原始表、创建或描述任务、预览各节点，再运行得到结果表。

## 数据与安全边界

- 工作区文件保存在本机；会话/元信息主要存于 SQLite，表数据存于 DuckDB。**只有在使用选定的外部能力时，数据才会跨出本地边界。**
- 模型提示及相关文件内容可能发送给配置的云端模型或账号支持的模型代理。Ollama 只有在指向真正的本机实例时才可使模型推理留在本地；其他工具或连接器仍可能联网。
- MCP 服务、GUI 自动化、远程渠道、Personal Analysis 云表导入/上传、账号认证、软件更新各有独立的访问或网络边界。只启用需要的能力，并审查凭据与权限。
- Windows 的 WSL2 与 macOS 的 Lima 是**可选的命令执行隔离**，并非应用所有行为都运行在 VM 内。沙盒关闭或不可用时，执行器可能回退到本机。路径限制与权限策略提供额外检查，但不能消除误操作风险。
- 较严格的 `default` 权限档会对写入、编辑和 shell 命令请求确认，但应用初始选择的是 `auto_review`，常见操作可能自动放行；`full_access` 更宽松。请检查当前所选权限档、核查重要改动，并备份不可替代的文件。

## 开发与许可

修改代码时可运行 `npm run typecheck`、`npm run test`、`npm run lint`；模块索引与定向测试见[开发文档](docs/development/README.md)。界面修改须遵循 [UI_STYLE_GUIDE.md](UI_STYLE_GUIDE.md)。

项目采用 [MIT 许可证](LICENSE)。应用源码开放；模型订阅、API 调用及可选云服务可能另行收费。

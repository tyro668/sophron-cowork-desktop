# 输入表 Skill 标准化程序开发计划 v0.1

## 1. 目标

基于 `design/prep/input-table-skill-normalizer-design.md`，在当前应用中落地输入表标准化能力：

```text
选择文件/文件夹 -> 数据处理策略 -> auto / customize -> 标准二维表 -> 数据任务 DSL
```

本轮只支持 Python 和 Node.js 标准化程序项目，暂不内置 runtime。`auto` 沿用当前自动导入逻辑，`customize` 通过 Skill 根据规则描述和样例结构生成可执行项目，并在发布后用于生产刷新。

开发必须遵循 `UI_STYLE_GUIDE.md` 的紧凑操作型 UI 风格：低装饰、小字号、小控件、表格式摘要和清晰状态，不做大段说明式页面。

---

## 2. 当前边界

| 模块       | 边界                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 配置类型   | `src/renderer/types/index.ts` 扩展输入表 `dataProcessing`，覆盖 `auto` / `customize`、规则提示词、项目元数据、runtime、entrypoint 和依赖准备配置 |
| 存储归一化 | `src/main/data/data-task-store.ts` 保存并兼容输入表处理策略，缺省为 `auto`                                                                       |
| 配置界面   | `src/renderer/components/DataView.tsx` 在输入表编辑器中提供处理策略切换、规则描述输入、草稿项目状态和预览入口                                    |
| 版本资源   | 后续新增标准化程序 artifact/version 存储，支持 draft / published / archived、diff、rollback 和审计                                               |
| 生成链路   | Skill 根据 `rulePrompt`、安全文件结构摘要和模板约束生成 Python/Node 项目草稿                                                                     |
| 执行链路   | 预览阶段可准备依赖并运行草稿；生产阶段只运行 published 固定版本，不自动安装依赖                                                                  |
| 导入链路   | 标准化程序输出 Csv/Parquet 与 manifest，应用校验后导入 DuckDB 输入表                                                                             |

---

## 3. 阶段计划

### 阶段 1：配置模型与编辑器脚手架

状态：已完成基础脚手架。

交付：

- 输入表配置支持 `dataProcessing.strategy = 'auto' | 'customize'`。
- Excel、Csv、Folder 输入表默认配置均带 `auto`。
- 存储层读取旧配置时自动补齐 `auto`。
- 输入表配置界面支持策略切换。
- `customize` 模式提供规则描述提示词文本输入。
- 规则提示词可生成本地草稿项目快照，作为后续 Skill 生成链路的占位入口。
- 文案覆盖中英文。

验收：

- 旧输入表配置不破坏预览和保存。
- 切换 `auto` / `customize` 后可保存并重新打开。
- `npm run typecheck` 通过。

### 阶段 2：标准化程序版本资源

状态：进行中，已完成底层资源模型、metadata 表、查询 API、保存草稿和发布版本 API。

交付：

- 新增 `InputTableNormalizerArtifact` 与 `InputTableNormalizerArtifactVersion` 存储。
- 每个版本保存完整项目文件快照、`rulePrompt` 快照、runtime、entrypoint、依赖准备命令、hash 和状态。
- 支持 draft / published / archived 状态流转。
- 输入表只绑定固定 `artifactVersionId`，生产运行不跟随草稿变动。

验收：

- 可创建草稿版本、发布版本、归档旧版本。
- 修改规则描述只生成新草稿，不覆盖已发布版本。
- 版本信息可随输入表配置持久化读取。

### 阶段 3：文件结构摘要与生成上下文

状态：已完成基础摘要生成器、store API、命令层 wrapper、IPC 和 preload 调用边界。

交付：

- 对文件或文件夹生成安全结构摘要。
- Excel 摘要包含 sheet 名、表头候选、行列范围、合并单元格提示、样例行和异常区域提示。
- 文件夹摘要包含文件列表、扩展名、模板分组、大小、修改时间和抽样结构。
- 摘要不暴露未经授权的全量内容，只提供生成程序所需的有限上下文。

验收：

- 单文件和文件夹都能得到稳定摘要 hash。
- 摘要变更会提示草稿可能需要重新生成。
- 大文件不会阻塞 UI 或无限读取。

### 阶段 4：Python / Node 标准项目模板

状态：已完成共享模板模块，覆盖 Python 和 Node 最小项目结构、入口契约、依赖准备配置、锁文件 hash，并已让输入表编辑器复用该模板。

交付：

- Python 模板保持最小项目结构：`pyproject.toml`、`requirements.lock`、`normalizer/cli.py`、`normalizer/transform.py`、测试 fixture。
- Node 模板保持最小项目结构：`package.json`、`package-lock.json`、`src/cli.js`、`src/transform.js`、测试 fixture。
- 模板统一支持 `--context`、`--manifest`、`--output` 参数。
- 模板输出 manifest，描述输出文件、格式、schema、行数和告警。
- 外部依赖通过锁文件声明，依赖准备命令写入版本配置。

验收：

- 空模板可在没有业务规则时输出明确错误。
- 生成项目文件路径稳定，hash 可复现。
- Python 和 Node 模板入口契约一致。

### 阶段 5：Skill 生成与修复链路

状态：进行中，已完成 `rulePrompt + sourceSummary + 模板契约` 的草稿生成入口、版本保存、IPC/preload、输入表编辑器调用和 data tool 暴露。LLM 生成/修复项目文件仍待接入。

交付：

- 将 `rulePrompt`、文件结构摘要、语言选择和模板契约传给 Skill。
- Skill 返回完整项目文件、entrypoint、runtime、dependencyPrepare、预期 schema 和说明。
- 支持根据预览错误日志生成修复草稿。
- 所有 AI 生成结果先进入 draft，必须由用户预览/发布后才能生产使用。

验收：

- 生成失败有明确错误提示。
- 生成成功后可看到项目文件列表、入口命令、依赖命令和版本状态。
- 修复不会直接覆盖 published 版本。

### 阶段 6：预览执行与依赖准备

状态：进行中，已完成 manifest 契约校验、项目解包 runner、可选依赖准备、入口命令执行、store 预览 API、IPC/preload、data tool 和输入表编辑器预览按钮。生产级日志、依赖缓存和更细的错误分类仍待完善。

交付：

- 预览草稿前可运行依赖准备命令。
- Python 支持 venv + `pip install -r requirements.lock`。
- Node 支持 `npm ci`。
- 预览运行时传入 context、manifest 和输出目录。
- 读取 manifest 并把结果导入预览表。

验收：

- 依赖准备失败、runtime 不存在、入口失败、manifest 缺失都有可读错误。
- 预览成功能显示标准二维表。
- 生产刷新不会自动安装依赖。

### 阶段 7：发布、回滚与差异

状态：进行中，已完成发布 API、版本列表 API、data tool、输入表编辑器发布按钮、版本记录列表、旧版本重新发布回滚、发布后配置状态回写、版本差异摘要和文件级差异展开。更完整的代码内容 diff 视图仍待完善。

交付：

- 草稿预览通过后可发布。
- 发布时记录文件树 hash、依赖锁 hash、来源摘要 hash 和发布时间。
- 支持查看版本列表、文件差异、规则描述差异和回滚到旧 published 版本。

验收：

- 输入表生产绑定发布版本。
- 回滚后生产使用旧版本。
- 版本差异界面保持紧凑表格化展示。

### 阶段 8：生产刷新集成

状态：进行中，已完成输入表导入/刷新识别 `customize + published` 配置、执行固定版本标准化程序、读取 manifest 输出并导入 DuckDB，并在 runner 返回命令、cwd、耗时、退出码、stdout/stderr 等基础运行元数据。生产日志落表、依赖缓存校验和更完整的运行审计仍待完善。

交付：

- 数据任务运行时识别输入表 `customize` 配置。
- 解包 published 标准化程序项目。
- 校验 runtime、依赖锁和 entrypoint。
- 执行标准化程序并读取 manifest。
- 将输出 Csv/Parquet 导入 DuckDB，再进入现有数据任务 DSL。

验收：

- `auto` 输入表维持当前行为。
- `customize` 输入表在没有 published 版本时阻止生产运行。
- 生产日志包含版本号、runtime、入口命令、耗时、输出行数和告警。

### 阶段 9：测试与质量收口

状态：进行中，已补充 normalizer Python/Node 模板、hash、manifest 校验、Node 模板 runner 端到端测试、runner 运行元数据断言、命令层 draft -> preview -> publish -> list 状态流转测试，以及复杂 Excel / folder source summary fixture 测试。生产运行日志落表与审计测试仍待补齐。

交付：

- 类型与存储归一化测试。
- artifact/version 状态流转测试。
- Python/Node 模板契约测试。
- manifest 校验和错误处理测试。
- 至少一个复杂 Excel 或 fixture 文件夹的端到端预览测试。

验收：

- `npm run typecheck` 通过。
- 相关单元测试通过。
- 回归确认旧输入表和数据任务不受影响。

---

## 4. 实施顺序

1. 收口阶段 1，让当前配置模型和 UI 可编译、可保存。
2. 增加版本资源存储，避免后续把项目文件直接塞进输入表配置形成长期技术债。
3. 增加文件结构摘要和模板生成入口。
4. 接入 Skill 生成与预览执行。
5. 最后接入生产刷新，确保只有 published 固定版本参与定时任务。

---

## 5. 当前代码状态

已开始：

- 类型层已加入 `DataInputTableProcessingConfig`、Python/Node runtime、entrypoint、依赖准备和项目文件类型。
- 存储层已对 Excel、Csv、Folder 输入表补齐 `dataProcessing`。
- 输入表编辑器已加入 `auto` / `customize` 选择和规则描述输入。

下一步：

- 补齐草稿项目生成占位函数。
- 补齐缺失 i18n 文案。
- 跑通类型检查。

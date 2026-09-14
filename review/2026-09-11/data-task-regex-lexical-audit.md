# 数据任务正则表达式与词法检查审查

审查日期：2026-09-11

## 实施结果

已按三阶段计划完成改造：

- Filter 的编辑校验和运行时 SQL 编译现已共享 `expression-tokenizer`；删除了运行时重复词法器，以及格式化阶段用正则猜测裸字符串并自动补引号的逻辑。
- Join 和 Aggregate 的结构解析已改用 `PrepTokenCursor`。Join 已支持并保留 `expect`、ASOF `direction`，同时兼容旧配置中的 `cardinality` 字段；运行时会对 `one_to_one`、`one_to_many`、`many_to_one` 的连接键唯一性产出 `joinCardinalityMismatch` 告警。
- 字段引用统一通过 `parseFieldRefExact` 或表达式 Token 处理，支持限定字段、Unicode、字段名中的点号、`]` 和转义反引号。
- 编辑器补全改用共享词法状态，并从公共关键词表读取补全项；未闭合的反引号字段仍可补全，字符串和注释不会误触发。
- JavaScript 入口与函数索引使用 Acorn AST/Tokenizer；Python 入口和调用结构使用标准库 `ast`；JSON 与 Markdown 代码围栏使用字符串和转义感知的扫描器。
- 自然语言中的删除和货币清洗意图已移入独立的 `requirement-intent` 模块，用中英文关键词表和词元边界匹配字段名。

仍保留的正则只用于有限字符识别、字面量外形、转义、展示高亮和错误诊断兜底，不再承担上述数据任务结构解析职责。

## 结论

可以，而且核心数据任务链路中有一批正则表达式应当改为词法或语法级检查。项目已经具备三套可复用的基础能力：

- Chevrotain 驱动的 Prep DSL 词法器：`src/shared/prep-dsl/tokens.ts`
- 带位置和结构限制的表达式词法器：`src/shared/expression-tokenizer.ts`
- Token 游标与顶层结构扫描器：`src/shared/prep-dsl/syntax/token-cursor.ts`、`scanner.ts`

问题在于这些能力只覆盖了部分算子。Join、Aggregate、字段提取、生成代码校验、编辑器补全仍在直接用正则解析结构，形成了多套语法定义。正式改造应采用“词法器识别 Token，递归下降或 Token 游标验证语法，AST/Schema 验证语义”的分层方式。仅把复杂正则改成另一个复杂正则，无法解决语法漂移。

本次按 TypeScript AST 统计了 `src/main/data`、`src/shared/prep-dsl`、`src/shared/expression-tokenizer.ts`、数据界面和 DSL 编辑器，共发现 **231 个正则字面量或动态 `RegExp`，分布于 40 个文件**。大多数属于转义、清洗、类型字面量或语法高亮，可以保留；其中约 20 处参与结构判断，建议分批替换。

## 已确认的严重问题

### P1：Join 语法已经与设计文档不一致

`src/shared/prep-dsl/operators/join.ts:93-171` 使用正则拆出 Join 头部，再由 `parseClauses` 扫描 `on`、`keep`、`suffix` 等子句。设计文档在 `design/prep/data-task-operator-dsl.md:738-776` 明确定义了：

- `expect one_to_one | one_to_many | many_to_one | many_to_many`
- ASOF Join 的 `direction backward | forward | nearest`

当前分句关键字列表没有 `expect`，ASOF 列表也没有 `direction`。因此 `expect many_to_one` 会被并入前一个 `keep` 子句并报 `invalidJoinKeep`。

已运行两个现有用例：

```text
npm test -- --run tests/data-duckdb-store.test.ts \
  -t 'runs a saved DSL workflow with a left join|runs a saved DSL workflow with an asof join'
```

结果为 2 个用例均失败，失败位置是 `tests/data-duckdb-store.test.ts:891` 和 `:1514` 的“解析错误应为 0”断言。

建议：用 `PrepTokenCursor` 重写完整 Join 语法，按 Token 顺序消费 Join 类型、右表、别名和各子句；把子句集合、顺序、重复规则和互斥规则定义在同一份语法元数据中。`expect` 和 `direction` 应进入 AST、Schema、编译器和格式化器的同一条链路。

### P1：过滤条件存在两套词法器，可能出现“编辑时通过、运行时失败”

- `src/shared/prep-dsl/operators/filter.ts:33-219` 使用共享 `tokenizeExpression` 做编辑和保存前校验。
- `src/main/data/operators/filter.ts:1-259` 又实现了一套运行时词法器和递归下降编译器。

两套词法规则已经不同。例如共享词法器支持 SQL 单引号转义 `''`，运行时词法器只处理反斜杠转义。`filter [name] = 'O''Brien'` 可以在共享校验层被识别成一个字符串，但运行时会拆成两个相邻字符串 Token。长度限制、运算符集合和字段转义行为也分别维护。

建议：保留运行时递归下降编译器，但删除它的内联 Tokenizer；共享一个无业务语义的表达式 Tokenizer，由编辑器校验器和 SQL 编译器各自消费相同 Token。Token 应携带 `start/end/line/column`，运行时错误可直接定位到 DSL。

### P1：生成代码的结构校验会匹配注释和字符串

`src/main/data/input-table-normalizer-generator.ts:431-471` 使用以下正则确认入口函数和 Python 调用：

- `export async function transform`
- `def transform(`
- `max(` 与 `default=`

这些表达式无法区分代码、注释和字符串，也无法确认函数是否位于模块顶层。注释中的 `export async function transform` 或 `def transform(` 会被误认为有效入口；字符串或注释中的 `max(..., default=...)` 也可能触发错误。

建议：

- Node 代码直接使用项目现有 Acorn 解析为 AST，验证顶层 `ExportNamedDeclaration > FunctionDeclaration`，并检查函数名、`async` 和参数。
- Python 代码在现有 Python 执行环境中调用标准库 `ast.parse`，只接受模块顶层 `FunctionDef/AsyncFunctionDef`，并通过 AST 检查 `max` 调用的参数与 `default` 关键字。
- 占位文本检查可以保留为启发式提示，但不能作为结构校验。

### P1：字段引用在不同层被重复解析，复杂字段名可能被破坏

以下位置通过正则去掉方括号或重新提取字段：

- `src/main/data/operators/join.ts:16-20`
- `src/main/data/operators/utils.ts:56-58`
- `src/main/data/store/task-workflow-store.ts:639`
- `src/main/data/workflow/utils.ts:74-90`
- `src/shared/prep-dsl/operators/parser.ts:367-380`

这套处理无法可靠覆盖限定字段、反引号字段、转义反引号，以及字段名本身含 `.` 或 `]` 的情况。更严重的是，前端/共享解析器已经产出结构化字段引用，运行时又退回字符串拆分，丢失了前一层已经确认的结构。

建议：所有字段输入统一通过 `parseFieldRefExact`，或让算子配置只保存结构化 `{source, name}`。运行时不得再用 `replace(/^\[|\]$/g, '')` 或 `split('.')` 解释字段。表达式字段收集应遍历 `tokenizeExpression` 的 `FieldRef` Token，并组合 `FieldRef Dot FieldRef`，删除独立的字段正则定义。

## 应改为 Token/AST 检查的位置

| 优先级 | 位置                                                                        | 当前用途                             | 推荐实现                                                                                    |
| ------ | --------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| P1     | `src/shared/prep-dsl/operators/join.ts:89-428`                              | Join 头部、条件、Keep 别名和子句解析 | 单一 Token 游标 + Join 递归下降解析器                                                       |
| P1     | `src/shared/prep-dsl/operators/aggregate.ts:18-46`                          | 用 `metrics` 分隔 Group 与指标       | Token 游标在顶层识别 `metrics`，避免字段名或字符串中的同名文本干扰                          |
| P1     | `src/main/data/operators/filter.ts:74-259`                                  | 运行时重新词法化过滤条件             | 复用共享表达式 Tokenizer，保留独立 SQL 编译器                                               |
| P1     | `src/main/data/input-table-normalizer-generator.ts:431-588`                 | JS/Python 入口和 Python 调用结构     | Acorn AST + Python `ast`                                                                    |
| P1     | `src/main/data/operators/join.ts:16-20`、`store/task-workflow-store.ts:639` | 从字符串提取字段名                   | `parseFieldRefExact` 或结构化字段配置                                                       |
| P2     | `src/main/data/workflow/workflow-generator.ts:170-190`                      | 从模型回复中寻找代码块和 `main`      | 行级 Markdown Fence 扫描 + Acorn AST；不要搜索 `function main(` 文本                        |
| P2     | `src/main/data/workflow/utils.ts:16-27`、Normalizer Generator `:591-605`    | 从模型回复提取 JSON                  | Fence 扫描器 + JSON 字符串/转义感知的对象边界扫描，最终仍由 `JSON.parse` 验证               |
| P2     | `src/main/data/workflow/utils.ts:74-90`                                     | 从表达式收集字段名                   | 遍历表达式 Token，不先用正则移除字符串                                                      |
| P2     | `src/renderer/components/PrepDslEditor.tsx:149-170`                         | DSL 高亮                             | 由共享 Token 类型映射 CodeMirror 样式，避免关键词和字面量规则漂移                           |
| P2     | `src/renderer/components/PrepDslEditor.tsx:455-484,590-594`                 | 字段自动补全上下文                   | 增量扫描光标前 Token；支持含空格和转义符的反引号字段                                        |
| P3     | `src/main/data/workflow/javascript-runtime.ts:115-147`                      | JavaScript 解析失败后的函数索引      | 正常路径继续使用 Acorn；失败修复路径改为容错 Token 扫描，避免注释中的 `function` 被当成声明 |

## 可以继续使用正则的位置

以下用途是有限、封闭的字符识别，正则更清晰，替换为完整词法器不会提高准确性：

- Chevrotain Token 本身的模式定义：空白、括号、运算符、数字和字符串。
- 已锚定的基本字面量校验：布尔、整数、小数、日期外形。日期仍应在正则后做日历有效性验证；`input-source.ts` 已这样处理。
- SQL、DSL、Markdown 中的字符转义与安全文件名清洗。
- CRLF 分行、扩展名识别、CSV 引号转义。
- 堆栈行号提取和错误消息兼容匹配。这些属于诊断兜底；长期可用结构化错误码替代，但不需要词法器。
- 纯展示用的语法高亮规则，只要它不承担校验职责。当前问题是高亮规则与正式语法重复维护，因此建议共享 Token 分类，而不是因为正则本身不安全。

自然语言需求中的“删除、去除、remove、drop”等意图正则也不适合直接替换成 DSL 词法器。它们应移入独立的需求意图识别模块，使用中英文分词、关键词表和明确的置信度/回退规则；这属于自然语言分类，不属于编程语言词法分析。

## 建议的目标结构

```text
原始 DSL
  -> 统一 Tokenizer（Token + 精确位置）
  -> Operator Parser（每个算子只消费 Token）
  -> AST
  -> Schema / 语义校验
  -> SQL / Workflow IR 编译

编辑器高亮、补全、保存校验、运行时编译
  -> 共享同一 Token 定义与字段引用规则
```

建议新增或收敛为以下公共能力：

1. `tokenizePrepExpression`：统一字段、字符串、数字、运算符、标点和位置。
2. `PrepTokenCursor`：增加 `mark/reset`、顶层关键字、限定字段、操作符和源码切片能力。
3. `parseFieldRefTokens` / `collectFieldRefs`：替代所有方括号和点号正则。
4. `extractFencedBlock`：按行识别 Markdown Fence，支持语言标签、CRLF 和未闭合 Fence 的明确错误。
5. `validateJavaScriptModule` / `validatePythonModule`：用 AST 返回入口、函数签名和精确诊断。

## 改造顺序与验收条件

### 第一阶段：消除运行语义分叉

1. 统一 Filter 的共享 Tokenizer。
2. 删除运行时字段名的正则拆分。
3. 用 Token 游标重写 Join，并补齐 `expect`、`direction`。

验收：编辑器能保存的过滤表达式必须能被运行时编译；设计文档中的全部 Join 示例可解析、格式化后再解析，并保持 AST 等价；上述两个失败用例通过。

### 第二阶段：收敛 DSL 结构解析

1. 重写 Aggregate 头部。
2. 用 Token 遍历替代字段提取正则。
3. 让编辑器补全读取统一的词法状态。

验收：字段名包含空格、点号、`]`、转义反引号或关键字时，解析、补全、预览和运行结果一致。

### 第三阶段：收敛生成代码检查

1. JavaScript 全部走 Acorn AST。
2. Python 全部走 `ast.parse`。
3. JSON/代码块使用统一 Fence 与边界扫描器。

验收：注释和字符串中的 `function main`、`transform`、`max(` 不会被当作代码结构；语法错误能返回准确行列；有效的顶层入口不会因格式、注释或换行方式被拒绝。

## 必要回归用例

- Join：`expect`、`direction`、重复子句、乱序子句、关键字出现在字符串或反引号字段中。
- 字段：`[table].[field]`、`[\`order.total\`]`、`[\`a]b\`]`、`[\`a\\\`b\`]`、Unicode 字段。
- Filter：SQL 双单引号、反斜杠转义、日期、科学计数法、嵌套括号、空 IN 列表。
- Aggregate：Group 字段名包含 `metrics`，指标表达式包含嵌套函数和逗号。
- 生成代码：注释/字符串中的伪入口，嵌套函数，Python 装饰器与异步函数，注释中的 `max(default=...)`。
- 编辑器：光标位于未闭合反引号字段时仍能给出正确补全，且不会在字符串或注释中触发字段补全。

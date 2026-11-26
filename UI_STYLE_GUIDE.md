# 九思助理 UI 风格规范

本项目面向长时间使用的桌面工作台，统一采用**低噪、实底、高密度贴边网格、多色系语义化**的现代工作台视觉体系。所有新增页面、组件开发与界面改造均须遵循本规范。

---

## 1. 设计原则

- **安静、克制、实底**：界面服务于高频内容阅读与数据操作，采用纯色实底与 `1px` 细线建立层级，避免营销页式大标题、大留白和装饰性图形。
- **零重特效与快响应**：禁止毛玻璃（`backdrop-filter` 在全局已被强制关闭）、渐变背景、发光、霓虹描边、大面积半透明叠层和背景纹理；全局过渡与动画收紧至 `120ms`，并遵循 `prefers-reduced-motion`（Radix 弹层禁用动画以避免闪烁）。
- **去解释化配置**：配置界面只展示**配置项、当前值和必要状态**，不在配置项下方增加大段解释性小字；确需补充说明时，使用字段标签旁的帮助入口或独立文档。
- **结构稳定优先**：未明确要求布局改版时，保持既有页面分栏、尺寸、信息顺序与交互路径不变。

---

## 2. 主题体系与语义 Token

所有颜色、表面、边框与阴影均定义在 `src/renderer/styles/globals.css` 并通过 `tailwind.config.js` 映射为语义类（支持 Tailwind 透明度修饰符，如 `bg-accent/10`）。**严禁在组件中硬编码色值或为单一主题编写条件样式。**

### 2.1 明暗模式与五套色系

- **明暗切换**：`:root` 默认定义深色变量，`:root.light` 定义浅色变量（限定在 `:root` 上，避免 React Flow 等子树的 `.light` 类污染变量）。用户可在「设置 → 通用 → 外观」选择 `light` / `dark` / `system`（新用户默认 `light`）。
- **五套主题色系**：通过根节点属性 `data-accent-theme` 切换，持久化在 `AppConfig.accentTheme`（默认 `lavender`；无属性时样式表回退为 `mint` 基准色板）：

| 色系标识              | 名称     | 主色 `--color-accent` | 主色上前景 `--color-accent-foreground` |
| --------------------- | -------- | --------------------- | -------------------------------------- |
| `mint`（基准/无属性） | 薄荷绿   | `#2F8F63`             | `#0C1210`                              |
| `lake`                | 湖蓝     | `#2F9FD1`             | `#0C1210`                              |
| `lavender`（默认）    | 薰衣草紫 | `#7656E8`             | `#FFFFFF`                              |
| `orange`              | 暖橙     | `#E47B2E`             | `#0C1210`                              |
| `rose`                | 玫红     | `#D94D78`             | `#0C1210`                              |

- **同色相中性色板**：换色不仅替换 accent 系列变量，同时将中性色板（背景、表面、边框、文字、阴影、数据网格、工作流画布、代码预览）的色相旋转至对应色系，保持饱和度与明度关系一致；`success`、`warning`、`error` 与语法高亮语义色保持独立。新增色系必须完整提供浅色与深色两套中性色板。
- **品牌标识**：`BrandMark`（支持 `mark` / `fold` 变体）颜色跟随 `--color-brand-mark`。

### 2.2 核心语义 Token 对照表

下表以 `mint` 基准色板的浅色 / 深色值为例：

| 语义用途                  | CSS 变量                                | Tailwind 类                          | 浅色基准                          | 深色基准                          |
| ------------------------- | --------------------------------------- | ------------------------------------ | --------------------------------- | --------------------------------- |
| 应用底色                  | `--app-backdrop`                        | —                                    | `#F4F8F5`                         | `#111D18`                         |
| 主工作区背景              | `--color-background`                    | `bg-background`                      | `#FBFDFB`                         | `#17251F`                         |
| 次级背景                  | `--color-background-secondary`          | `bg-background-secondary`            | `#F4F8F5`                         | `#1C2C25`                         |
| 卡片 / 表单表面           | `--color-surface`                       | `bg-surface`                         | `#FFFFFF`                         | `#21342B`                         |
| 弱化表面（标签列/表头区） | `--color-surface-muted`                 | `bg-surface-muted`                   | `#F7FAF8`                         | `#1B2B24`                         |
| 悬停表面                  | `--color-surface-hover`                 | `bg-surface-hover`                   | `#F1F8F3`                         | `#294238`                         |
| 选中 / 激活表面           | `--color-surface-active`                | `bg-surface-active`                  | `#EAF6EE`                         | `#315243`                         |
| 主色实底                  | `--color-accent`                        | `bg-accent`                          | `#2F8F63`                         | `#2F8F63`                         |
| 主色悬停                  | `--color-accent-hover`                  | `bg-accent-hover`                    | `#267B54`                         | `#267B54`                         |
| 主色浅底                  | `--color-accent-muted`                  | `bg-accent-muted`                    | `#EAF6EE`                         | `#254737`                         |
| 主色文字                  | `--color-accent-text`                   | `text-accent` / `text-accent-text`   | `#267B54`                         | `#8ED9B2`                         |
| 主色上前景                | `--color-accent-foreground`             | `text-accent-foreground`             | `#0C1210`                         | `#0C1210`                         |
| 主要文字                  | `--color-text-primary`                  | `text-text-primary`                  | `#24362E`                         | `#F2F8F4`                         |
| 次要文字                  | `--color-text-secondary`                | `text-text-secondary`                | `#52675D`                         | `#C7D7CE`                         |
| 弱文字 / 占位             | `--color-text-muted`                    | `text-text-muted`                    | `#718078`                         | `#91A79B`                         |
| 强调边框                  | `--color-border`                        | `border-border`                      | `#CFDFD4`                         | `#3B5549`                         |
| 常规边框                  | `--color-border-muted`                  | `border-border-muted`                | `#DCE8DF`                         | `#30483D`                         |
| 细分隔线                  | `--color-border-subtle`                 | `border-border-subtle`               | `#E6EEE8`                         | `#293F35`                         |
| 成功 / 警告 / 错误        | `--color-success` / `warning` / `error` | `text-success` / `warning` / `error` | `#2F8F63` / `#B47B16` / `#D44D5C` | `#48B87D` / `#D6A441` / `#E1656F` |

> 专项领域 Token 同样定义在 `globals.css`：`--data-grid-*`（数据表）、`--workflow-*`（画布点阵/连线/小地图）、`--code-preview-*` / `--code-token-*` / `--color-syntax-*`（代码预览与表达式高亮）。

### 2.3 对比度强制规则

- **实心状态按钮禁止写 `text-white`**：使用 `bg-accent`、`bg-error`、`bg-success` 时，前景文字必须配对 `text-accent-foreground`、`text-error-foreground`、`text-success-foreground`。在湖蓝、橙色等主题下白字对比度不足 4.5:1；前景 token 已针对全色系（含 `lavender` 单独覆写白字）核验满足 ≥4.5:1。
- **强调文字使用 `text-accent`**：Tailwind 中 `text-accent` 已映射为 `--color-accent-text`，在浅色与深色背景下均保证可读性，避免直接拿背景主色 `--color-accent` 当小字颜色。

---

## 3. 容器、阴影与紧凑网格体系

### 3.1 表面层级与阴影

- **禁止嵌套卡片**：一个区域已有边界时，内部优先通过 `1px border-border-subtle` 分隔线或分组标题行组织，不再叠加卡片套卡片。
- **圆角梯度**：分组块 `--radius-group: 6px`；常规按钮/输入框 `8px`（`rounded-lg`）；独立卡片 `10px–12px`；对话输入框 `16px`；用户气泡 `18px`；开关/胶囊/头像使用 `rounded-full`。
- **阴影克制**：仅定义三档语义阴影——`shadow-soft`（轻控件）、`shadow-card`（需要轻微浮起的独立卡片）、`shadow-elevated`（弹窗、下拉菜单、浮层）。贴边配置区与贴边表格不使用阴影。
- **间距 Token**（定义于 `globals.css` 与 `form-grid.css`）：`--space-inset: 12px`、`--space-inset-lg: 16px`、`--space-group: 10px`、`--radius-group: 6px`。

### 3.2 两大内容布局范式

项目根据页面角色区分「贴边平铺」与「内缩分组」两种范式，不可混用：

#### 范式 A：贴边平铺配置页（`.ui-config-flush` + `.ui-form-flush`）

适用于**核心详情页与编辑器**（原始表编辑器、结果表编辑器、自动化编辑器、云端连接数据源、原始数据源详情、自定义脚本/清洗规则工作台）：

- **边到边无卡片**：容器挂 `.ui-config-flush`（公共类 `configFlushBodyClass`），内部 `.ui-group` 自动去掉外边距、圆角、左右边框与阴影，改为全宽 `1px` 底部分隔线衔接。
- **右侧防贴边留白**：`.ui-config-flush` 下的表单行与分组标题保留 `padding-right: 10px`，防止下拉箭头、开关、右侧操作单元紧贴窗边。
- **统一表单行栅格**：
  - 分组标题行 `.ui-group-title`：高 `30px`、`bg-surface-muted` 底、`12px` 半粗文字、底部 `1px` 分隔线。
  - 表单行 `.ui-form-row`：两列网格 `104px minmax(0, 1fr)`（宽标签场景 `.ui-form-row-wide` 为 `200px`），贴边模式下最小行高 `36px`，标签列 `bg-surface-muted` + 右侧 `1px` 竖线。
- **值控件填满单元**：`.ui-form-flush` 中的输入框、下拉框（`button[role="combobox"]`）、日期选择器、`.ui-flush-control` 及内嵌提示词框（`.ui-composer-flush`）横向占满整个值单元格——去掉自身边框、圆角和阴影，悬停呈现 `bg-surface-hover`。只有一行明确存在多个语义单元（如「时间 + 添加时间」、数值 + 单位、行内操作按钮）时才拆分单元格。
- **克制的强调操作单元 `.ui-accent-cell`**：在编辑器顶栏与表单内部，用贴边文字单元（accent 文字 + 图标、透明底、悬停 `accent-muted/60`）承载「立即运行」「重新运行」「+ 添加…」「更改数据源」等操作，不使用高饱和整块实心按钮。
- **危险区平铺**：编辑器内的删除/危险操作区采用常规贴边分组 + 红色文字操作单元 + 影响范围说明，不使用红框警告卡片（`.ui-group-danger` 仅用于内缩卡片场景）。

#### 范式 B：内缩分组卡片（默认 `.ui-group`）

适用于**设置页**（`.settings-content`）、**向导页**（如数据源创建向导 `groupClass`）和**常规表单弹窗**（`.ui-dialog-pad`）：

- 组内紧凑：行间无间隙，仅用 `1px border-border-subtle` 分隔。
- 组间留白：容器内边距 `--space-inset`（`12px`），组间 `--space-group`（`10px`），`1px` 细边框 + `6px` 圆角。

### 3.3 算子配置表单栅格（`.opg-frame` / `.opg`）

数据加工算子表单统一使用 `workflow-forms/shared/FormGrid.tsx` + `form-grid.css`：

- **贴边容器**：`.opg-frame` 紧贴配置面板边缘（`margin: 0; border: 0; border-bottom: 1px solid var(--color-border-subtle); border-radius: 0;`）。
- **单 Grid 竖线对齐**：每个算子表单共享同一套 `grid-template-columns`，标签列（`104px`、`surface-muted`）、表头（`30px`）、数据行（`36px`）、添加行（`34px`）、提示/警告/错误条（`30px`）通过列合并共享纵向 `1px` 分隔线。
- **无框嵌入控件**：单元格加 `.ctl` 类，内部输入/下拉去除边框圆角填满单元格；聚焦时以 `inset 0 0 0 1px var(--color-accent)` 提示。
- **行操作与校验反馈**：行操作按钮（`28px` 宽）常显；校验出错的单元格标红（`.err`），并在下方紧跟一条整行错误条（`.erow`）。

---

## 4. 导航、工具栏与弹窗外壳

### 4.1 顶部页签栏、工具栏与编辑器顶栏

所有主工作区页面（数据、技能、自动化）共用 `data-view/shared.tsx` 的规范类名，确保切换与钻取无高度跳动：

- **顶部页签栏（`h-12` / `48px`）**：使用 `underlineTabBarClass` + `fixedUnderlineTabTriggerClass`。单页签固定宽度 **`112px`**（`FIXED_TAB_WIDTH`），右侧 `1px` 分隔线；激活态为 `bg-accent-muted` + `text-accent` + 底部 `2px` accent 指示线。
- **底部页签栏（`h-12` / `48px`）**：用于原始表/结果表编辑器与云端空间底栏（`bottomTabBarClass` + `bottomTabTriggerClass`），同为 `112px` 固定宽，指示线位于顶部 `2px`。
- **列表页「+ 新建…」入口**：不放在主工具栏左侧，也不做整块实心主色按钮；通过 `TabBarActionSlot` + `TabBarAction` + `tabBarNewCellClass` 固定在**顶部页签栏最右侧**（同高贴边单元、左侧 `1px` 分隔、accent 文字与图标、悬停 `accent-muted/60`，文案随页签变化）。
- **列表扁平工具栏（`h-10` / `40px`）**：使用 `flatToolbarRowClass` 紧贴页签栏底线与表格顶线。搜索框（`DataTableSearch`）从左边缘展开，右侧放无圆角贴边工具按钮（`DataToolbarButton`）及 `40px` 宽的 `⋯` 菜单（`DataMoreMenu`）。
- **编辑器顶栏（`h-12` / `48px`）**：与列表页签栏等高；左侧 `104px` 返回单元，右侧 `92px` 工具单元与 `40px` `⋯` 菜单（删除等破坏性操作收纳在 `⋯` 中）。

### 4.2 左侧导航栏（无横向分隔线布局）

- **macOS 顶部拖拽区**：不显示 Logo；红绿灯（`trafficLightPosition { x: 16, y: 17 }`）右侧留 `84px` 左内边距，同行仅展示应用名称（`13px` 半粗，不可交互），整行高 `48px` 为窗口拖拽区，与右侧页签栏 / 标题栏等高对齐。折叠窄栏同样保留 `48px` 拖拽区。Windows / Linux 保持常规品牌头。
- **无横向分隔线**：导航项、搜索区、置顶区、项目与任务列表均不使用横向分隔线，**仅底栏上方保留 `1px border-t border-border-subtle`**；列表与导航项左右统一 `mx-2.5` 轻内缩。
- **层级与行高**：
  - 一级导航行高 `36px`（`h-9 px-2.5`）；选中态为浅底 + 主色文字/图标。
  - 项目分组标题为静态弱字 `11.5px` 半粗（`text-text-muted`）；项目头行高 `30px`（`bg-surface-active/60`），仅用 `Folder` / `FolderOpen` 单图标位区分展开折叠，不显示真实路径或任务数。
  - 任务行高 `31px`，靠 `pl-[18px]` 缩进表明归属（不画竖向引导线）；当前任务以左侧 **`2px` accent 竖条** + `bg-accent-muted/70` 标记，悬停 `bg-surface-hover`，`⋯` 菜单仅悬停显示；置顶区同样式。
- **可拖拽折叠**：侧栏右边缘提供悬停显隐的拖拽/点击折叠手柄。

### 4.3 弹窗规范

- **常规表单/确认弹窗**：基于 `ui/Dialog`（内置 Portal、焦点陷阱、多弹窗栈管理、Esc 与 `busy` 防误关）。底部双按钮优先采用 `.ui-footer-split`（均分两格、`36px` 高、`1px` 竖线分隔、`6px` 外圆角）。
- **贴边选择器/历史弹窗**（如「选择云端表」「版本历史」）：Dialog 面板设 `p-0`，顶部为 `grid-cols-[minmax(0,1fr)_40px]` 标题关闭行，中间直接承接 `.ui-group-title` 与贴边表单/表格，底部为贴边操作行（确认操作用 `.ui-accent-cell` + 左侧 `1px` 分隔）。

---

## 5. 字体与信息层级

- **字体栈**：
  - 无衬线：`'PingFang SC', 'Inter', 'SF Pro Text', 'Microsoft YaHei UI', 'Noto Sans SC', sans-serif`
  - 等宽：`'JetBrains Mono', 'SF Mono', 'Menlo', monospace`（代码预览、表达式、版本号、日志与数值列）
- **字号梯度**：
  - 页面主标题：`15px–18px`，`font-weight: 600`
  - 正文、对话内容与常规输入：`13px–14px`，`font-weight: 400`
  - 紧凑表单单元与算子控件：`12.5px`
  - 分组标题、表头、字段标签、徽章与工具栏按钮：`11.5px–12px`
- **字重克制**：正文 `400`，按钮/导航/标签/强调 `500`，标题 `600`；正文不使用 `700+` 粗黑。
- **信息色阶**：主值用 `text-text-primary`，标签与辅助说明用 `text-text-secondary`，占位、时间戳与弱状态用 `text-text-muted`；列表数字与计数列使用 `tabular-nums`。

---

## 6. 通用控件原语与选型规则

### 6.1 基础原语层（`src/renderer/components/ui/`）

新代码一律优先从 `src/renderer/components/ui` 导入基础原语，禁止裸写重复样式；样式合并统一使用 `cn()`（`tailwind-merge`）。`components/Glass*` 仅作既有调用点的兼容封装，不再用于新代码。

| 原语                      | 关键能力与约定                                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                  | `variant`: `primary` / `secondary` / `ghost` / `danger` / `danger-outline`；`size`: `sm(28px)` / `md(32px)` / `lg(36px)` / `icon(32×32)`；内置 `loading` 态与 `focus-visible` 环。        |
| `Input`                   | 默认 `h-8 rounded-lg text-[13px]`，支持 `error` 态自动切换错误边框与 focus ring。                                                                                                         |
| `Select` / `DropdownMenu` | 基于 Radix，实底 `bg-surface` + `shadow-elevated`，导出标准类（`selectTriggerClass`、`menuContentClass`、`menuItemClass`）供组合扩展；支持异步加载 spinner 与固定底栏（如「加载更多」）。 |
| `Switch`                  | 基于 Radix，支持 `md` / `sm`，开启为 `bg-accent`，关闭为 `bg-surface-active`。                                                                                                            |
| `Dialog`                  | 含 `DialogHeader` / `DialogTitle` / `DialogDescription` / `DialogBody` / `DialogFooter`，默认不点击遮罩关闭（`closeOnOverlayClick={false}`）。                                            |
| `Badge`                   | `tone`: `default` / `accent` / `success` / `warning` / `error`，`rounded-md` 紧凑圆角标签。                                                                                               |
| `Tabs`                    | 语义化 Radix Tabs，配合 `underlineTabTriggerClass` / `bottomTabTriggerClass` 实现工作区页签。                                                                                             |
| `InlineBanner`            | `tone`: `info` / `success` / `warning` / `error`；用于页内持久错误与警告提示（**优先替代瞬时 Toast**），支持 `detail` 折叠原始技术报错和 `actions` 操作区。                               |
| `Kbd`                     | 快捷键徽章（`xs` / `sm`），`bg-surface` + 细边框。                                                                                                                                        |

### 6.2 控件选型强制约定

- **分段控件 vs 下拉框**：
  - 分段控件**仅用于** 2–3 个简短、互斥且值得同时看到的选项（如 升序 / 降序、复用 / AI 生成、浅色 / 深色 / 跟随系统）。
  - 以下场景**一律使用占满单元的下拉框（Select）**：≥4 个选项；文案较长；实体列表（表、数据加工、模型、空间/项目）；超过 3 个值的频率/类型/模式；非多选的星期选择；自动化「触发方式」「执行频率」「处理方式」「失败时」「写入方式」；排序/状态筛选；表格中逐行重复的选择。
- **多选控件**：
  - 少量开关型多选（如执行星期）使用多选切换按钮。
  - 字段/选项多选统一复用 `workflow-forms/shared/GlassOptionMultiSelect`（支持 `overflow: collapse | scroll`、`dropdown: portal | inline`、`onClear` 及受控开关），已选标签统一通过 `GlassValueChip` / `GlassOverflowTagList` 渲染，禁止手写内联 chip 复刻（受 `glass-overflow-tag-list.test.ts` 保护）。
- **图标**：统一使用 `lucide-react`，尺寸常规为 `h-3.5 w-3.5`（紧凑行/工具栏）或 `h-4 w-4`（导航/弹窗），禁止用字符符号代替图标。

---

## 7. 重点页面专项规则

### 7.1 对话页（ChatView）

- **静默标题栏**：高 `h-12`，采用 `glass-panel-header titlebar-drag` 网格居中显示会话标题，左侧不显示应用名，右侧仅展示必要状态（如 MCP 连接数）与辅助操作；滚动后在标题栏下方浮现「回到顶部」轻胶囊。
- **阅读宽度**：消息流与底部输入栏统一最大宽度 `max-w-[980px]`。
- **消息呈现**：用户消息为右对齐、无边框扁平浅底气泡（`.message-user`，`18px` 圆角、`bg-accent-muted`）；助手回复直接平铺排版（`.prose-chat`，`14px / 1.75` 行高），强调词与链接使用 `--color-accent-text` 系色值。
- **底部输入壳**：`.chat-composer-panel`（`16px` 圆角、最小高度 `120px` / `sm:132px`、聚焦边框过渡至主色）；底部工具栏按钮使用无边框扁平样式（`.composer-flat-button` / `.composer-flat-pill`），集成附件、技能 `@` 提及、权限策略（默认 / 自动审查 / 完全访问）与模型切换器。

### 7.2 列表页与数据网格

- **统一紧凑列表表**：使用 `.glass-table.ui-table-flush` + `.data-list-table`（贴边无圆角、粘性表头 `32px`、数据行 `36px`、`1px` 纵向列分隔线、悬停浅底）；通过 `.data-list-table-shell` + `data-list-filler` 占位行撑满列表视口。
- **数据预览网格（`GlassDataGridPreview`）**：用于原始表/结果表的「数据」页签，仅保留底部分页栏（`data-testid="grid-pager"`），上方不额外堆叠搜索/筛选/导出栏。

### 7.3 原始表 / 结果表 / 自动化编辑器

- **原始表页签**：底部仅设「配置 / 数据 / 自动化」三个页签，不设「关联设置」页签；自动化关联统一在「自动化」页签用 `104px | 1fr | 40px | 40px | 104px` 贴边网格维护。
- **AI 自定义规则 / 脚本工作台**：步骤条采用 `›` 文本面包屑（无 chip 背景）；生成阶段的错误保留在日志流中并用贴边重新生成单元处理，不额外弹出红底横幅；代码审查区共享 `36px` 顶栏与贴边操作单元。
- **空状态**：只保留简短结论与最多一个主要操作，不写长段说明。

### 7.4 工作流画布

- 基于 React Flow（`.workflow-react-flow`），使用 `--workflow-canvas-dot` 低对比度点阵、`--workflow-edge` 中性连线；选中边、连接线与重连锚点使用 `--color-accent`（禁止写死蓝色）。小地图采用直角 `1px` 细框、无阴影。

---

## 8. 工程实现与验收清单

- **优先沉淀公共层**：优先修改 `globals.css` Token、`components/ui` 原语和 `data-view/shared.tsx` 布局类，避免在业务页面复制大段样式。
- **本地组件预览**：运行 `vite dev` 并访问 `/preview-ui.html`，可一次性核验所有基础原语在浅色/深色与 5 套色系下的状态。
- **必查验收项**：
  1. 浅色、深色以及 `mint` / `lake` / `lavender` / `orange` / `rose` 五套色系下文字与实心按钮对比度 ≥4.5:1。
  2. 无硬编码主题色、无毛玻璃/渐变/发光、无嵌套卡片、无配置项下冗余说明文案。
  3. 焦点可见性（键盘 Tab/Esc）、下拉/弹层定位不遮挡、窄窗口与侧栏折叠无溢出截断。
  4. 改动后至少回归检查：欢迎页、对话页、数据工作台（加工/原始表/结果表/云数据）、工作流画布、技能、自动化与设置页。
  5. 运行渲染层样式回归测试（`tests/*design*.test.ts`、`tests/dark-theme-palette.test.ts`、`tests/sidebar-project-ui.test.ts`、`tests/chat-view-layout.test.ts`、`tests/glass-overflow-tag-list.test.ts` 等），确保视觉规范约束不被破坏。

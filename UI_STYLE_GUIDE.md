# 九思助理 UI 风格规范

本项目统一使用“薄荷工作台”视觉方向。参考图保存在
[`design/ui/mint-workbench/reference-overview.png`](design/ui/mint-workbench/reference-overview.png)。
后续新增页面和界面改造都必须遵循本规范。

## 1. 设计目标

- 面向长时间工作的桌面工具，界面应清爽、安静、紧凑。
- 保持现有页面结构、分栏、尺寸和交互；只有明确提出布局改造时才调整布局。
- 用暖白背景、薄荷浅色选中态、深绿文字和细边框建立层级。
- 页面以内容和操作为中心，避免营销页式大标题、大留白和装饰性图形。
- 配置界面只显示配置项、当前值和必要状态，不在配置项下增加解释性小字。

## 2. 主题色与语义变量

组件必须使用 `src/renderer/styles/globals.css` 中的语义变量或对应的 Tailwind 类，禁止把主题色直接写进组件。

| 用途       | 默认值    | 变量 / 类                                                |
| ---------- | --------- | -------------------------------------------------------- |
| 应用背景   | `#F4F8F5` | `--app-backdrop`                                         |
| 主工作区   | `#FBFDFB` | `--color-background` / `bg-background`                   |
| 卡片与输入 | `#FFFFFF` | `--color-surface` / `bg-surface`                         |
| 薄荷选中态 | `#EAF6EE` | `--color-surface-active` / `bg-surface-active`           |
| 主色       | `#2F8F63` | `--color-accent` / `bg-accent`                           |
| 主色悬停   | `#267B54` | `--color-accent-hover` / `bg-accent-hover`               |
| 主色浅底   | `#EAF6EE` | `--color-accent-muted` / `bg-accent-muted`               |
| 主色上前景 | `#0C1210` | `--color-accent-foreground` / `text-accent-foreground`   |
| 错误上前景 | `#0C1210` | `--color-error-foreground` / `text-error-foreground`     |
| 成功上前景 | `#0C1210` | `--color-success-foreground` / `text-success-foreground` |
| 主要文字   | `#24362E` | `--color-text-primary` / `text-text-primary`             |
| 次要文字   | `#52675D` | `--color-text-secondary` / `text-text-secondary`         |
| 弱文字     | `#718078` | `--color-text-muted` / `text-text-muted`                 |
| 普通边框   | `#DCE8DF` | `--color-border-muted` / `border-border-muted`           |
| 弱分隔线   | `#E6EEE8` | `--color-border-subtle` / `border-border-subtle`         |

主题换色替换 accent 系列变量，并将中性色板（背景、表面、边框、文字、阴影、数据网格、工作流画布、代码预览）的色相旋转至该色系——饱和度与明度与原薄荷色板一致，对比度关系不变；成功、警告、错误等语义颜色保持独立。全局样式提供 `data-accent-theme="lake"`、`lavender`、`orange`、`rose` 四套方案；默认无属性时为薄荷绿。用户选择持久化在 `AppConfig.accentTheme`（设置 → 外观 → 色系），由 `App.tsx` 写入根节点属性。新增主题应沿用同一变量接口，并同步生成同色相的中性色板。

实心状态按钮（`bg-accent`/`bg-error`/`bg-success`）必须使用对应的 `*-foreground` 前景 token，不得写 `text-white`：湖蓝、橙色主题下白字对比度不足 4.5:1。`accent-foreground`/`error-foreground`/`success-foreground` 为深色字（lavender 主题单独覆盖为白字），已核验全部主题组合 ≥4.5:1。

## 3. 容器、边框和阴影

- 主容器使用暖白或白色实底，避免渐变、毛玻璃和大面积半透明叠层。
- 常规圆角为 `8px` 到 `12px`；胶囊、头像和开关可以使用全圆角。
- 卡片使用 `1px` 细边框。只在容器需要从背景上轻微抬起时使用 `shadow-card`。
- 弹窗、菜单可以使用 `shadow-elevated`；普通卡片不能使用强阴影。
- 不堆叠多层卡片。一个区域已有边界时，内部内容优先使用分隔线或分组标题。
- 禁止新增渐变、发光、玻璃模糊、霓虹描边和装饰性背景纹理。

## 4. 字体与信息层级

- 字体栈：`"PingFang SC", "Inter", "SF Pro Text", "Microsoft YaHei UI", "Noto Sans SC", sans-serif`。
- 正文和输入文字使用 `13px` 到 `14px`，表头、状态和辅助操作使用 `12px`。
- 页面标题使用 `15px` 到 `18px`、`font-weight: 600`；普通内容不使用夸张大字号。
- 正文使用 400，按钮、导航和标签使用 500，标题使用 600；不要在正文中使用粗黑字重。
- 主要信息使用 `text-text-primary`，说明和元信息使用 `text-text-secondary`，弱状态才使用 `text-text-muted`。
- 配置项下方不放说明文字。确实需要解释时使用字段标签旁的帮助入口或独立帮助文档。

## 5. 控件

通用控件集中在 `src/renderer/components/ui/`（Button、Input、Select、DropdownMenu、Switch、Dialog、Badge、Tabs），新代码优先使用这些原语而非裸标签；原语只使用语义 token，不含 blur/渐变/写死色，且不依赖 electronAPI。类合并一律用 `cn()`（内部 tailwind-merge），调用方传入的冲突类（如 `w-32`、`max-w-[24rem]`）会正确覆盖默认值。

- 主要按钮使用 `bg-accent`、`text-accent-foreground`、`8px` 到 `10px` 圆角和轻阴影。
- 次级按钮使用白底、细边框和深灰绿文字；悬停时变为极浅薄荷色。
- 输入框、下拉框和日期选择器使用白底、细边框；聚焦时使用主色边框和低透明度 focus ring。
- 开关开启时使用当前主题主色，关闭时使用中性浅底和边框。
- Tab 选中态使用深色文字、浅薄荷底或细主色指示线，不使用高饱和实心色块。
- 方案按钮、操作栏和算子表单保持紧凑；按钮高度一般为 `32px` 到 `36px`。
- 操作图标使用 Lucide 图标库，尺寸和描边保持一致，不使用文本符号代替图标。

## 6. 页面规则

- 左侧导航选中项使用浅薄荷底和主色图标；未选中项保持中性。
- 表格表头使用 `#F0F7F2`，表格正文为白色，悬停行为 `#F6FAF7`，分隔线使用 `#DCE8DF`。
- 数据处理算子配置使用单层紧凑表单。字段、条件和映射按行组织，不增加说明卡片。
- 工作流画布使用低对比度点阵、灰绿色连线和主色选中状态，不使用蓝色作为默认选中色。
- 成功、警告、错误状态使用各自语义色；业务分类图标默认使用主题主色或中性色。
- 空状态只保留简短结论和一个主要操作，不增加长篇说明。

## 7. 实现与验收

- 优先修改公共 token 和通用组件，避免在页面里复制样式。
- 新组件必须支持浅色、深色及 accent 换色，不能依赖固定的绿色十六进制值。
- UI 改动后至少检查欢迎页、对话、数据工作台、任务流程、云数据、技能、自动化、API 设置和通用设置。
- 验收时检查文字对比度、边框层级、焦点状态、弹层遮挡、窄窗口和深色主题。
- 如果需求只要求风格调整，不改变页面宽高、分栏、信息顺序和交互路径。

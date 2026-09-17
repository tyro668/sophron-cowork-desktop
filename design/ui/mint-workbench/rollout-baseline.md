# Mint Workbench 前端改造 — 基线与验收记录

对应方案：`frontend-ui-rollout-plan.md`。本文档记录阶段 0 基线与各阶段验收状态。

## 阶段 0 · 基线（改造后记录）

### 包体积（`vite build`，renderer 主要 chunk）

| chunk           | 大小      | gzip      |
| --------------- | --------- | --------- |
| index（入口）   | 723.35 kB | 229.10 kB |
| MessageCard     | 998.42 kB | 320.75 kB |
| CloudDataView   | 630.21 kB | 205.64 kB |
| MessageMarkdown | 436.87 kB | 132.20 kB |
| DataView        | 428.75 kB | 127.96 kB |
| SettingsPanel   | 143.60 kB | 33.08 kB  |
| AutomationView  | 170.04 kB | 47.21 kB  |

新增依赖：`tailwind-merge`（cn 冲突消解）、`@radix-ui/react-dialog`、`@radix-ui/react-tabs`。主包增量可忽略（Radix 组件按 chunk 分摊）。

### 控件与违规清单

改造前违规（半透明填充 / blur / 写死前景）集中在 89 个渲染层文件；codemod 收敛后：

- `bg-background/*`、`bg-surface/*` 半透明填充：**0 处**
- `backdrop-blur-*` 引用（globals 中已全局禁用，本次清除死类）：**0 处**
- `bg-[var(--glass-*)]` 填充：**0 处**（收敛为 `bg-surface`/`bg-background`）
- 状态实心按钮 `text-white`：**0 处**（统一 `accent-foreground`/`error-foreground`/`success-foreground`；Titlebar Windows 关闭钮保留白字为平台规范）
- 裸 `<button>` 344 处（多数走 `.btn-*` token 类或专用控件）；`<Button>` 原语已在试点模块启用，后续逐模块替换

### 对比度核验（WCAG AA 正文 ≥4.5:1）

| 组合                             | 对比度                       |
| -------------------------------- | ---------------------------- |
| `#0C1210` on mint `#2F8F63`      | 4.71                         |
| `#0C1210` on lake                | ≥4.5                         |
| `#0C1210` on orange              | ≥4.5                         |
| `#0C1210` on rose                | ≥4.5                         |
| `#FFFFFF` on lavender            | 4.92（该主题单独覆盖为白字） |
| `#0C1210` on error（light/dark） | 4.52 / 5.67                  |

## 阶段 1 · 组件框架（已完成）

- `src/renderer/components/ui/`：cn（tailwind-merge）、Button、Input、Select、DropdownMenu、Switch、Dialog（焦点圈禁+恢复）、Badge、Tabs
- `accent-foreground`/`error-foreground`/`success-foreground` 语义 token 全主题落地，Tailwind 已映射
- 适配层迁移：GlassSelect/GlassDropdownMenu/GlassSwitch/GlassDateTimePicker/GlassTimePicker/ConfirmDialog 复用原语类串，API 不变
- 预览页 `preview-ui.html`；行为测试 `tests/renderer/ui-primitives.test.tsx`（16 例：变体/禁用/键盘交互/Esc/遮罩/焦点圈禁与恢复/回调稳定）

## 阶段 2 · 试点（已完成）

- API 设置页 `SettingsAPI.tsx`：标准输入/按钮收敛到 `Input`/`Button`，粘性操作栏去 blur
- 数据工作台 `data-view/shared.tsx`：工具栏按钮、搜索框、分页控件收敛到原语；`InputTableSelect`/`InputTableCheckbox` 去重为单一共享实现
- 对话/外壳试点：ChatView 浮动按钮、Sidebar 确认按钮对 → `Button`

## 阶段 3 · 全站收敛（样式层完成）

- 全部渲染层文件的半透明填充/blur/glass 变量经 codemod 收敛为语义实体色（89 文件）
- 剩余裸 `<button>`/`<input>` 多为 `.btn-*`/`.input` CSS 原语类（token 已正确）或专用控件（协议分段开关、密码可见性、Windows 标题栏按钮），可视需要继续替换为组件原语

## 待人工验收

- 九类页面 × 亮暗 × 5 accent 主题截图走查（`/preview-ui.html` 可查组件层）
- 画布帧率、弹层遮挡、窄窗口、焦点顺序的实机核验

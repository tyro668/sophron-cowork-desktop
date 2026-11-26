# 项目开发约定

## 可读性

- 按职责组织模块和函数，让读者能从入口顺着主流程读下去。把复杂分支提取为含义明确的函数。
- 函数名说明动作和对象，如 `loadSession`、`saveWorkflow`。判断函数用 `is`、`has` 或 `can` 开头，同一概念沿用同一术语。
- 注释可以用中文。只在需要解释设计原因、约束或边界条件时写注释。

## 国际化

- 除必要注释外，源码中不直接写中文。中文文案写入 [zh.json](src/shared/i18n/locales/zh.json)，并在 [en.json](src/shared/i18n/locales/en.json) 中维护相同的键。前后端均通过翻译键获取文案。

## 后端变更

- 当前后端修改无需向后兼容。变更接口或数据格式时，同步更新当前调用方和相关测试，省去仅为旧版本服务的别名、适配层和回退分支。

## 项目边界

- 跨进程类型放在 `src/shared/contracts/`。共享层保持独立，主进程和 preload 不依赖渲染层，渲染层通过 `electronAPI` 调用主进程。
- 主进程的 IPC 请求处理器统一通过 `handleIpc()` 注册，每个通道都在 `IPC_INPUT_SCHEMAS` 中声明入参。
- 修改渲染层时遵循 [UI 样式指南](UI_STYLE_GUIDE.md)。

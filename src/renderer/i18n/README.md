# 国际化 (i18n) 使用指南

本项目使用 `react-i18next` 实现国际化支持，支持中英文切换。

## 架构优势

✅ **代码中只用英文 key** - 无需 if-else，代码简洁  
✅ **翻译集中管理** - 所有翻译在 JSON 文件中  
✅ **类型安全** - TypeScript 支持  
✅ **自动语言检测** - 根据浏览器语言自动选择  
✅ **持久化** - 语言选择保存在 localStorage

## 基本用法

### 1. 在组件中使用翻译

```tsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t('welcome.title')}</h1>
      <button>{t('common.save')}</button>
    </div>
  );
}
```

### 2. 带变量的翻译

```tsx
// en.json
{
  "welcome": {
    "greeting": "Hello, {{name}}!"
  }
}

// 使用
{t('welcome.greeting', { name: 'John' })}
```

### 3. 复数形式

```tsx
// en.json
{
  "mcp": {
    "toolsAvailable": "{{count}} tool available",
    "toolsAvailable_plural": "{{count}} tools available"
  }
}

// 使用
{t('mcp.toolsAvailable', { count: 1 })} // "1 tool available"
{t('mcp.toolsAvailable', { count: 5 })} // "5 tools available"
```

### 4. 切换语言

```tsx
import { useTranslation } from 'react-i18next';

function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const changeLanguage = (lang: 'en' | 'zh') => {
    i18n.changeLanguage(lang);
  };

  return <button onClick={() => changeLanguage('zh')}>中文</button>;
}
```

## 添加新翻译

1. 在 `src/renderer/i18n/locales/en.json` 添加英文翻译
2. 在 `src/renderer/i18n/locales/zh.json` 添加中文翻译
3. 使用 `t('key.path')` 在代码中引用

## 适用范围和强制要求

以下规则适用于渲染进程、Electron 主进程、preload、远程机器人消息，以及其他可能向用户展示内容的代码：

1. **用户可见文案必须使用项目原生 i18n**：不要在 TypeScript、TSX 或业务逻辑中硬编码按钮、标签、提示、Toast、可见错误、机器人回复等文案。
2. **所有语言必须同步更新**：优先复用语义一致的翻译 key；新增 key 时，必须在同一次修改中更新 `en.json` 和 `zh.json`，并保持两份 JSON 的层级结构一致。
3. **React 组件使用标准翻译入口**：渲染进程组件使用 `useTranslation()` 和 `t('key.path')`，不要直接导入 locale JSON，也不要在组件内维护中英文映射表。
4. **非 React 代码仍需复用 locale 资源**：主进程和 preload 不能导入依赖浏览器环境的 `src/renderer/i18n/config.ts`。需要向用户输出文案时，应根据请求或运行时提供的明确语言上下文，从现有 locale 资源读取对应翻译。
5. **禁止临时双语常量**：不要通过 `const messages = { zh: ..., en: ... }` 等方式在业务文件中绕过 locale 管理。内部日志和只面向开发者的诊断信息不属于用户可见文案，可以不做翻译。
6. **本地化行为必须测试**：新增或修改本地化逻辑时，至少验证中文和英文输出，或验证两份 locale 中存在结构一致的翻译 key。

## 翻译文件结构

建议按功能模块组织：

```json
{
  "common": { ... },      // 通用词汇
  "welcome": { ... },     // 欢迎页
  "settings": { ... },    // 设置页
  "mcp": { ... },         // MCP 相关
  "credentials": { ... }  // 凭证相关
}
```

## 语言切换组件

已创建 `LanguageSwitcher` 组件，可以在任何地方使用：

```tsx
import { LanguageSwitcher } from './components/LanguageSwitcher';

<LanguageSwitcher />;
```

## 最佳实践

1. **使用有意义的 key** - `welcome.title` 而不是 `text1`
2. **保持层级一致** - 英文和中文的 JSON 结构要完全一致
3. **避免硬编码** - 所有用户可见文本都必须遵循上面的跨进程 i18n 规则
4. **命名空间** - 使用点号分隔的层级结构组织翻译

---
layout: home

hero:
  name: Metis Cowork
  text: 专注数据处理的本地 Agent
  tagline: 在 Windows 与 macOS 上用沙盒化 AI Agent 处理本地文件、表格、报告和数据集。
  image:
    src: /logo.png
    alt: Metis Cowork Logo
  actions:
    - theme: brand
      text: 立即下载
      link: '#quick-install'
    - theme: alt
      text: 源码仓库
      link: ssh://git@code.fineres.com:7999/res/metis-cowork.git

features:
  - icon: 🚀
    title: 一键安装，开箱即用
    details: 提供 Windows (.exe) 和 macOS (.dmg) 预构建安装包。无需终端或编程知识。
  - icon: 🤖
    title: 数据处理 Agent
    details: 分析表格、清洗混乱数据集、总结报告、抽取结构化信息，并从工作区文件生成交付物。
  - icon: 🔒
    title: 虚拟机级别安全隔离
    details: 基于 WSL2 (Windows) 和 Lima (macOS) 的虚拟机隔离，所有命令在安全的 Linux 环境中执行，保障宿主机安全。
  - icon: 🧰
    title: 内置 Skills 技能系统
    details: 一键生成数据报告、PPTX、DOCX、XLSX、PDF 文档。支持自定义技能开发，内置 skill-creator 工具包。
  - icon: 🔌
    title: MCP 外部工具集成
    details: 通过 MCP 协议连接浏览器、Notion 等桌面应用，将 AI 能力扩展到文件管理和编程之外。
  - icon: 🖥️
    title: GUI 自动化操作
    details: 可以控制和操作电脑上的桌面 GUI 应用程序。推荐使用 Gemini-3-Pro 模型以获得最佳效果。
  - icon: 📡
    title: 远程控制
    details: 支持通过飞书和 Slack 发送指令、接收执行结果，实现跨平台工作流自动化。
  - icon: 🛡️
    title: 免费开源
    details: MIT 协议开源，代码完全透明。数据全部本地运行，无遥测，不向任何外部服务器发送数据。
---

<style>
.faq-section {
  max-width: 800px;
  margin: 0 auto;
  padding: 48px 24px;
}
.faq-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 32px;
}
.faq-item {
  margin-bottom: 24px;
}
.faq-item h3 {
  font-size: 1.1em;
  margin-bottom: 8px;
}
.faq-item p {
  color: var(--vp-c-text-2);
  line-height: 1.7;
}

.comparison-section {
  max-width: 700px;
  margin: 0 auto;
  padding: 32px 24px 48px;
}
.comparison-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 24px;
}
.comparison-section table {
  width: 100%;
  border-collapse: collapse;
}
.comparison-section th, .comparison-section td {
  padding: 12px 16px;
  border: 1px solid var(--vp-c-divider);
  text-align: center;
}
.comparison-section th {
  background: var(--vp-c-bg-soft);
}

.install-section {
  max-width: 700px;
  margin: 0 auto;
  padding: 32px 24px;
}
.install-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 24px;
}

.models-section {
  max-width: 700px;
  margin: 0 auto;
  padding: 32px 24px;
}
.models-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 24px;
}
.models-section table {
  width: 100%;
  border-collapse: collapse;
}
.models-section th, .models-section td {
  padding: 10px 14px;
  border: 1px solid var(--vp-c-divider);
  text-align: left;
}
.models-section th {
  background: var(--vp-c-bg-soft);
}
</style>

<div class="comparison-section">

## 功能对比

|                 | MCP & Skills | 远程控制 | GUI 自动化 |
| --------------- | :----------: | :------: | :--------: |
| Claude Cowork   |      ✓       |    ✗     |     ✗      |
| **Metis Cowork** |    **✓**     |  **✓**   |   **✓**    |

</div>

<div class="models-section">

## 支持的 AI 模型

| 服务商         | Base URL                                 | 推荐模型          |
| -------------- | ---------------------------------------- | ----------------- |
| **OpenRouter** | `https://openrouter.ai/api`              | claude-4-5-sonnet |
| **Anthropic**  | 默认                                     | claude-4-5-sonnet |
| **智谱 AI**    | `https://open.bigmodel.cn/api/anthropic` | glm-4.7           |
| **MiniMax**    | `https://api.minimaxi.com/anthropic`     | minimax-m2        |
| **Kimi**       | `https://api.kimi.com/coding/`           | kimi-k2           |

</div>

<div id="quick-install" class="install-section">

## 快速安装

**Windows / macOS 安装包**

请通过 Metis Cowork 官方发布渠道获取。

**源码构建**

```bash
git clone ssh://git@code.fineres.com:7999/res/metis-cowork.git
cd metis-cowork
npm install
npm run rebuild
npm run dev
```

</div>

<div class="faq-section">

## 常见问题

<div class="faq-item">

### Metis Cowork 是什么？

Metis Cowork 是一款免费开源、专注本地数据处理的 AI Agent 桌面应用。它帮助你分析、清洗、转换、总结和整理工作区内的文件、表格、报告和数据集，无需命令行或编程知识。

</div>

<div class="faq-item">

### 支持哪些 AI 模型？

支持 Claude（通过 Anthropic 或 OpenRouter）、OpenAI 兼容接口，以及国产大模型包括智谱 GLM、MiniMax、Kimi 等。任何提供 OpenAI 兼容 API 的服务商都可以配置使用。

</div>

<div class="faq-item">

### 免费吗？

Metis Cowork 本身完全免费，采用 MIT 开源协议。你只需为所选 AI 模型服务商的 API 调用付费。

</div>

<div class="faq-item">

### 沙盒隔离是怎么工作的？

Metis Cowork 使用 WSL2 (Windows) 或 Lima (macOS) 在隔离的 Linux 虚拟机中执行所有 AI 命令。即使 AI 操作失误，你的宿主机文件系统也不会受到影响。

</div>

<div class="faq-item">

### 数据安全吗？

Metis Cowork 在本机运行，你的工作区文件由你控制。唯一的外部通信是与你配置的 AI 模型 API 之间的交互。没有任何数据被发送到 Metis Cowork 的服务器。

</div>

<div class="faq-item">

### 支持 Linux 吗？

目前提供 Windows 和 macOS 的预构建安装包。Linux 用户可以通过上方源码仓库地址进行源码编译。

</div>

</div>

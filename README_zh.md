<p align="center">
  <img src="resources/logo.png" alt="Metis Cowork Logo" width="280" />
</p>

<h1 align="center">🚀 Metis Cowork: 专注数据处理的本地 Agent 桌面应用</h1>

<p align="center">
  • 本地数据处理 • 一键安装 • 沙盒化 Agent 工作区
</p>

<p align="center">
  <a href="./README.md">English Docs</a> •
  <a href="#核心特性">核心特性</a> •
  <a href="#演示">演示视频</a> •
  <a href="#下载与安装">下载安装</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#技能库">技能库</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/平台-Windows%20%7C%20macOS-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/协议-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-18+-brightgreen" alt="Node.js" />
  <a href="https://discord.gg/pynjtQDf"><img src="https://img.shields.io/discord/1493588403260883078?logo=discord&label=Discord&color=5865F2" alt="Discord" /></a>
  <a href="#加入社群"><img src="https://img.shields.io/badge/WeChat-微信群-07C160?logo=wechat&logoColor=white" alt="WeChat" /></a>
</p>

---

Metis Cowork 是一款免费开源、专注本地数据处理的 AI Agent 桌面应用，支持 Windows 和 macOS 一键安装，无需任何编程知识。它将 Claude、OpenAI、Gemini、DeepSeek 等多种 AI 模型封装为友好的桌面工作区，帮助你在本机分析、清洗、转换、总结和整理文件、表格、报告与数据集。核心能力包括虚拟机级别沙盒隔离（Windows 使用 WSL2，macOS 使用 Lima）、内置 Skills 技能系统（生成数据报告、PPTX、DOCX、XLSX、PDF）、MCP 协议集成（连接浏览器、Notion 等桌面应用）、GUI 自动化操作，以及通过飞书和 Slack 进行远程控制。

---

## 📖 简介

**Metis Cowork** 是一个面向数据密集型工作的本地 Agent 工作区，提供 **Windows** 和 **macOS** 一键安装包，无需任何编程知识。

它为 AI 提供了一个沙盒化的工作环境，可以处理本地数据文件、通过内置的 **Skills** 系统生成专业交付物（PPTX、DOCX、XLSX 等），并在需要外部工具时 **通过 MCP 连接桌面 APP**（浏览器、Notion 等）。

> [!WARNING]
> **免责声明**：Metis Cowork 仅作为一个 AI 协作工具，请对它的操作保持谨慎。特别是在授权文件修改或删除等操作时，请务必自行审查风险，我们支持了基于VM的sandbox隔离，但是某些操作可能仍存风险。

---

<a id="核心特性"></a>

## ✨ 核心特性

|               | MCP & Skills | 远程控制 | 图形界面操作 |
| ------------- | ------------ | -------- | ------------ |
| Claude Cowork | ✓            | ✗        | ✗            |
| OpenClaw      | ✓            | ✓        | ✗            |
| MetisCowork   | ✓            | ✓        | ✓            |

- **一键安装，开箱即用**：提供 Windows 和 macOS 预构建安装包，无需配置环境，下载即可开始使用。。
- **本地数据处理**：分析表格、清洗混乱数据集、总结报告、抽取结构化信息，并从工作区文件生成交付物。
- **灵活模型支持**：支持 **Claude**、**OpenAI 兼容接口**，以及国产大模型 **GLM**、**MiniMax**、**Kimi** 等。使用你的 OpenRouter、Anthropic等API Key，灵活配置。更多模型持续接入中！
- **远程控制**：可以接入**飞书**等协作平台和远程服务，实现工作流自动化和跨平台操作。
- **图形界面操作**：可以控制和操作电脑上的各种桌面 GUI 应用程序。**推荐使用 Gemini-3-Pro 模型**以获得最佳的 GUI 理解和控制效果。
- **智能文件管理**：可以在工作区内读取、写入和整理文件。
- **Skills 系统**：内置 PPTX、DOCX、PDF、XLSX 生成和处理工作流。**支持自定义技能的添加与删除。**
- **MCP外部服务支持**：通过 **MCP Connectors** 连接器集成浏览器、Notion、自定义等应用，扩展 AI 能力。
- **多模态交互输入**：支持直接拖拽文件和图片到输入框，实现无缝的多模态交互。
- **实时追踪**：在 Trace Panel 中观察 AI 推理和工具调用过程。
- **安全可控的工作环境**：所有操作限制在你选择的工作区文件夹内。
- **虚拟机级别安全隔离**：基于 WSL2 (Windows) 和 Lima (macOS) 的虚拟机隔离，所有命令在隔离的虚拟机中执行，保障宿主机安全。
- **UI优化**：灵活优美的UI设计、切换系统语言、完善的MCP/Skills/Tools调用展示。

<a id="演示"></a>

## 🎬 演示

演示素材随发布材料提供，当前工作流包括：

- 文件夹收纳整理
- 从文件生成 PPT
- 从文件生成 XLSX 表格

---

<a id="下载与安装"></a>

## 📦 下载与安装

### 方式一：Homebrew（macOS，推荐）

```bash
brew tap MetisCoworkAI/tap
brew install --cask --no-quarantine metis-cowork
```

> `--no-quarantine` 可跳过 macOS Gatekeeper 验证，避免"无法验证开发者"的弹窗。

### 方式二：下载安装包

请通过 Metis Cowork 官方发布渠道下载最新版本。

| 平台                      | 文件类型 |
| ------------------------- | -------- |
| **Windows**               | `.exe`   |
| **macOS** (Apple Silicon) | `.dmg`   |

### 方式三：源码编译

适合想要贡献代码或进行二次开发的开发者：

```bash
git clone ssh://git@code.fineres.com:7999/res/metis-cowork.git
cd metis-cowork
npm install
npm run rebuild
npm run dev
```

构建安装包：`npm run build`

### 安全配置：🔒 沙盒支持

Metis Cowork 提供**多级沙盒保护**，确保系统安全：

| 级别     | 平台    | 技术     | 说明                            |
| -------- | ------- | -------- | ------------------------------- |
| **基础** | 全平台  | 路径守卫 | 文件操作限制在工作区文件夹内    |
| **增强** | Windows | WSL2     | 命令在隔离的 Linux 虚拟机中执行 |
| **增强** | macOS   | Lima     | 命令在隔离的 Linux 虚拟机中执行 |

- **Windows (WSL2)**：检测到 WSL2 后，所有 Bash 命令自动路由到 Linux 虚拟机，工作区双向同步。
- **macOS (Lima)**：安装 [Lima](https://lima-vm.io/) (`brew install lima`) 后，命令在挂载了 `/Users` 的 Ubuntu 虚拟机中运行。
- **回退模式**：如果没有可用的虚拟机，命令将在本机执行，受路径限制保护。

**配置方法（可选、推荐）**

- **Windows**：如已安装 WSL2，会自动检测。[安装 WSL2](https://docs.microsoft.com/zh-cn/windows/wsl/install)

- **macOS**：
  如已安装 lima，会自动检测。lima安装指令如下：

```bash
brew install lima
# Metis Cowork 会自动创建和管理 Lima 虚拟机（内部 Lima 实例名：'claude-sandbox'）
```

---

<a id="快速开始"></a>

## 🚀 快速开始

### 1. 获取 API Key

你需要一个 API Key 来驱动 Agent。我们支持 **OpenRouter**、**Anthropic** 以及多家高性价比的**国产大模型**。

| 服务商         | 获取 Key / Coding Plan                                                     | Base URL (必填)                          | 推荐模型 Model       |
| -------------- | -------------------------------------------------------------------------- | ---------------------------------------- | -------------------- |
| **OpenRouter** | [OpenRouter](https://openrouter.ai/)                                       | `https://openrouter.ai/api`              | `claude-4-5-sonnet`  |
| **Anthropic**  | [Anthropic Console](https://console.anthropic.com/)                        | 默认                                     | `claude-4-5-sonnet`  |
| **智谱 AI**    | [GLM Coding Plan](https://bigmodel.cn/glm-coding) (⚡️国产特惠)             | `https://open.bigmodel.cn/api/anthropic` | `glm-4.7`, `glm-4.6` |
| **MiniMax**    | [MiniMax Coding Plan](https://platform.minimaxi.com/subscribe/coding-plan) | `https://api.minimaxi.com/anthropic`     | `minimax-m2`         |
| **Kimi**       | [Kimi Coding Plan](https://www.kimi.com/membership/pricing)                | `https://api.kimi.com/coding/`           | `kimi-k2`            |

### 2. 配置应用

1. 打开应用，点击左下角 ⚙️ **设置**。
2. 填入你的 **API Key**。
3. **关键步骤**：根据上表修改 **Base URL** (如使用智谱/MiniMax等)。
4. 输入想要使用的 **Model** 名称。

### 3. 开始协作

1. **选择工作区**：选择一个文件夹，授权 Claude 在其中工作。
2. **输入指令**：
   > "读取当前文件夹下的 financial_report.csv，并帮我生成一份包含 5 页幻灯片的 PPT 总结报告。"

### 📝 重要提示

1.  **macOS 安装问题**：如果直接下载 DMG 安装后提示”无法验证开发者”，推荐使用 Homebrew 安装以避免此问题：
    ```bash
    brew tap MetisCoworkAI/tap && brew install --cask --no-quarantine metis-cowork
    ```
    或者前往 **系统设置 > 隐私与安全性** 点击”仍要打开”。
2.  **网络连接**：对于 `WebSearch` 等联网工具，可能需要开启代理软件的“虚拟网卡 (TUN模式)”功能才能正常访问。
3.  **Notion连接器使用**: 除了设置Notion token之外，还需要在根页面添加连接。更多指引请看https://www.notion.com/help/add-and-manage-connections-with-the-api。

<a id="技能库"></a>

## 🧰 技能库

Metis Cowork 内置技能位于 `.claude/skills/`，并支持用户自行添加/自定义技能，包含：

- `pptx`：PowerPoint 生成
- `docx`：Word 文档处理
- `pdf`：PDF 处理与表单
- `xlsx`：Excel 电子表格支持
- `skill-creator`：技能开发工具包

---

## 🏗️ 架构概览

```
metis-cowork/
├── src/
│   ├── main/                    # Electron 主进程 (Node.js)
│   │   ├── index.ts             # 主入口文件
│   │   ├── claude/              # Agent SDK 与运行器
│   │   │   └── agent-runner.ts  # AI 代理执行逻辑
│   │   ├── config/              # 配置管理
│   │   │   └── config-store.ts  # 持久化设置存储
│   │   ├── db/                  # 数据库层
│   │   │   └── database.ts      # SQLite/数据持久化
│   │   ├── ipc/                 # IPC 处理器
│   │   ├── memory/              # 内存管理
│   │   │   └── memory-manager.ts
│   │   ├── sandbox/             # 安全与路径解析
│   │   │   └── path-resolver.ts # 沙盒化文件访问
│   │   ├── session/             # 会话管理
│   │   │   └── session-manager.ts
│   │   ├── skills/              # 技能加载与管理
│   │   │   └── skills-manager.ts
│   │   └── tools/               # 工具执行
│   │       └── tool-executor.ts # 工具调用处理
│   ├── preload/                 # Electron 预加载脚本
│   │   └── index.ts             # 上下文桥接设置
│   └── renderer/                # 前端 UI (React + Tailwind)
│       ├── App.tsx              # 根组件
│       ├── main.tsx             # React 入口
│       ├── components/          # UI 组件
│       │   ├── ChatView.tsx     # 主聊天界面
│       │   ├── ConfigModal.tsx  # 设置对话框
│       │   ├── ContextPanel.tsx # 文件上下文显示
│       │   ├── MessageCard.tsx  # 聊天消息组件
│       │   ├── PermissionDialog.tsx
│       │   ├── Sidebar.tsx      # 导航侧边栏
│       │   ├── Titlebar.tsx     # 自定义窗口标题栏
│       │   ├── TracePanel.tsx   # AI 推理追踪
│       │   └── WelcomeView.tsx  # 引导页面
│       ├── hooks/               # 自定义 React Hooks
│       │   └── useIPC.ts        # IPC 通信 Hook
│       ├── store/               # 状态管理
│       │   └── index.ts
│       ├── styles/              # CSS 样式
│       │   └── globals.css
│       ├── types/               # TypeScript 类型
│       │   └── index.ts
│       └── utils/               # 工具函数
├── .claude/
│   └── skills/                  # 默认技能定义
│       ├── pptx/                # PowerPoint 生成
│       ├── docx/                # Word 文档处理
│       ├── pdf/                 # PDF 处理与表单
│       ├── xlsx/                # Excel 电子表格支持
│       └── skill-creator/       # 技能开发工具包
├── resources/                   # 静态资源 (图标、图片)
├── electron-builder.yml         # 构建配置
├── vite.config.ts               # Vite 打包配置
└── package.json                 # 依赖与脚本
```

---

## 🗺️ 路线图

详见 **[ROADMAP.md](ROADMAP.md)**。

**已完成：** 安装包 · 文件系统沙盒 · VM 隔离 (WSL2/Lima) · 技能 (PPTX/DOCX/PDF/XLSX) · MCP 连接器 · 多模型支持 · 富文本输入 · 中英文界面

**即将推出：** 记忆优化 · Linux 支持 · 插件系统 · Computer Use · 正式版发布

---

## ❓ 常见问题

**Metis Cowork 是什么？**
Metis Cowork 是一款免费开源的桌面应用，为用户提供专注数据处理的本地 AI Agent 工作空间。它可以帮助你分析、清洗、转换、总结和整理工作区内的文件与数据集，并提供 Windows 和 macOS 一键安装包。

**Metis Cowork 和 Claude Cowork 有什么区别？**
Metis Cowork 的定位更偏向本地数据处理，而不是通用编码或聊天。它支持多模型、GUI 自动化操作、飞书/Slack 远程控制，以及虚拟机级别的沙盒隔离。详见[功能对比表](#核心特性)。

**支持哪些 AI 模型？**
支持 Claude（通过 Anthropic 或 OpenRouter）、OpenAI 兼容接口，以及国产大模型包括智谱 GLM、MiniMax、Kimi 等。任何提供 OpenAI 兼容 API 的服务商都可以配置使用。

**Metis Cowork 免费吗？**
是的。Metis Cowork 本身完全免费，采用 MIT 开源协议。你只需为所选 AI 模型服务商的 API 调用付费。

**支持 Linux 吗？**
目前提供 Windows 和 macOS 的预构建安装包。Linux 用户可以通过源码编译方式使用，详见[源码编译](#下载与安装)章节。

**沙盒隔离是怎么工作的？**
Metis Cowork 提供多级安全保护：所有平台均有基础的路径限制，Windows 和 macOS 还支持虚拟机级别隔离（分别使用 WSL2 和 Lima）。启用虚拟机后，所有命令在隔离的 Linux 环境中执行，保护你的宿主机系统安全。

**什么是 Skills？如何创建自定义技能？**
Skills 是内置的工作流模板，用于完成特定任务，如生成 PPTX、DOCX、PDF 或 XLSX 文件。Metis Cowork 在 `.claude/skills/` 目录下预置了默认技能，并提供 `skill-creator` 工具帮助你构建自定义技能。

**什么是 MCP？怎么使用？**
MCP（Model Context Protocol，模型上下文协议）让 AI 能连接外部工具和服务。Metis Cowork 支持 MCP 连接器，可对接浏览器、Notion 等桌面应用，将 AI 的能力扩展到文件管理和编程之外。

**如何设置飞书或 Slack 远程控制？**
Metis Cowork 支持通过飞书和 Slack 进行远程控制，你可以在协作平台上发送指令并接收执行结果。请在应用设置中查看远程控制配置选项。

**数据安全吗？会不会把数据发送到外部服务器？**
Metis Cowork 完全在本地运行，你的文件保留在你的工作区内。唯一的外部通信是与你配置的 AI 模型 API（如 Anthropic、OpenRouter）之间的交互。没有任何数据被发送到 Metis Cowork 的服务器。

---

## 🛠️ 贡献指南

欢迎任何形式的贡献！无论是新技能、UI 修复还是安全改进：

1. Fork 本仓库。
2. 创建分支 (`git checkout -b feature/NewSkill`)。
3. 提交 PR。

---

## 💬 加入社群

欢迎加入我们的社区交流：

- **Discord**：[加入 Discord 服务器](https://discord.gg/pynjtQDf) — 实时聊天、技术支持与开发讨论。
- **微信**：扫描下方二维码加入微信交流群（中文社区）。

<p align="center">
  <img src="resources/WeChat.jpg" alt="微信交流群" width="200" />
</p>

---

## 📄 许可证

MIT © Metis Cowork Team

---

<p align="center">
  Made with ❤️ by the Metis Cowork Team with the help of opus4.5
</p>

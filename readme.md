<p align="center">
  <img src="resources/logo.png" alt="sophron cowork Logo" width="280" />
</p>

<h1 align="center">🚀 sophron cowork: Your Local Data Agent Desktop App</h1>

<p align="center">
  • Local data processing • One-click install • Sandboxed agent workspace
</p>

<p align="center">
  <a href="./README_zh.md">中文文档</a> •
  <a href="#features">Features</a> •
  <a href="#demo">Demo</a> •
  <a href="#installation">Downloads</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#skills">Skills Library</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-18+-brightgreen" alt="Node.js" />
</p>

---

sophron cowork is a free, open-source local data-processing agent for Windows and macOS. It wraps Claude, OpenAI, Gemini, DeepSeek, and other AI models into a desktop workspace that can analyze, clean, transform, summarize, and organize files, spreadsheets, reports, and datasets on your machine. Key capabilities include VM-level sandbox isolation (WSL2 on Windows, Lima on macOS), a built-in Skills system for data reports and document outputs (PPTX, DOCX, XLSX, PDF), MCP integration for browsers, Notion, and other desktop apps, GUI automation via computer use, and remote control through Feishu (Lark) and Slack.

---

## 📖 Introduction

**sophron cowork** is a local-first agent workspace for data-heavy work, with one-click installers for **Windows** and **macOS**—no coding required.

It provides a sandboxed workspace where AI can process local data files, generate professional outputs (PPTX, DOCX, XLSX, etc.) through the built-in **Skills** system, and **connect to desktop apps via MCP** (browser, Notion, etc.) when a workflow needs external tools.

> [!WARNING]
> **Disclaimer**: sophron cowork is an AI collaboration tool. Please exercise caution with its operations, especially when authorizing file modifications or deletions. We support VM-based sandbox isolation, but some operations may still carry risks.

---

<a id="features"></a>

## ✨ Key Features

|                | MCP & Skills | Remote Control | GUI Operation |
| -------------- | ------------ | -------------- | ------------- |
| Claude Cowork  | ✓            | ✗              | ✗             |
| OpenClaw       | ✓            | ✓              | ✗             |
| sophron cowork | ✓            | ✓              | ✓             |

- **One-Click Install, Ready to Use**: Pre-built installers for Windows and macOS, no environment setup needed—just download and start using.
- **Local Data Processing**: Analyze spreadsheets, clean messy datasets, summarize reports, extract structured information, and prepare deliverables from workspace files.
- **Flexible Model Support**: Supports **DeepSeek**, **Moonshot**, **Z.AI**, **Anthropic**, **OpenAI**, **OpenRouter**, and **Ollama** through dedicated provider presets. Use local or cloud models with flexible configuration.
- **Remote Control**: Connect to collaboration platforms like **Feishu (Lark)** and other remote services to automate workflows and cross-platform operations.
- **GUI Operation**: Control and interact with various desktop GUI applications on your computer. **Recommended model: Gemini-3-Pro** for optimal GUI understanding and control.
- **Smart File Management**: Read, write, and organize files within your workspace.
- **Skills System**: Built-in workflows for PPTX, DOCX, PDF, XLSX generation and processing. **Supports custom skill creation and deletion.**
- **MCP External Service Support**: Integrate browser, Notion, custom apps and more through **MCP Connectors** to extend AI capabilities.
- **Multimodal Input**: Drag & drop files and images directly into the chat input for seamless multimodal interaction.
- **Real-time Trace**: Watch AI reasoning and tool execution in the Trace Panel.
- **Secure Workspace**: All operations confined to your chosen workspace folder.
- **VM-Level Isolation**: WSL2 (Windows) and Lima (macOS) VM isolation—all commands execute in an isolated VM to protect your host system.
- **UI Enhancements**: Beautiful and flexible UI design, system language switching, comprehensive MCP/Skills/Tools call display.

<a id="demo"></a>

## 🎬 Demo

Demo media is distributed with release materials. Current workflows include:

- Folder organization and cleanup
- Generate PPT from files
- Generate XLSX spreadsheets
- GUI operation
- Remote control with Feishu (Lark)

---

<a id="installation"></a>

## 📦 Installation

### Option 1: Download Installer

Get the latest installer from the official sophron cowork release channel.

| Platform                  | File Type |
| ------------------------- | --------- |
| **Windows**               | `.exe`    |
| **macOS** (Apple Silicon) | `.dmg`    |

### Option 2: Build from Source

For source-based local builds:

```bash
git clone ssh://git@code.fineres.com:7999/res/metis-cowork.git sophron
cd sophron
npm install
npm run rebuild
npm run dev
```

To build the installer locally: `npm run build`

### Security Configuration: 🔒 Sandbox Support

sophron cowork provides **multi-level sandbox protection** to keep your system safe:

| Level        | Platform | Technology | Description                                    |
| ------------ | -------- | ---------- | ---------------------------------------------- |
| **Basic**    | All      | Path Guard | File operations restricted to workspace folder |
| **Enhanced** | Windows  | WSL2       | Commands execute in isolated Linux VM          |
| **Enhanced** | macOS    | Lima       | Commands execute in isolated Linux VM          |

- **Windows (WSL2)**: When WSL2 is detected, all Bash commands are automatically routed to a Linux VM. The workspace is synced bidirectionally.
- **macOS (Lima)**: When [Lima](https://lima-vm.io/) is installed (`brew install lima`), commands run in an Ubuntu VM with `/Users` mounted.
- **Fallback**: If no VM is available, commands run natively with path-based restrictions.

**Setup (Optional, Recommended)**

- **Windows**: WSL2 is auto-detected if installed. [Install WSL2](https://docs.microsoft.com/en-us/windows/wsl/install)

- **macOS**:
  Lima is auto-detected if installed. Install command:

```bash
brew install lima
# sophron cowork will automatically create and manage a Lima VM (internal Lima name: 'claude-sandbox')
```

---

<a id="quick-start"></a>

## 🚀 Quick Start Guide

### 1. Get an API Key

You need an API key to power cloud models, or a local Ollama server for local models. The provider list matches the app settings.

| Provider       | Get Key / Setup                                     | Base URL                       | Recommended Models                                      |
| -------------- | --------------------------------------------------- | ------------------------------ | ------------------------------------------------------- |
| **DeepSeek**   | [DeepSeek Platform](https://platform.deepseek.com/) | `https://api.deepseek.com`     | `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-chat` |
| **Moonshot**   | [Moonshot Platform](https://platform.moonshot.ai/)  | `https://api.moonshot.ai/v1`   | `kimi-k2.6`, `kimi-k2-thinking`, `moonshot-v1-128k`     |
| **Z.AI**       | [Z.AI Docs](https://docs.z.ai/)                     | `https://api.z.ai/api/paas/v4` | `glm-5.1`, `glm-5`, `glm-4.5`                           |
| **Anthropic**  | [Anthropic Console](https://console.anthropic.com/) | `https://api.anthropic.com`    | `claude-opus-4-6`, `claude-sonnet-4-6`                  |
| **OpenAI**     | [OpenAI Platform](https://platform.openai.com/)     | `https://api.openai.com/v1`    | `gpt-5.4`, `gpt-5.4-pro`, `gpt-5.3-codex`               |
| **OpenRouter** | [OpenRouter](https://openrouter.ai/)                | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4-6`, `openai/gpt-5.4`         |
| **Ollama**     | [Ollama](https://ollama.com/)                       | `http://localhost:11434/v1`    | Discovered from your local Ollama server                |

### 2. Configure

1. Open the app and click the ⚙️ **Settings** icon in the bottom left.
2. Paste your **API Key**.
3. **Crucial**: Set the **Base URL** according to the table above, or keep the preset value selected by the provider tab.
4. Enter the **Model** name you want to use.

### 3. Start Coworking

1. **Select a Workspace**: Choose a folder where Claude is allowed to work.
2. **Enter a Prompt**:
   > "Read the financial_report.csv in this folder and create a PowerPoint summary with 5 slides."

### 📝 Important Notes

1.  **macOS Installation**: If you downloaded the DMG directly and see a security warning, go to **System Settings > Privacy & Security** and click **Open Anyway**.
2.  **Network Access**: For tools like `WebSearch`, you may need to enable "Virtual Network Interface" (TUN Mode) in your proxy settings to ensure connectivity.
3.  **Notion Connector**: Besides setting the integration token, you also need to add connections in a root page. See https://www.notion.com/help/add-and-manage-connections-with-the-api for more details.

---

<a id="skills"></a>

## 🧰 Skills Library

sophron cowork ships with built-in skills under `.claude/skills/`, and supports user-added or custom skills, including:

- `pptx` for PowerPoint generation
- `docx` for Word document processing
- `pdf` for PDF handling and forms
- `xlsx` for Excel spreadsheet support
- `skill-creator` for creating custom skills

---

## 🏗️ Architecture

```
sophron/
├── src/
│   ├── main/                    # Electron Main Process (Node.js)
│   │   ├── index.ts             # Main entry point
│   │   ├── claude/              # Agent SDK & Runner
│   │   │   └── agent-runner.ts  # AI agent execution logic
│   │   ├── config/              # Configuration management
│   │   │   └── config-store.ts  # Persistent settings storage
│   │   ├── db/                  # Database layer
│   │   │   └── database.ts      # SQLite/data persistence
│   │   ├── ipc/                 # IPC handlers
│   │   ├── memory/              # Memory management
│   │   │   └── memory-manager.ts
│   │   ├── sandbox/             # Security & Path Resolution
│   │   │   └── path-resolver.ts # Sandboxed file access
│   │   ├── session/             # Session management
│   │   │   └── session-manager.ts
│   │   ├── skills/              # Skill Loader & Manager
│   │   │   └── skills-manager.ts
│   │   └── tools/               # Tool execution
│   │       └── tool-executor.ts # Tool call handling
│   ├── preload/                 # Electron preload scripts
│   │   └── index.ts             # Context bridge setup
│   └── renderer/                # Frontend UI (React + Tailwind)
│       ├── App.tsx              # Root component
│       ├── main.tsx             # React entry point
│       ├── components/          # UI Components
│       │   ├── ChatView.tsx     # Main chat interface
│       │   ├── ConfigModal.tsx  # Settings dialog
│       │   ├── ContextPanel.tsx # File context display
│       │   ├── MessageCard.tsx  # Chat message component
│       │   ├── PermissionDialog.tsx
│       │   ├── Sidebar.tsx      # Navigation sidebar
│       │   ├── Titlebar.tsx     # Custom window titlebar
│       │   ├── TracePanel.tsx   # AI reasoning trace
│       │   └── WelcomeView.tsx  # Onboarding screen
│       ├── hooks/               # Custom React hooks
│       │   └── useIPC.ts        # IPC communication hook
│       ├── store/               # State management
│       │   └── index.ts
│       ├── styles/              # CSS styles
│       │   └── globals.css
│       ├── types/               # TypeScript types
│       │   └── index.ts
│       └── utils/               # Utility functions
├── .claude/
│   └── skills/                  # Default Skill Definitions
│       ├── pptx/                # PowerPoint generation
│       ├── docx/                # Word document processing
│       ├── pdf/                 # PDF handling & forms
│       ├── xlsx/                # Excel spreadsheet support
│       └── skill-creator/       # Skill development toolkit
├── resources/                   # Static Assets (icons, images)
├── electron-builder.yml         # Build configuration
├── vite.config.ts               # Vite bundler config
└── package.json                 # Dependencies & scripts
```

---

## 🗺️ Roadmap

See our full **[ROADMAP.md](ROADMAP.md)** for detailed plans.

**Completed:** Core installers · Filesystem sandboxing · VM isolation (WSL2/Lima) · Skills (PPTX/DOCX/PDF/XLSX) · MCP connectors · Multi-model support · Rich input · i18n

**Coming next:** Memory optimization · Linux support · Plugin system · Computer use · Stable release

---

## ❓ FAQ

**What is sophron cowork?**
sophron cowork is a free, open-source desktop application that provides a local AI agent workspace for processing data. It helps analyze, clean, transform, summarize, and organize workspace files with one-click installers for Windows and macOS.

**How is sophron cowork different from Claude Cowork?**
sophron cowork is positioned around local data processing rather than general coding or chat. It adds multi-model support, GUI automation via computer use, remote control through Feishu/Slack, and VM-level sandbox isolation. See the [feature comparison table](#features) for details.

**What AI models does sophron cowork support?**
sophron cowork currently provides dedicated presets for DeepSeek, Moonshot, Z.AI, Anthropic, OpenAI, OpenRouter, and Ollama. OpenRouter can route to additional hosted models, and Ollama can run local models discovered from your machine.

**Is sophron cowork free?**
Yes. sophron cowork itself is completely free and open-source under the MIT license. You only need to pay for the AI model API usage from your chosen provider.

**Does sophron cowork work on Linux?**
Currently, sophron cowork provides pre-built installers for Windows and macOS only. Linux users can build from source — see the [Build from Source](#installation) section.

**How does sandbox isolation work?**
sophron cowork offers multi-level protection: basic path-based restrictions on all platforms, and enhanced VM-level isolation using WSL2 (Windows) or Lima (macOS). When a VM is available, all commands execute inside an isolated Linux environment, protecting your host system.

**What are Skills and how do I create custom ones?**
Skills are built-in workflows for specific tasks like generating PPTX, DOCX, PDF, or XLSX files. sophron cowork ships with default skills under `.claude/skills/` and includes a `skill-creator` tool to help you build your own custom skills.

**What is MCP and how does it work?**
MCP (Model Context Protocol) lets AI connect to external tools and services. sophron cowork supports MCP connectors for browsers, Notion, and other desktop apps — extending the AI's capabilities beyond just file management and code.

**How do I set up remote control via Feishu or Slack?**
sophron cowork supports remote control through Feishu (Lark) and Slack integration, allowing you to send commands and receive results from collaboration platforms. Check the app settings for remote control configuration.

**Is my data safe? Does sophron cowork send data to external servers?**
sophron cowork runs locally on your machine. Your files stay in your workspace. The only external communication is with the AI model API you configure (e.g., Anthropic, OpenRouter). No data is sent to sophron cowork servers.

## 📄 License

MIT © sophron

---

<p align="center">
  Made with ❤️ by the sophron team with the help of opus4.5
</p>

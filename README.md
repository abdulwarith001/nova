# Nova - AI Super Agent Framework 🚀

**A TypeScript-first autonomous AI agent framework with browser automation, parallel execution, and multi-tool capabilities.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## ✨ Features

### 🤖 Autonomous Agent

- **Multi-step reasoning** - Breaks down complex tasks automatically
- **Tool selection** - Intelligently chooses the right tools
- **Error recovery** - Retries failed operations with fallback strategies
- **Multi-provider LLM** - Supports OpenAI and Anthropic

### 🛠️ Built-in Tools

- **File System** - Read/write files
- **Bash Execution** - Run shell commands
- **Browser Automation** - Web scraping, screenshots, form filling
- **Memory Store** - SQLite with full-text search

### ⚡ Performance

- **Worker Threads** - Parallel tool execution with Piscina
- **Dependency Resolution** - Smart task scheduling
- **Isolated Execution** - Each tool runs in its own thread

### 🔒 Security

- **Permission System** - Capability-based access control
- **Sandbox Mode** - Configurable isolation levels
- **Tool Allowlisting** - Explicit tool permissions

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ (recommended: 22+)
- npm 10+
- OpenAI or Anthropic API key

### Installation

```bash
# Clone the repository
git clone https://github.com/abdulwarith001/nova.git
cd nova

# Install dependencies
npm install

# Build the runtime
cd runtime && npm run build && cd ..
```

### Your First Autonomous Task

```bash
# Set your API key
export OPENAI_API_KEY=sk-...

# Run the autonomous demo
npm run demo:autonomous
```

Nova will autonomously:

1. Reason about the task
2. Select appropriate tools
3. Execute multi-step workflows
4. Handle errors gracefully

---

## 📨 Telegram Setup (BotFather)

Nova supports local Telegram chat using your own BotFather-created bot token.

### Quick setup

```bash
nova telegram setup
nova daemon restart
nova telegram status
nova telegram test
```

The setup flow guides you through:

1. Creating/provisioning a bot with BotFather (`/newbot`)
2. Linking token to local Nova config
3. Auto-detecting owner user/chat IDs after you send `/start`
4. Optional bot command configuration (`/start`, `/help`, `/reset`)

Owner-only access is enforced by default.

For full details, see `docs/guides/telegram-setup.md`.

Live progress streaming is enabled by default for long web-assist turns.

- Disable gateway progress frames: `NOVA_CHAT_PROGRESS_STREAM=false`
- Slow down Telegram progress updates: `NOVA_TELEGRAM_PROGRESS_MIN_INTERVAL_MS=1500`
- Cap Telegram progress messages per turn: `NOVA_TELEGRAM_PROGRESS_MAX_MESSAGES_PER_TURN=6`
- Disable CLI progress rendering per session: `nova chat --no-progress`

---

## 💬 WhatsApp Setup

Nova supports WhatsApp as a messaging channel with **identity-aware routing** — it knows who is messaging and acts accordingly.

### Two modes

| Mode           | Use case                          | How it works                                                                                                |
| -------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Own-number** | Your personal WhatsApp            | Nova reads your outgoing messages and replies in-chat. Messages from others are silently ignored.           |
| **Bot-number** | Separate WhatsApp Business number | Nova runs on a dedicated number. It recognizes you (the owner) and optionally allows other numbers to chat. |

### Quick setup

```bash
nova whatsapp setup    # Guided setup: mode, phone number, name, allowed list
nova daemon restart
nova whatsapp status
```

The setup flow prompts for:

1. **Mode** — own number or separate bot number
2. **Your phone number** — so Nova recognizes you as the owner
3. **Your name** — so Nova can refer to you personally
4. **Allowed numbers** (bot-number mode only) — optional list of additional numbers that can chat with Nova

### Identity-aware behavior

- **Owner messages** → Nova responds as your personal assistant, references past conversations, and proactively suggests things
- **Authorized third-party** (bot-number mode) → Nova responds on your behalf, clearly identifying itself as your AI assistant. **Strict privacy**: never shares your personal data, memories, or conversation history with anyone else.
- **Unauthorized sender** (bot-number mode) → Polite "not available" reply + notification sent to you with a preview of their message

### Environment variables

| Variable                        | Description                                                  |
| ------------------------------- | ------------------------------------------------------------ |
| `NOVA_WHATSAPP_ENABLED`         | `true` to enable the channel                                 |
| `NOVA_WHATSAPP_OWNER_NUMBER`    | Your phone number (digits only, with country code)           |
| `NOVA_WHATSAPP_OWNER_NAME`      | Your display name                                            |
| `NOVA_WHATSAPP_IS_OWN_NUMBER`   | `true` for own-number mode                                   |
| `NOVA_WHATSAPP_ALLOWED_NUMBERS` | Comma-separated list of authorized numbers (bot-number mode) |

Web-assisted external data is available behind feature flags.

- Enable web-agent engine: `NOVA_WEB_AGENT_ENABLED=true|false` (default: `true`)
- External-data routing mode: `NOVA_CHAT_EXTERNAL_DATA_MODE=auto|always` (default: `auto`)
- Browser visibility mode (local backend): `NOVA_WEB_HEADLESS=true|false` (default: `true`)
- Browser backend mode: `NOVA_WEB_BACKEND=auto|steel|browserbase|local` (default: `auto`)
- Steel API key: `STEEL_API_KEY=<key>`
- Steel live view enabled: `NOVA_WEB_STEEL_ENABLE_LIVE_VIEW=true|false` (default: `true`)
- Steel session timeout: `NOVA_WEB_STEEL_SESSION_TIMEOUT_MS=600000`
- Steel max concurrent sessions: `NOVA_WEB_STEEL_MAX_CONCURRENCY=1`
- Legacy Browserbase keys are still supported when `NOVA_WEB_BACKEND=browserbase`.
- Fallback to local backend when remote fails: `NOVA_WEB_BACKEND_FALLBACK_ON_ERROR=true|false` (default: `true`)
- Expose live-view link in progress messages: `NOVA_WEB_EXPOSE_LIVE_VIEW_LINK=true|false` (default: `true`)
- Default browser profile for web-assist sessions: `NOVA_WEB_PROFILE_ID=<profileId>` (optional)
- Stream thought summaries in progress frames: `NOVA_CHAT_STREAM_THOUGHTS=true|false` (default: `false`)
- Concise response sentence cap: `NOVA_CHAT_CONCISE_MAX_SENTENCES=4`
- Concise response character cap: `NOVA_CHAT_CONCISE_MAX_CHARS=650`
- Max search results per turn: `NOVA_WEB_AGENT_MAX_SEARCH_RESULTS=8`
- Max pages visited per turn: `NOVA_WEB_AGENT_MAX_PAGES_PER_TURN=3`

For visible local browsing, set `NOVA_WEB_HEADLESS=false` in `~/.nova/.env` and restart the daemon.
Session-to-profile assignments are persisted at `~/.nova/web-agent/profile-assignments.json`.
Remote provider session/context assignments are persisted at `~/.nova/web-agent/remote-context-assignments.json`.

Human-like web interaction tools are available for autonomous browsing:

- `web_session_start`, `web_session_end` (persistent profile-backed browser sessions)
- `web_observe`, `web_decide_next`, `web_act` (plan-act-observe control loop)
- `web_search`, `web_extract_structured` (multi-engine search + structured extraction)
- `curl` (raw HTTP request tool for API/web endpoints)

---

## 📖 Usage

### Basic Example

```typescript
import { Runtime } from "./runtime/src/index.js";
import { AutonomousAgent } from "./agent/src/autonomous.js";

// Create runtime
const runtime = await Runtime.create({
  memoryPath: ":memory:",
  security: {
    sandboxMode: "none",
    allowedTools: ["bash", "read", "write"],
  },
  executor: {
    maxParallel: 4,
    defaultTimeoutMs: 30000,
  },
});

// Create autonomous agent
const agent = new AutonomousAgent(runtime, {
  provider: "openai",
  model: "gpt-4-turbo",
  temperature: 0.7,
  maxIterations: 10,
});

// Execute a task
const result = await agent.execute("Create a file with project statistics");

console.log(result);
```

### Browser Automation

```typescript
// Enable browser tools
const runtime = await Runtime.create({
  security: {
    allowedTools: [
      "web_session_start",
      "web_observe",
      "web_act",
      "web_extract_structured",
    ],
  },
});

// Agent will autonomously browse the web
await agent.execute("Visit example.com and extract the main heading");
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│           Autonomous Agent              │
│  (Multi-step reasoning & tool calling)  │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│            Runtime Engine               │
│  ┌─────────────────────────────────┐   │
│  │  Executor (Piscina Pool)        │   │
│  │  ├─ Worker 1 (bash, read, write)│   │
│  │  ├─ Worker 2 (web-agent tools)  │   │
│  │  ├─ Worker 3 (...)              │   │
│  │  └─ Worker 4 (...)              │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  Memory Store (SQLite + FTS5)   │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  Security Manager               │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

## 🎯 Available Tools

### File System

- `read` - Read file contents
- `write` - Write content to files

### Shell

- `bash` - Execute shell commands

### Browser (Web Agent)

- `web_session_start` - Start/resume persistent profile session
- `web_observe` - Capture current page state + optional screenshot
- `web_decide_next` - Decide next action from goal and world state
- `web_act` - Execute navigate/click/fill/submit/scroll/wait/extract/search actions
- `web_search` - Multi-engine search with reranking
- `web_extract_structured` - Structured extraction from active page
- `web_session_end` - End and release session

---

## 📊 Examples

### Run the Demos

```bash
# Basic runtime demo
npm run example:runtime

# Autonomous agent demo
npm run demo:autonomous

# Browser automation demo
npm run demo:browser

# End-to-end demo
npm run demo
```

### Example Tasks

**File Operations:**

```
"Create a file with project statistics"
"Read all package.json files and list dependencies"
```

**Web Scraping:**

```
"Visit example.com and extract the main heading"
"Take a screenshot of github.com"
```

**Multi-step:**

```
"Find all TypeScript files and count lines of code"
"Analyze the project structure and create a report"
```

---

## 🔧 Configuration

### Runtime Config

```typescript
{
  memoryPath: ':memory:',  // or '/path/to/db.sqlite'
  security: {
    sandboxMode: 'none',   // 'none' | 'strict'
    allowedTools: ['bash', 'read', 'write'],
    deniedTools: [],
  },
  executor: {
    maxParallel: 4,        // Worker thread pool size
    defaultTimeoutMs: 30000,
  },
}
```

### Agent Config

```typescript
{
  provider: 'openai',      // 'openai' | 'anthropic'
  model: 'gpt-4-turbo',
  temperature: 0.7,
  maxTokens: 2048,
  maxIterations: 10,       // Max reasoning loops
  retryFailedTools: true,  // Auto-retry failed tools
  maxToolRetries: 2,       // Retry attempts
}
```

---

## 🧪 Development

### Project Structure

```
nova/
├── runtime/          # Core runtime engine
│   ├── src/
│   │   ├── index.ts       # Main runtime
│   │   ├── executor.ts    # Parallel executor
│   │   ├── worker.ts      # Tool execution worker
│   │   ├── web-agent/     # Web-agent architecture (sessions/actions/search/policy)
│   │   ├── memory.ts      # Memory store
│   │   ├── security.ts    # Security manager
│   │   └── tools.ts       # Tool registry
│   └── package.json
├── agent/            # LLM integration
│   ├── src/
│   │   ├── index.ts       # LLM client
│   │   └── autonomous.ts  # Autonomous agent
│   └── package.json
├── gateway/          # API server
│   └── src/index.ts
├── cli/              # Command-line interface
│   └── src/index.ts
└── examples/         # Demo scripts
```

### Build

```bash
# Build runtime
cd runtime && npm run build

# Build all packages
npm run build --workspaces
```

### Testing

```bash
# Run all demos
npm run demo
npm run demo:autonomous
npm run demo:browser
```

---

## 🎓 How It Works

### 1. Task Submission

User provides a natural language task

### 2. Reasoning Loop

Agent breaks down the task and selects tools

### 3. Tool Execution

Tools run in isolated worker threads

### 4. Result Synthesis

Agent processes results and continues or completes

### 5. Error Handling

Failed operations retry with fallback strategies

---

## 🚧 Roadmap

- [x] **Milestone 1**: Foundation & Runtime
- [x] **Milestone 2**: Autonomous Agent
- [x] **Milestone 3**: Browser Automation
- [ ] **Milestone 4**: Long-Running Tasks
- [ ] **Milestone 5**: Multi-Agent System
- [ ] **Milestone 6**: Production Ready

---

## 🚀 GitHub Release

Before publishing, run the release checklist:

- `docs/release-checklist.md`
- `npm run check:secrets`

---

## 📝 License

MIT License - see [LICENSE](LICENSE) for details

---

## 🙏 Acknowledgments

Built with:

- [Playwright](https://playwright.dev/) - Browser automation
- [Piscina](https://github.com/piscinajs/piscina) - Worker thread pool
- [OpenAI](https://openai.com/) & [Anthropic](https://anthropic.com/) - LLM providers
- [SQLite](https://www.sqlite.org/) - Memory persistence

---

## 🤝 Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

---

**Nova - Making AI agents truly autonomous** 🚀

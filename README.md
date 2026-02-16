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
    allowedTools: ["browser_navigate", "browser_screenshot", "browser_extract"],
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
│  │  ├─ Worker 2 (browser tools)    │   │
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

### Browser (Playwright)

- `browser_navigate` - Navigate to URLs
- `browser_extract` - Extract text/data
- `browser_screenshot` - Capture pages
- `browser_click` - Click elements
- `browser_fill` - Fill forms
- `browser_html` - Get page source
- `browser_close` - Clean up browser

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
│   │   ├── browser-tools.ts  # Browser automation
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

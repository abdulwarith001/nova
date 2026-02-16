# Nova CLI Tool

Production-ready command-line interface for Nova AI Agent.

## Installation

```bash
cd cli
npm install
npm run build
```

## Quick Start

1. **Initialize Nova**:

```bash
node dist/index.js init
```

2. **Start Daemon**:

```bash
node dist/index.js daemon start
```

3. **Chat with Nova**:

```bash
node dist/index.js chat
```

## Commands

### `nova init`

Interactive onboarding wizard that configures:

- LLM provider (OpenAI/Anthropic)
- API keys
- Email settings (optional)
- Default model

Creates `~/.nova/config.json` and `~/.nova/.env`

### `nova daemon <action>`

Manage background daemon service:

- `start` - Launch daemon
- `stop` - Stop daemon
- `status` - Check if running
- `logs` - View logs
- `restart` - Restart daemon

### `nova chat`

Interactive conversation with Nova:

```bash
nova chat                    # General chat
nova chat --agent researcher # Chat with specific agent
```

### `nova run "<task>"`

Execute one-shot task:

```bash
nova run "Summarize top HN story"
nova run "Create a file with today's date"
```

### `nova remind "<message>" "<time>"`

Create reminder:

```bash
nova remind "Call John" "tomorrow at 2pm"
nova remind "Team meeting" "in 30 minutes"
```

### `nova reminders`

List and manage reminders:

```bash
nova reminders               # List all pending
nova reminders --cancel <id> # Cancel by ID
```

### `nova jobs`

Manage scheduled jobs:

```bash
nova jobs                    # List all jobs
nova jobs --cancel <id>      # Cancel by ID
```

### `nova memory <action>`

Memory management:

```bash
nova memory search "query"   # Search memories
nova memory clear            # Clear all memories
```

### `nova config`

Configuration management:

```bash
nova config --show           # Show current config
nova config --edit           # Edit config files
```

## Configuration

### ~/.nova/config.json

```json
{
  "defaultModel": "gpt-4o-mini",
  "defaultProvider": "openai",
  "memoryPath": "/Users/user/.nova/memory.db",
  "daemonPort": 3000,
  "logLevel": "info",
  "notificationEmail": "you@example.com"
}
```

### ~/.nova/.env

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
NOTIFICATION_EMAIL=you@example.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=user@gmail.com
SMTP_PASS=app-password
```

## Architecture

```
CLI (Commands) → WebSocket Client → Daemon (Gateway) → Runtime
```

- **CLI**: Lightweight client, connects to daemon
- **Daemon**: Background service running Nova runtime
- **Communication**: WebSocket (ws://localhost:3000)

## Development

```bash
# Build
npm run build

# Dev mode
npm run dev

# Test
npm test
```

## Reminders

```bash
# Standard reminder
nova remind "Pay rent" "tomorrow 9am"

# Send reminder email to a specific address
nova remind "Pay rent" "tomorrow 9am" --email you@example.com

# Example prompts in chat
# "Remind me to call my dad"
# "Remind me to go home in the next 3 minutes"
# "Research about Wizkid and send to my email in the next 1 hr"
# "Research about latest stock prices and send to my email every morning"
```

## Roadmap

- [ ] PM2 integration for production
- [ ] Streaming response support
- [ ] Real-time tool execution visibility
- [ ] Desktop notifications
- [ ] Auto-start on system boot

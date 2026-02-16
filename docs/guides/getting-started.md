# Nova - Getting Started

Welcome to Nova! This guide will help you get up and running with your AI super agent.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Rust** 1.75 or later ([Install Rust](https://rustup.rs/))
- **Node.js** 22 or later ([Install Node.js](https://nodejs.org/))
- **Git** ([Install Git](https://git-scm.com/))

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/nova.git
cd nova
```

### 2. Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Build the Rust core
cd core && cargo build --release && cd ..
```

### 3. Configure Nova

Copy the example configuration:

```bash
cp config.example.toml ~/.nova/config.toml
```

Edit `~/.nova/config.toml` and add your LLM API keys:

```toml
[agent]
model = "anthropic/claude-opus-4-5"

# Add your Anthropic API key
[agent.anthropic]
api_key = "sk-ant-..."
```

### 4. Start the Gateway

```bash
npm run dev:gateway
```

The gateway will start on `http://127.0.0.1:18789`.

### 5. Test the Connection

Open another terminal and test the health endpoint:

```bash
curl http://127.0.0.1:18789/health
```

You should see:

```json
{ "status": "ok", "timestamp": "2026-02-04T16:00:00.000Z" }
```

## Next Steps

- [Create Your First Skill](creating-skills.md)
- [Telegram Setup](telegram-setup.md)
- [Explore the API](../api/README.md)
- [Architecture Overview](../architecture/overview.md)

## Troubleshooting

### Port Already in Use

If port 18789 is already in use, change it in your config:

```toml
[gateway]
port = 18790
```

### Rust Build Errors

Make sure you have the latest Rust toolchain:

```bash
rustup update
```

### Node.js Version Issues

Nova requires Node.js 22+. Check your version:

```bash
node --version
```

## Getting Help

- **Documentation**: [docs.nova.dev](https://docs.nova.dev)
- **Discord**: [Join our community](https://discord.gg/nova)
- **GitHub Issues**: [Report bugs](https://github.com/yourusername/nova/issues)

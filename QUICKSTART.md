# Nova - Quick Start Guide

## Prerequisites Check

Before starting, verify you have:

```bash
# Check Node.js version (need 20+, prefer 22+)
node --version

# Check if Rust is installed
rustc --version || echo "Rust not installed"

# Check if cargo is available
cargo --version || echo "Cargo not installed"
```

## Installation Steps

### 1. Install Rust (if not installed)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### 2. Install Project Dependencies

```bash
cd /Users/engmare/personal-projects/nova

# Node.js dependencies (already done)
# npm install

# Gateway dependencies
cd gateway && npm install && cd ..

# Build Rust core
cd core && cargo build && cd ..
```

### 3. Run the Example

```bash
# Run the simple example
cd core
cargo run --example simple
```

### 4. Start the Gateway

```bash
# From project root
npm run dev:gateway
```

### 5. Test the Setup

```bash
# In another terminal
curl http://127.0.0.1:18789/health
```

Expected output:

```json
{ "status": "ok", "timestamp": "2026-02-04T..." }
```

## Next Steps

1. **Explore the code**: Check out `core/src/lib.rs` and `gateway/src/index.ts`
2. **Run tests**: `cd core && cargo test`
3. **Start developing**: Begin with Milestone 1 tasks

## Troubleshooting

### Rust not found

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### Build errors

```bash
# Clean and rebuild
cd core
cargo clean
cargo build
```

### Gateway won't start

```bash
# Check if port 18789 is in use
lsof -i :18789

# Or change port in config.example.toml
```

## Development Workflow

```bash
# Terminal 1: Run gateway in watch mode
npm run dev:gateway

# Terminal 2: Work on Rust core
cd core
cargo watch -x test

# Terminal 3: Run examples
cargo run --example simple
```

## Resources

- [Implementation Plan](file:///Users/engmare/.gemini/antigravity/brain/21dbcbdd-310c-4fa0-885c-546b78e72db4/implementation_plan.md)
- [Task List](file:///Users/engmare/.gemini/antigravity/brain/21dbcbdd-310c-4fa0-885c-546b78e72db4/task.md)
- [Full Setup Guide](SETUP.md)

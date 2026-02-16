# Nova - Setup Instructions

## Current Status

✅ Project scaffolding created  
✅ Node.js dependencies installed  
⚠️ Rust toolchain needs to be installed  
⚠️ Node.js version warning (v20 vs required v22)

## Next Steps

### 1. Install Rust (Required)

```bash
# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Reload shell
source $HOME/.cargo/env

# Verify installation
rustc --version
cargo --version
```

### 2. (Optional) Upgrade Node.js

The project requires Node.js 22+, but you have v20.19.6. This will mostly work, but for full compatibility:

```bash
# Using nvm (recommended)
nvm install 22
nvm use 22

# Or using Homebrew
brew install node@22
```

### 3. Add Missing Rust Dependencies

```bash
cd /Users/engmare/personal-projects/nova/core
cargo add chrono uuid --features uuid/v4,uuid/serde
```

### 4. Build the Rust Core

```bash
cd /Users/engmare/personal-projects/nova/core
cargo build --release
```

### 5. Install Gateway Dependencies

```bash
cd /Users/engmare/personal-projects/nova/gateway
npm install
```

### 6. Start Development

```bash
# Terminal 1: Start the gateway
cd /Users/engmare/personal-projects/nova
npm run dev:gateway

# Terminal 2: Run tests
npm test
```

## Troubleshooting

### "cargo: command not found"

Rust is not installed. Follow step 1 above.

### Node version warnings

The project will work with Node 20, but some features may not be available. Upgrade to Node 22+ for full compatibility.

### Build errors

Make sure all dependencies are installed:

```bash
cd /Users/engmare/personal-projects/nova
npm install
cd core && cargo build
cd ../gateway && npm install
```

## What's Next

Once setup is complete, you can:

1. **Start the gateway**: `npm run dev:gateway`
2. **Test the health endpoint**: `curl http://127.0.0.1:18789/health`
3. **Begin Milestone 1 development**:
   - Implement vector search in memory module
   - Add LLM client integration
   - Create first executable skill

## Resources

- [Implementation Plan](file:///Users/engmare/.gemini/antigravity/brain/21dbcbdd-310c-4fa0-885c-546b78e72db4/implementation_plan.md)
- [Walkthrough](file:///Users/engmare/.gemini/antigravity/brain/21dbcbdd-310c-4fa0-885c-546b78e72db4/walkthrough.md)
- [Getting Started Guide](file:///Users/engmare/personal-projects/nova/docs/guides/getting-started.md)

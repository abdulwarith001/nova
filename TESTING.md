# Nova - Testing Guide

## Quick Test Commands

### 1. Test CLI

```bash
cd /Users/engmare/personal-projects/nova

# Run CLI directly
npm run nova -- --help

# Or build and link globally
cd cli
npm run build
npm link
nova --help
```

### 2. Test Gateway Server

```bash
# Start the gateway
npm run dev:gateway

# In another terminal, test the health endpoint
curl http://127.0.0.1:18789/health

# Test WebSocket (using websocat if installed)
websocat ws://127.0.0.1:18789/ws
```

### 3. Test Agent (when Rust is installed)

```bash
cd core
cargo test
cargo run --example simple
```

## CLI Commands to Try

### Initialize Nova

```bash
nova init
# Follow the prompts to set up Nova
```

### Gateway Management

```bash
# Start gateway
nova gateway start

# Check status
nova gateway status

# Stop gateway
nova gateway stop
```

### Skill Management

```bash
# Create a new skill
nova skill create my-first-skill

# List skills
nova skill list
```

### Configuration

```bash
# Set a config value
nova config set agent.model "anthropic/claude-opus-4-5"

# Get all config
nova config get

# Get specific value
nova config get agent.model
```

### System Info

```bash
# Show system information
nova info
```

## Expected Outputs

### Health Check

```json
{
  "status": "ok",
  "timestamp": "2026-02-04T17:45:00.000Z"
}
```

### Nova Info

```
╔═══════════════════════════════════╗
║     NOVA - AI Super Agent      ║
╚═══════════════════════════════════╝

System Information:

Version: 0.1.0
Node.js: v20.19.6
Platform: darwin
Nova Path: /Users/engmare/.nova
```

## Troubleshooting

### CLI not found

```bash
cd cli
npm link
```

### Gateway won't start

```bash
# Check if port is in use
lsof -i :18789

# Kill process if needed
kill -9 $(lsof -t -i:18789)
```

### Module not found errors

```bash
# Reinstall dependencies
npm install
cd cli && npm install
cd ../gateway && npm install
cd ../agent && npm install
```

## Next Steps After Testing

1. ✅ Verify CLI works
2. ✅ Verify gateway starts
3. ⏳ Install Rust and test core
4. ⏳ Implement first skill
5. ⏳ Test end-to-end workflow

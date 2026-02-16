# Telegram Setup (BotFather + Local Nova)

This guide configures Telegram as a personal Nova chat channel on your local machine.

## Requirements

- Nova installed locally
- Gateway daemon working (`nova daemon status`)
- A Telegram account

## 1) Create a bot with BotFather

1. Open Telegram and message `@BotFather`.
2. Run `/newbot`.
3. Choose a bot name and username.
4. Copy the bot token (looks like `123456:ABC...`).

## 2) Run Nova Telegram setup

```bash
nova telegram setup
```

The setup wizard will:

1. Validate your token with Telegram `getMe`.
2. Ask you to send `/start` to your bot and auto-detect owner IDs.
3. Store:
- `TELEGRAM_BOT_TOKEN` in `~/.nova/.env`
- `telegramEnabled`, `telegramOwnerUserId`, `telegramOwnerChatId` in `~/.nova/config.json`
4. Optionally configure bot commands (`/start`, `/help`, `/reset`).

## 3) Restart Nova daemon

```bash
nova daemon restart
```

## 4) Verify setup

```bash
nova telegram status
nova telegram test
```

Then send a normal message to your bot in Telegram.

## Owner-only behavior

- Nova accepts messages only from the configured owner user/chat ID.
- Unauthorized users receive a fixed denial message.
- Unauthorized messages do not reach model/tool execution.

## Troubleshooting

### Bot not replying

1. Ensure daemon is running: `nova daemon status`
2. Check Telegram channel state via gateway status:
- `curl http://127.0.0.1:18789/api/status`
3. Confirm token and owner IDs with `nova telegram status`
4. Restart daemon after config changes: `nova daemon restart`

### Invalid token

- Re-run `nova telegram setup` and paste the correct BotFather token.

### Wrong owner ID

- Re-run `nova telegram setup` and complete auto-detection after sending `/start`.

### Polling or rate-limit issues

Set these env values in `~/.nova/.env` and restart daemon:

- `NOVA_TELEGRAM_POLL_TIMEOUT_SEC=25`
- `NOVA_TELEGRAM_RETRY_BASE_MS=1000`
- `NOVA_TELEGRAM_RETRY_MAX_MS=30000`

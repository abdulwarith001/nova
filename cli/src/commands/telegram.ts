import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const NOVA_DIR = join(homedir(), ".nova");
const CONFIG_PATH = join(NOVA_DIR, "config.json");
const ENV_PATH = join(NOVA_DIR, ".env");

interface NovaConfig {
  defaultModel?: string;
  defaultProvider?: string;
  memoryPath?: string;
  daemonPort?: number;
  logLevel?: string;
  notificationEmail?: string;
  telegramEnabled?: boolean;
  telegramOwnerUserId?: number;
  telegramOwnerChatId?: number;
}

interface GatewayStatusPayload {
  status?: string;
  telegram?: {
    enabled?: boolean;
    running?: boolean;
    connected?: boolean;
    ownerUserId?: number;
    ownerChatId?: number;
    botUsername?: string;
    lastError?: string;
    lastErrorAt?: string;
  };
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    from?: { id: number; username?: string };
    chat?: { id: number; type: string };
    text?: string;
  };
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramBotCommand {
  command: string;
  description: string;
}

export async function telegramCommand(action?: string): Promise<void> {
  switch ((action || "").toLowerCase()) {
    case "setup":
      await setupTelegram();
      return;
    case "status":
      await telegramStatus();
      return;
    case "disable":
      await disableTelegram();
      return;
    case "test":
      await testTelegram();
      return;
    default:
      showHelp();
  }
}

async function setupTelegram(): Promise<void> {
  ensureNovaDir();
  const config = readConfig();
  const env = readEnv();

  console.log(chalk.cyan.bold("\n📨 Telegram Setup\n"));
  console.log(chalk.gray("BotFather setup steps:"));
  console.log(chalk.gray("1. Open Telegram and chat with @BotFather"));
  console.log(chalk.gray("2. Run /newbot and finish bot creation"));
  console.log(chalk.gray("3. Copy the bot token from BotFather"));
  console.log(
    chalk.gray("4. Open your new bot and send /start before owner detection\n"),
  );

  const { botToken } = await inquirer.prompt([
    {
      type: "password",
      name: "botToken",
      message: "Enter Telegram bot token:",
      default: env.TELEGRAM_BOT_TOKEN || "",
      validate: (input: string) =>
        input.trim().length > 0 ? true : "Bot token is required",
    },
  ]);

  const spinner = ora("Validating bot token...").start();
  let me: TelegramUser;
  try {
    me = await telegramApi<TelegramUser>(botToken, "getMe", {});
    spinner.succeed(
      `Connected to @${me.username || "unknown_bot"} (${me.first_name})`,
    );
  } catch (error: any) {
    spinner.fail("Failed to validate bot token");
    console.error(chalk.red(error?.message || "Unknown Telegram API error"));
    return;
  }

  let ownerUserId = config.telegramOwnerUserId;
  let ownerChatId = config.telegramOwnerChatId;

  const { autoDetect } = await inquirer.prompt([
    {
      type: "confirm",
      name: "autoDetect",
      message: "Auto-detect owner IDs from your next message to the bot?",
      default: true,
    },
  ]);

  if (autoDetect) {
    console.log(
      chalk.gray(
        "\nSend /start (or any text) to your Telegram bot now. Waiting up to 60 seconds...\n",
      ),
    );
    const detectSpinner = ora("Waiting for Telegram message...").start();
    try {
      const owner = await waitForOwner(botToken, 60_000);
      ownerUserId = owner.userId;
      ownerChatId = owner.chatId;
      detectSpinner.succeed(
        `Detected owner user=${ownerUserId} chat=${ownerChatId}`,
      );
    } catch {
      detectSpinner.warn("Could not auto-detect owner IDs within timeout");
    }
  }

  if (!ownerUserId && !ownerChatId) {
    const manual = await inquirer.prompt([
      {
        type: "input",
        name: "ownerUserId",
        message: "Owner Telegram user ID (optional):",
      },
      {
        type: "input",
        name: "ownerChatId",
        message: "Owner Telegram chat ID (optional):",
      },
    ]);
    ownerUserId = parseOptionalNumber(manual.ownerUserId);
    ownerChatId = parseOptionalNumber(manual.ownerChatId);
  }

  if (!ownerUserId && !ownerChatId) {
    console.log(
      chalk.red(
        "\n❌ Setup requires at least one owner identifier (user ID or chat ID).\n",
      ),
    );
    return;
  }

  const { configureCommands } = await inquirer.prompt([
    {
      type: "confirm",
      name: "configureCommands",
      message: "Configure Telegram bot commands automatically?",
      default: true,
    },
  ]);

  if (configureCommands) {
    const commands: TelegramBotCommand[] = [
      { command: "start", description: "Confirm Nova bot is ready" },
      { command: "help", description: "Show available bot commands" },
      { command: "reset", description: "Reset chat context for this chat" },
    ];
    const commandSpinner = ora("Setting Telegram bot commands...").start();
    try {
      await telegramApi(botToken, "setMyCommands", {
        commands,
      });
      commandSpinner.succeed("Bot commands configured");
    } catch (error: any) {
      commandSpinner.warn(
        `Could not set bot commands: ${error?.message || "Unknown Telegram API error"}`,
      );
    }

    const { shortDescription } = await inquirer.prompt([
      {
        type: "input",
        name: "shortDescription",
        message: "Optional short bot description (press Enter to skip):",
        default: "",
      },
    ]);
    const normalizedDescription = String(shortDescription || "").trim();
    if (normalizedDescription) {
      const descriptionSpinner = ora("Setting bot short description...").start();
      try {
        await telegramApi(botToken, "setMyShortDescription", {
          short_description: normalizedDescription.slice(0, 120),
        });
        descriptionSpinner.succeed("Short description configured");
      } catch (error: any) {
        descriptionSpinner.warn(
          `Could not set short description: ${error?.message || "Unknown Telegram API error"}`,
        );
      }
    }
  }

  const nextConfig: NovaConfig = {
    ...config,
    telegramEnabled: true,
    telegramOwnerUserId: ownerUserId,
    telegramOwnerChatId: ownerChatId,
  };
  writeConfig(nextConfig);

  const nextEnv: Record<string, string> = {
    ...env,
    TELEGRAM_BOT_TOKEN: botToken,
  };
  if (!nextEnv.NOVA_TELEGRAM_POLL_TIMEOUT_SEC) {
    nextEnv.NOVA_TELEGRAM_POLL_TIMEOUT_SEC = "25";
  }
  if (!nextEnv.NOVA_TELEGRAM_RETRY_BASE_MS) {
    nextEnv.NOVA_TELEGRAM_RETRY_BASE_MS = "1000";
  }
  if (!nextEnv.NOVA_TELEGRAM_RETRY_MAX_MS) {
    nextEnv.NOVA_TELEGRAM_RETRY_MAX_MS = "30000";
  }
  writeEnv(nextEnv);

  console.log(chalk.green("\n✅ Telegram setup complete\n"));
  console.log(
    chalk.gray(`Bot: @${me.username || "unknown_bot"} (${me.first_name})`),
  );
  console.log(chalk.gray(`Owner User ID: ${ownerUserId ?? "(not set)"}`));
  console.log(chalk.gray(`Owner Chat ID: ${ownerChatId ?? "(not set)"}\n`));
  console.log(chalk.yellow("Restart the gateway to activate Telegram polling:"));
  console.log(chalk.gray("  nova daemon restart\n"));
}

async function telegramStatus(): Promise<void> {
  const config = readConfig();
  const env = readEnv();
  const token = env.TELEGRAM_BOT_TOKEN;

  console.log(chalk.cyan.bold("\n📨 Telegram Status\n"));
  console.log(`Enabled: ${config.telegramEnabled ? "yes" : "no"}`);
  console.log(`Owner User ID: ${config.telegramOwnerUserId ?? "(not set)"}`);
  console.log(`Owner Chat ID: ${config.telegramOwnerChatId ?? "(not set)"}`);
  console.log(`Token: ${token ? maskToken(token) : "(not set)"}`);

  if (token) {
    try {
      const me = await telegramApi<TelegramUser>(token, "getMe", {});
      console.log(`Bot: @${me.username || "unknown_bot"} (${me.first_name})`);
    } catch (error: any) {
      console.log(
        chalk.red(
          `Bot validation failed: ${error?.message || "Unknown Telegram API error"}`,
        ),
      );
    }
  }

  const gatewayStatus = await getGatewayStatus(config);
  if (gatewayStatus) {
    console.log(
      `Gateway: ${gatewayStatus.status === "running" ? "running" : "not running"}`,
    );
    if (gatewayStatus.telegram) {
      console.log(`Telegram Runtime Enabled: ${gatewayStatus.telegram.enabled}`);
      console.log(`Telegram Runtime Running: ${gatewayStatus.telegram.running}`);
      console.log(
        `Telegram Runtime Connected: ${gatewayStatus.telegram.connected}`,
      );
      if (gatewayStatus.telegram.botUsername) {
        console.log(`Runtime Bot: @${gatewayStatus.telegram.botUsername}`);
      }
      if (gatewayStatus.telegram.lastError) {
        console.log(
          chalk.yellow(
            `Runtime Last Error: ${gatewayStatus.telegram.lastError} (${gatewayStatus.telegram.lastErrorAt || "unknown time"})`,
          ),
        );
      }
    }
  } else {
    console.log(chalk.yellow("Gateway: unreachable (daemon may be down)"));
  }

  console.log();
}

async function disableTelegram(): Promise<void> {
  const config = readConfig();
  const nextConfig: NovaConfig = {
    ...config,
    telegramEnabled: false,
  };
  writeConfig(nextConfig);
  console.log(chalk.green("\n✅ Telegram channel disabled in config\n"));
  console.log(chalk.yellow("Restart the gateway for changes to take effect."));
  console.log(chalk.gray("  nova daemon restart\n"));
}

async function testTelegram(): Promise<void> {
  const config = readConfig();
  const env = readEnv();
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = config.telegramOwnerChatId;

  if (!token) {
    console.log(chalk.red("\n❌ TELEGRAM_BOT_TOKEN is not set.\n"));
    return;
  }
  if (!chatId) {
    console.log(
      chalk.red("\n❌ telegramOwnerChatId is not set. Run `nova telegram setup`.\n"),
    );
    return;
  }

  const spinner = ora("Sending Telegram test message...").start();
  try {
    await telegramApi(token, "sendMessage", {
      chat_id: chatId,
      text: "Nova Telegram test: channel is configured and reachable.",
      disable_web_page_preview: true,
    });
    spinner.succeed("Test message sent");

    const gatewayStatus = await getGatewayStatus(config);
    if (!gatewayStatus || gatewayStatus.status !== "running") {
      console.log(
        chalk.yellow(
          "\n⚠️ Gateway daemon is not running. Telegram inbound replies will not work until you start/restart the daemon.",
        ),
      );
      console.log(chalk.gray("  nova daemon restart\n"));
    } else if (gatewayStatus.telegram?.running === false) {
      console.log(
        chalk.yellow(
          "\n⚠️ Gateway is up but Telegram polling is not running. Check `nova telegram status` and daemon logs.",
        ),
      );
      console.log(chalk.gray("  nova daemon logs --tail\n"));
    }
  } catch (error: any) {
    spinner.fail("Failed to send test message");
    console.error(chalk.red(error?.message || "Unknown Telegram API error"));
  }
}

async function waitForOwner(
  token: string,
  timeoutMs: number,
): Promise<{ userId?: number; chatId?: number }> {
  const startedAt = Date.now();
  let offset = await getNextUpdateOffset(token);
  while (Date.now() - startedAt < timeoutMs) {
    const updates = await telegramApi<TelegramUpdate[]>(token, "getUpdates", {
      offset,
      timeout: 10,
      allowed_updates: ["message"],
    });
    for (const update of updates) {
      offset = update.update_id + 1;
      const userId = update.message?.from?.id;
      const chatId = update.message?.chat?.id;
      if (userId || chatId) {
        return { userId, chatId };
      }
    }
  }
  throw new Error("Timeout waiting for owner message");
}

async function getNextUpdateOffset(token: string): Promise<number> {
  try {
    const updates = await telegramApi<TelegramUpdate[]>(token, "getUpdates", {
      timeout: 0,
      allowed_updates: ["message"],
    });
    if (!Array.isArray(updates) || updates.length === 0) {
      return 0;
    }
    return updates[updates.length - 1].update_id + 1;
  } catch {
    return 0;
  }
}

async function telegramApi<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !data.ok || data.result === undefined) {
    throw new Error(
      `Telegram API ${method} failed: ${
        data.description || response.statusText || "unknown error"
      }`,
    );
  }
  return data.result;
}

function readConfig(): NovaConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as NovaConfig;
}

async function getGatewayStatus(
  config: NovaConfig,
): Promise<GatewayStatusPayload | null> {
  const daemonPort = config.daemonPort || 18789;
  try {
    const response = await fetch(`http://127.0.0.1:${daemonPort}/api/status`, {
      method: "GET",
    });
    if (!response.ok) return null;
    return (await response.json()) as GatewayStatusPayload;
  } catch {
    return null;
  }
}

function writeConfig(config: NovaConfig): void {
  ensureNovaDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function readEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const map: Record<string, string> = {};
  const lines = readFileSync(ENV_PATH, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key) map[key] = value;
  }
  return map;
}

function writeEnv(env: Record<string, string>): void {
  ensureNovaDir();
  const lines = Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  writeFileSync(ENV_PATH, lines.join("\n") + "\n");
}

function ensureNovaDir(): void {
  mkdirSync(NOVA_DIR, { recursive: true });
}

function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return undefined;
  const value = Number.parseInt(trimmed, 10);
  return Number.isFinite(value) ? value : undefined;
}

function maskToken(token: string): string {
  if (token.length <= 10) return "*".repeat(token.length);
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function showHelp(): void {
  console.log(chalk.cyan.bold("\n📨 Telegram Commands\n"));
  console.log("Usage: nova telegram <action>\n");
  console.log(chalk.gray("Provision bots with BotFather before setup.\n"));
  console.log("Actions:");
  console.log("  setup     Configure Telegram bot and owner access");
  console.log("  status    Show Telegram configuration and connectivity");
  console.log("  disable   Disable Telegram channel in config");
  console.log("  test      Send a test message to owner chat\n");
}

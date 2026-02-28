import inquirer from "inquirer";
import chalk from "chalk";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { daemonCommand } from "./daemon.js";

export async function initCommand() {
  console.log(chalk.cyan.bold("\n🚀 Welcome to Nova!\n"));
  console.log("Let's set up your AI agent...\n");

  const configDir = join(homedir(), ".nova");
  const envPath = join(configDir, ".env");

  // Check if already initialized
  if (existsSync(envPath)) {
    const { overwrite } = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message:
          "Nova is already configured. Overwrite existing configuration?",
        default: false,
      },
    ]);

    if (!overwrite) {
      console.log(chalk.yellow("\n👋 Setup cancelled.\n"));
      return;
    }
  }

  // 1. Choose LLM provider
  const { provider } = await inquirer.prompt([
    {
      type: "list",
      name: "provider",
      message: "Choose your LLM provider:",
      choices: [
        { name: "OpenAI", value: "openai" },
        { name: "Anthropic", value: "anthropic" },
        { name: "Both", value: "both" },
      ],
    },
  ]);

  // 2. API Keys
  const apiKeys: Record<string, string> = {};

  if (provider === "openai" || provider === "both") {
    const { openaiKey } = await inquirer.prompt([
      {
        type: "password",
        name: "openaiKey",
        message: "Enter your OpenAI API key:",
        validate: (input: string) => input.length > 0 || "API key required",
      },
    ]);
    apiKeys.OPENAI_API_KEY = openaiKey;
  }

  if (provider === "anthropic" || provider === "both") {
    const { anthropicKey } = await inquirer.prompt([
      {
        type: "password",
        name: "anthropicKey",
        message: "Enter your Anthropic API key:",
        validate: (input: string) => input.length > 0 || "API key required",
      },
    ]);
    apiKeys.ANTHROPIC_API_KEY = anthropicKey;
  }

  // 3. Choose default model
  const openaiModels = [
    {
      name: "gpt-4.1-mini  — fast, affordable, great for most tasks (recommended)",
      value: "gpt-4.1-mini",
    },
    { name: "gpt-4.1-nano  — fastest, cheapest", value: "gpt-4.1-nano" },
    { name: "gpt-4.1       — smartest GPT-4 class", value: "gpt-4.1" },
    { name: "gpt-4o-mini   — previous gen fast model", value: "gpt-4o-mini" },
    { name: "gpt-4o        — previous gen flagship", value: "gpt-4o" },
    { name: "gpt-5         — latest frontier model", value: "gpt-5" },
    { name: "o3            — reasoning model (advanced)", value: "o3" },
    { name: "o4-mini       — fast reasoning model", value: "o4-mini" },
  ];

  const anthropicModels = [
    {
      name: "claude-sonnet-4-20250514    — latest, best balance (recommended)",
      value: "claude-sonnet-4-20250514",
    },
    {
      name: "claude-3-7-sonnet-20250219  — strong all-rounder",
      value: "claude-3-7-sonnet-20250219",
    },
    {
      name: "claude-3-5-haiku-20241022   — fast and affordable",
      value: "claude-3-5-haiku-20241022",
    },
    {
      name: "claude-3-5-sonnet-20241022  — previous gen flagship",
      value: "claude-3-5-sonnet-20241022",
    },
  ];

  const models =
    provider === "openai"
      ? openaiModels
      : provider === "anthropic"
        ? anthropicModels
        : [...openaiModels, ...anthropicModels];

  const { defaultModel } = await inquirer.prompt([
    {
      type: "list",
      name: "defaultModel",
      message: "Choose default model:",
      choices: models,
    },
  ]);

  // 4. Create config directory
  mkdirSync(configDir, { recursive: true });

  // 5. Write .env file (preserve existing keys not being overwritten)
  let existingEnv: Record<string, string> = {};
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) existingEnv[match[1]] = match[2];
      }
    } catch {
      // ignore
    }
  }

  const envDefaults: Record<string, string> = {
    NOVA_WEB_BACKEND: "auto",
    NOVA_WEB_BACKEND_FALLBACK_ON_ERROR: "true",
    NOVA_WEB_STEEL_ENABLE_LIVE_VIEW: "true",
    NOVA_WEB_STEEL_SESSION_TIMEOUT_MS: "600000",
    NOVA_WEB_STEEL_MAX_CONCURRENCY: "1",
    NOVA_WEB_EXPOSE_LIVE_VIEW_LINK: "true",
  };

  const mergedEnv = { ...envDefaults, ...existingEnv, ...apiKeys };
  const envContent = Object.entries(mergedEnv)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(envPath, envContent);

  // Determine the actual provider string for config
  const defaultProvider =
    provider === "both"
      ? defaultModel.startsWith("claude")
        ? "anthropic"
        : "openai"
      : provider;

  // 6. Write config.json
  const configPath = join(configDir, "config.json");
  const config = {
    defaultModel,
    defaultProvider,
    logLevel: "info",
    telegramEnabled: false,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(chalk.green("\n✅ Configuration saved!"));
  console.log(chalk.gray(`   Config: ${configPath}`));
  console.log(chalk.gray(`   Env: ${envPath}\n`));

  // 7. Prompt to start daemon
  const { startDaemon } = await inquirer.prompt([
    {
      type: "confirm",
      name: "startDaemon",
      message: "Start Nova daemon now?",
      default: true,
    },
  ]);

  if (startDaemon) {
    console.log(chalk.cyan("\nStarting daemon..."));
    try {
      await daemonCommand("start");
    } catch {
      console.log(chalk.yellow("⚠️  Could not start daemon automatically."));
      console.log(chalk.gray("   Run: nova daemon start\n"));
    }
  }

  console.log(chalk.cyan.bold("\n🎉 Setup complete!\n"));
  console.log("Get started:");
  console.log(
    chalk.gray("  nova chat              # Start chatting via terminal"),
  );
  console.log(chalk.gray("  nova daemon status     # Check daemon status"));
  console.log(
    chalk.gray(
      "  nova config set defaultModel <model>  # Change model anytime\n",
    ),
  );
  console.log("Set up communication channels:");
  console.log(chalk.gray("  nova telegram setup    # Connect Telegram bot"));
  console.log(
    chalk.gray(
      "  nova google setup      # Connect Google Workspace (Gmail, Calendar, Drive)",
    ),
  );
  console.log(chalk.gray("  nova brave setup       # Set up Brave Search API"));
  console.log(
    chalk.gray("  nova web bootstrap     # Set up authenticated web profile\n"),
  );
}

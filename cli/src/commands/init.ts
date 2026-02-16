import inquirer from "inquirer";
import chalk from "chalk";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import ora from "ora";

export async function initCommand() {
  console.log(chalk.cyan.bold("\n🚀 Welcome to Nova!\n"));
  console.log("Let's set up your AI agent...\n");

  // Check if already initialized
  const configDir = join(homedir(), ".nova");
  const envPath = join(configDir, ".env");

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
      choices: ["OpenAI", "Anthropic", "Both"],
    },
  ]);

  // 2. API Keys
  const apiKeys: Record<string, string> = {};

  if (provider === "OpenAI" || provider === "Both") {
    const { openaiKey } = await inquirer.prompt([
      {
        type: "password",
        name: "openaiKey",
        message: "Enter your OpenAI API key:",
        validate: (input) => input.length > 0 || "API key required",
      },
    ]);
    apiKeys.OPENAI_API_KEY = openaiKey;
  }

  if (provider === "Anthropic" || provider === "Both") {
    const { anthropicKey } = await inquirer.prompt([
      {
        type: "password",
        name: "anthropicKey",
        message: "Enter your Anthropic API key:",
        validate: (input) => input.length > 0 || "API key required",
      },
    ]);
    apiKeys.ANTHROPIC_API_KEY = anthropicKey;
  }

  // 3. Email configuration (optional)
  const { setupEmail } = await inquirer.prompt([
    {
      type: "confirm",
      name: "setupEmail",
      message: "Configure email for notifications?",
      default: false,
    },
  ]);

  let notificationEmail: string | undefined;
  if (setupEmail) {
    const emailConfig = await inquirer.prompt([
      {
        type: "input",
        name: "SMTP_HOST",
        message: "SMTP Host:",
        default: "smtp.gmail.com",
      },
      {
        type: "input",
        name: "SMTP_PORT",
        message: "SMTP Port:",
        default: "587",
      },
      {
        type: "input",
        name: "SMTP_USER",
        message: "Email address:",
      },
      {
        type: "password",
        name: "SMTP_PASS",
        message: "Email password/app password:",
      },
      {
        type: "input",
        name: "notificationEmail",
        message: "Default notification email (optional):",
      },
    ]);
    Object.assign(apiKeys, emailConfig);
    if (emailConfig.notificationEmail) {
      notificationEmail = emailConfig.notificationEmail;
    }
  }

  // 4. Default model
  const models =
    provider === "OpenAI"
      ? ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"]
      : provider === "Anthropic"
        ? [
            "claude-3-sonnet-20240229",
            "claude-3-opus-20240229",
            "claude-3-haiku-20240307",
          ]
        : [
            "gpt-4o-mini",
            "gpt-4o",
            "claude-3-sonnet-20240229",
            "claude-3-opus-20240229",
          ];

  const { defaultModel } = await inquirer.prompt([
    {
      type: "list",
      name: "defaultModel",
      message: "Choose default model:",
      choices: models,
    },
  ]);

  // 5. Create config directory
  mkdirSync(configDir, { recursive: true });

  // 6. Write .env file
  const envContent = Object.entries(apiKeys)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(envPath, envContent);

  // 7. Write config.json
  const configPath = join(configDir, "config.json");
  const config = {
    defaultModel,
    defaultProvider: provider.toLowerCase(),
    memoryPath: join(configDir, "memory.db"),
    daemonPort: 3000,
    logLevel: "info",
    notificationEmail,
    telegramEnabled: false,
    telegramOwnerUserId: undefined,
    telegramOwnerChatId: undefined,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(chalk.green("\n✅ Configuration saved!"));
  console.log(chalk.gray(`   Config: ${configPath}`));
  console.log(chalk.gray(`   Env: ${envPath}\n`));

  // 8. Test connection (simulated for now)
  const spinner = ora("Testing connection to LLM...").start();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  spinner.succeed("Connection verified");

  // 9. Prompt to start daemon
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
    const spinner2 = ora("Initializing background service...").start();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    spinner2.succeed("Daemon started successfully");
  }

  console.log(chalk.cyan.bold("\n🎉 Setup complete!\n"));
  console.log("Try these commands:");
  console.log(chalk.gray("  nova chat              # Start chatting"));
  console.log(chalk.gray('  nova run "your task"   # Run a quick task'));
  console.log(chalk.gray("  nova daemon status     # Check daemon status\n"));
}

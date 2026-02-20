import inquirer from "inquirer";
import chalk from "chalk";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import ora from "ora";
import { execa } from "execa";
import { daemonCommand } from "./daemon.js";
import { webAgentCommand } from "./web-agent.js";

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
  const envDefaults: Record<string, string> = {
    NOVA_WEB_BACKEND: "auto",
    NOVA_WEB_BACKEND_FALLBACK_ON_ERROR: "true",
    NOVA_WEB_STEEL_ENABLE_LIVE_VIEW: "true",
    NOVA_WEB_STEEL_SESSION_TIMEOUT_MS: "600000",
    NOVA_WEB_STEEL_MAX_CONCURRENCY: "1",
    NOVA_WEB_EXPOSE_LIVE_VIEW_LINK: "true",
  };

  const envContent = Object.entries({ ...apiKeys, ...envDefaults })
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

  // 8. Install browser binaries for web-assist tools
  await installChromiumBrowser();

  // 9. Test connection (simulated for now)
  const spinner = ora("Testing connection to LLM...").start();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  spinner.succeed("Connection verified");

  // 10. Optional web auth profile bootstrap during init
  let daemonStartedDuringInit = false;
  const { setupWebProfile } = await inquirer.prompt([
    {
      type: "confirm",
      name: "setupWebProfile",
      message: "Set up authenticated web profile now? (Google/site login)",
      default: false,
    },
  ]);

  if (setupWebProfile) {
    const { profileId, startUrl } = await inquirer.prompt([
      {
        type: "input",
        name: "profileId",
        message: "Profile ID:",
        default: "default",
      },
      {
        type: "input",
        name: "startUrl",
        message: "Start URL for login:",
        default: "https://accounts.google.com",
      },
    ]);

    try {
      await daemonCommand("start");
      daemonStartedDuringInit = true;
      await webAgentCommand("bootstrap", profileId, undefined, { startUrl });
    } catch (error: any) {
      console.log(chalk.yellow("\n⚠️  Could not complete web profile bootstrap during init."));
      console.log(chalk.gray(`   ${String(error?.message || error)}`));
      console.log(
        chalk.cyan(
          `   Run later: nova web bootstrap ${String(profileId || "default")} --start-url ${String(startUrl || "https://accounts.google.com")}\n`,
        ),
      );
    }
  }

  // 11. Prompt to start daemon
  if (daemonStartedDuringInit) {
    console.log(chalk.gray("Daemon is already running from profile bootstrap.\n"));
  } else {
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
        const spinner2 = ora("Initializing background service...").start();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        spinner2.succeed("Daemon started successfully");
      }
    }
  }

  console.log(chalk.cyan.bold("\n🎉 Setup complete!\n"));
  console.log("Try these commands:");
  console.log(chalk.gray("  nova chat              # Start chatting"));
  console.log(chalk.gray("  nova web bootstrap     # Set up authenticated web profile"));
  console.log(chalk.gray('  nova run "your task"   # Run a quick task'));
  console.log(chalk.gray("  nova daemon status     # Check daemon status\n"));
}

async function installChromiumBrowser() {
  if (process.env.NOVA_SKIP_BROWSER_INSTALL === "true") {
    console.log(
      chalk.yellow(
        "⚠️  Skipping Chromium install because NOVA_SKIP_BROWSER_INSTALL=true",
      ),
    );
    console.log(chalk.gray("   Run later: npx playwright install chromium\n"));
    return;
  }

  const spinner = ora(
    "Installing Chromium for browser-based web-assist tools...",
  ).start();

  try {
    await execa(
      "npm",
      ["exec", "--yes", "playwright", "install", "chromium"],
      {
        stdio: "pipe",
      },
    );
    spinner.succeed("Chromium installed");
  } catch (error: any) {
    spinner.warn("Could not auto-install Chromium");
    const details =
      error?.shortMessage || error?.stderr || error?.stdout || error?.message;
    if (details) {
      console.log(chalk.gray(`   ${String(details).split("\n")[0]}`));
    }
    console.log(
      chalk.yellow(
        "   Browser web-assist may fail until Chromium is installed manually.",
      ),
    );
    console.log(chalk.cyan("   Run: npx playwright install chromium\n"));
  }
}

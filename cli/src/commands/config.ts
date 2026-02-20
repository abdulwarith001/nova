import chalk from "chalk";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_PATH = join(homedir(), ".nova", "config.json");
const ENV_PATH = join(homedir(), ".nova", ".env");

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

export async function configCommand(
  action?: string,
  key?: string,
  value?: string,
) {
  if (!action) {
    showHelp();
    return;
  }

  switch (action) {
    case "show":
      showConfig();
      break;
    case "set":
      if (!key || !value) {
        console.log(chalk.red("\n❌ Usage: nova config set <key> <value>\n"));
        console.log(
          chalk.gray("Example: nova config set defaultModel gpt-4\n"),
        );
        return;
      }
      setConfig(key, value);
      break;
    case "get":
      if (!key) {
        console.log(chalk.red("\n❌ Usage: nova config get <key>\n"));
        return;
      }
      getConfig(key);
      break;

    case "env-set":
      if (!key || !value) {
        console.log(
          chalk.red("\n❌ Usage: nova config env-set <KEY> <value>\n"),
        );
        console.log(
          chalk.gray("Example: nova config env-set OPENAI_API_KEY sk-...\n"),
        );
        return;
      }
      setEnv(key, value);
      break;
    case "env-get":
      if (!key) {
        console.log(chalk.red("\n❌ Usage: nova config env-get <KEY>\n"));
        return;
      }
      getEnv(key);
      break;
    case "edit":
      console.log(chalk.cyan.bold("\n📝 Edit Configuration\n"));
      console.log(`Config: ${CONFIG_PATH}`);
      console.log(`Env: ${ENV_PATH}`);
      console.log(
        chalk.gray("\nOpen these files in your editor to make changes\n"),
      );
      break;
    default:
      showHelp();
  }
}

function showConfig() {
  console.log(chalk.cyan.bold("\n⚙️  Nova Configuration\n"));

  try {
    const configContent = readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(configContent);

    console.log(`Config file: ${CONFIG_PATH}`);
    console.log(JSON.stringify(config, null, 2));
    console.log("\n");

    // Show env file (with masked secrets)
    console.log(`Environment file: ${ENV_PATH}`);
    const envContent = readFileSync(ENV_PATH, "utf-8");
    const lines = envContent.split("\n");

    for (const line of lines) {
      if (line.trim() && !line.startsWith("#")) {
        const [key, value] = line.split("=");
        if (key && value) {
          // Mask API keys and passwords
          if (
            key.includes("KEY") ||
            key.includes("PASS") ||
            key.includes("SECRET")
          ) {
            console.log(`${key}=${"*".repeat(8)}`);
          } else {
            console.log(line);
          }
        }
      }
    }
    console.log();
  } catch (error) {
    console.log(chalk.red("Failed to read config:"), error);
  }
}

function setConfig(key: string, value: string) {
  try {
    // Read current config
    const configContent = readFileSync(CONFIG_PATH, "utf-8");
    const config: NovaConfig = JSON.parse(configContent);

    // Validate and set value
    const oldValue = (config as any)[key];

    // Type conversion
    let newValue: any = value;
    if (key === "daemonPort") {
      newValue = parseInt(value);
      if (isNaN(newValue)) {
        console.log(chalk.red("\n❌ Port must be a number\n"));
        return;
      }
    }
    if (key === "telegramOwnerUserId" || key === "telegramOwnerChatId") {
      newValue = parseInt(value);
      if (isNaN(newValue)) {
        console.log(chalk.red("\n❌ Telegram IDs must be numbers\n"));
        return;
      }
    }
    if (key === "telegramEnabled") {
      const normalized = value.toLowerCase();
      if (normalized !== "true" && normalized !== "false") {
        console.log(chalk.red("\n❌ telegramEnabled must be true or false\n"));
        return;
      }
      newValue = normalized === "true";
    }
    if (key === "notificationEmail") {
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      if (!isValid) {
        console.log(chalk.red("\n❌ Invalid email address\n"));
        return;
      }
    }

    // Update config
    (config as any)[key] = newValue;

    // Write back
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    console.log(chalk.green("\n✓ Configuration updated\n"));
    console.log(
      `${chalk.bold(key)}: ${chalk.gray(oldValue || "(not set)")} → ${chalk.green(newValue)}\n`,
    );
  } catch (error) {
    console.log(chalk.red("Failed to update config:"), error);
  }
}

function getConfig(key: string) {
  try {
    const configContent = readFileSync(CONFIG_PATH, "utf-8");
    const config: NovaConfig = JSON.parse(configContent);

    const value = (config as any)[key];

    if (value === undefined) {
      console.log(chalk.yellow(`\n⚠️  Key "${key}" not found in config\n`));
      return;
    }

    console.log(chalk.cyan(`\n${key}:`), value, "\n");
  } catch (error) {
    console.log(chalk.red("Failed to read config:"), error);
  }
}

function setEnv(key: string, value: string) {
  try {
    // Read current env file
    let envContent = "";
    try {
      envContent = readFileSync(ENV_PATH, "utf-8");
    } catch {
      // File doesn't exist, will create new
    }

    const lines = envContent.split("\n");
    let found = false;

    // Update existing key or add new one
    const newLines = lines.map((line) => {
      if (line.startsWith(`${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });

    if (!found) {
      newLines.push(`${key}=${value}`);
    }

    // Write back
    writeFileSync(ENV_PATH, newLines.join("\n"));

    console.log(chalk.green("\n✓ Environment variable updated\n"));

    // Mask sensitive values in output
    const displayValue =
      key.includes("KEY") || key.includes("PASS") || key.includes("SECRET")
        ? "*".repeat(8)
        : value;
    console.log(`${chalk.bold(key)} = ${chalk.green(displayValue)}\n`);

    console.log(
      chalk.yellow("⚠️  Restart gateway for changes to take effect\n"),
    );
  } catch (error) {
    console.log(chalk.red("Failed to update env:"), error);
  }
}

function getEnv(key: string) {
  try {
    const envContent = readFileSync(ENV_PATH, "utf-8");
    const lines = envContent.split("\n");

    for (const line of lines) {
      if (line.startsWith(`${key}=`)) {
        const value = line.substring(key.length + 1);

        // Mask sensitive values
        const displayValue =
          key.includes("KEY") || key.includes("PASS") || key.includes("SECRET")
            ? "*".repeat(8)
            : value;

        console.log(chalk.cyan(`\n${key}:`), displayValue, "\n");
        return;
      }
    }

    console.log(chalk.yellow(`\n⚠️  Key "${key}" not found in .env\n`));
  } catch (error) {
    console.log(chalk.red("Failed to read env:"), error);
  }
}

function showHelp() {
  console.log(chalk.cyan.bold("\n⚙️  Configuration Management\n"));
  console.log("Usage: nova config <action> [options]\n");
  console.log("Actions:");
  console.log(
    "  " + chalk.bold("show") + "                 Show current configuration",
  );
  console.log("  " + chalk.bold("get <key>") + "           Get a config value");
  console.log("  " + chalk.bold("set <key> <value>") + "   Set a config value");
  console.log(
    "  " + chalk.bold("env-get <KEY>") + "       Get environment variable",
  );
  console.log(
    "  " + chalk.bold("env-set <KEY> <value>") + " Set environment variable",
  );
  console.log(
    "  " + chalk.bold("edit") + "                Open config files in editor\n",
  );
  console.log("Examples:");
  console.log(chalk.gray("  nova config show"));
  console.log(chalk.gray("  nova config get defaultModel"));
  console.log(chalk.gray("  nova config set defaultModel gpt-4"));
  console.log(
    chalk.gray("  nova config set notificationEmail you@example.com"),
  );

  console.log(chalk.gray("  nova config env-get OPENAI_API_KEY"));
  console.log(chalk.gray("  nova config env-set OPENAI_API_KEY sk-...\n"));
  console.log("Config keys:");
  console.log(
    chalk.gray(
      "  defaultModel, defaultProvider, memoryPath, daemonPort, logLevel, notificationEmail, telegramEnabled, telegramOwnerUserId, telegramOwnerChatId",
    ),
  );
  console.log("\nCommon env keys:");
  console.log(
    chalk.gray("  OPENAI_API_KEY, NOTIFICATION_EMAIL, TELEGRAM_BOT_TOKEN\n"),
  );
}

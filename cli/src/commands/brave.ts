import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const NOVA_DIR = join(homedir(), ".nova");
const ENV_PATH = join(NOVA_DIR, ".env");

export async function braveCommand(action?: string): Promise<void> {
  switch ((action || "").toLowerCase()) {
    case "setup":
      await setupBrave();
      return;
    case "status":
      await braveStatus();
      return;
    case "disable":
      await disableBrave();
      return;
    case "test":
      await testBrave();
      return;
    default:
      showHelp();
  }
}

async function setupBrave(): Promise<void> {
  ensureNovaDir();
  const env = readEnv();

  console.log(chalk.cyan.bold("\n🔍 Brave Search API Setup\n"));
  console.log(chalk.gray("Steps to get your free API key:"));
  console.log(chalk.gray("1. Go to https://brave.com/search/api/"));
  console.log(chalk.gray("2. Click 'Get Started for Free'"));
  console.log(chalk.gray("3. Sign up or log in"));
  console.log(chalk.gray("4. Copy your API key from the dashboard\n"));
  console.log(chalk.gray("Free tier: 2,000 queries/month, 1 query/sec\n"));

  const { apiKey } = await inquirer.prompt([
    {
      type: "password",
      name: "apiKey",
      message: "Enter Brave Search API key:",
      default: env.BRAVE_SEARCH_API_KEY || "",
      validate: (input: string) =>
        input.trim().length > 0 ? true : "API key is required",
    },
  ]);

  const spinner = ora("Validating API key...").start();
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=test&count=1`,
      {
        headers: {
          accept: "application/json",
          "x-subscription-token": apiKey.trim(),
        },
      },
    );

    if (!res.ok) {
      const body = await res.text();
      spinner.fail(`API key invalid (HTTP ${res.status})`);
      console.error(chalk.red(body.slice(0, 200)));
      return;
    }

    const data = (await res.json()) as {
      web?: { results?: Array<{ title?: string }> };
    };
    const resultCount = data.web?.results?.length || 0;
    spinner.succeed(
      `API key valid — test query returned ${resultCount} results`,
    );
  } catch (error: any) {
    spinner.fail("Failed to validate API key");
    console.error(chalk.red(error?.message || "Unknown error"));
    return;
  }

  const nextEnv: Record<string, string> = {
    ...env,
    BRAVE_SEARCH_API_KEY: apiKey.trim(),
  };
  writeEnv(nextEnv);

  console.log(chalk.green("\n✅ Brave Search setup complete\n"));
  console.log(
    chalk.gray(
      "Nova will use Brave Search API as the primary web search provider.",
    ),
  );
  console.log(chalk.gray("DDG/Bing remain as fallback if the API is down.\n"));
  console.log(chalk.yellow("Restart the gateway to activate:"));
  console.log(chalk.gray("  nova daemon restart\n"));
}

async function braveStatus(): Promise<void> {
  const env = readEnv();
  const apiKey = env.BRAVE_SEARCH_API_KEY;

  console.log(chalk.cyan.bold("\n🔍 Brave Search Status\n"));
  console.log(`API Key: ${apiKey ? maskKey(apiKey) : chalk.red("(not set)")}`);

  if (apiKey) {
    const spinner = ora("Checking API connectivity...").start();
    try {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=hello&count=1`,
        {
          headers: {
            accept: "application/json",
            "x-subscription-token": apiKey,
          },
        },
      );
      if (res.ok) {
        spinner.succeed("API is reachable and key is valid");
      } else {
        spinner.warn(`API returned HTTP ${res.status}`);
      }
    } catch (error: any) {
      spinner.fail(`API unreachable: ${error?.message || "Unknown error"}`);
    }
  } else {
    console.log(
      chalk.yellow("Run `nova brave setup` to configure web search.\n"),
    );
  }
  console.log();
}

async function disableBrave(): Promise<void> {
  ensureNovaDir();
  const env = readEnv();
  delete env.BRAVE_SEARCH_API_KEY;
  writeEnv(env);
  console.log(chalk.green("\n✅ Brave Search API key removed\n"));
  console.log(
    chalk.gray("Web search will fall back to DDG/Bing HTML scraping.\n"),
  );
  console.log(chalk.yellow("Restart the gateway for changes to take effect."));
  console.log(chalk.gray("  nova daemon restart\n"));
}

async function testBrave(): Promise<void> {
  const env = readEnv();
  const apiKey = env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) {
    console.log(
      chalk.red(
        "\n❌ BRAVE_SEARCH_API_KEY is not set. Run `nova brave setup`.\n",
      ),
    );
    return;
  }

  const { query } = await inquirer.prompt([
    {
      type: "input",
      name: "query",
      message: "Search query to test:",
      default: "latest AI news",
    },
  ]);

  const spinner = ora(`Searching: "${query}"...`).start();
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      {
        headers: {
          accept: "application/json",
          "x-subscription-token": apiKey,
        },
      },
    );

    if (!res.ok) {
      spinner.fail(`Search failed (HTTP ${res.status})`);
      return;
    }

    const data = (await res.json()) as {
      web?: {
        results?: Array<{ title?: string; url?: string; description?: string }>;
      };
    };

    const results = data.web?.results || [];
    spinner.succeed(`Found ${results.length} results\n`);

    for (const [i, result] of results.entries()) {
      console.log(
        chalk.white.bold(`  ${i + 1}. ${result.title || "(no title)"}`),
      );
      console.log(chalk.blue(`     ${result.url || ""}`));
      if (result.description) {
        console.log(chalk.gray(`     ${result.description.slice(0, 120)}`));
      }
      console.log();
    }
  } catch (error: any) {
    spinner.fail(`Search failed: ${error?.message || "Unknown error"}`);
  }
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

function maskKey(key: string): string {
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function showHelp(): void {
  console.log(chalk.cyan.bold("\n🔍 Brave Search Commands\n"));
  console.log("Usage: nova brave <action>\n");
  console.log(
    chalk.gray("Configure Brave Search API for web search capabilities.\n"),
  );
  console.log("Actions:");
  console.log("  setup     Configure Brave Search API key");
  console.log("  status    Check API key and connectivity");
  console.log("  disable   Remove API key (fall back to DDG/Bing)");
  console.log("  test      Run a test search query\n");
}

import inquirer from "inquirer";
import chalk from "chalk";
import { existsSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const NOVA_DIR = join(homedir(), ".nova");
const MEMORY_DIR = join(NOVA_DIR, "memory");

interface ResetOption {
  name: string;
  value: string;
  description: string;
  paths: string[];
}

const RESET_OPTIONS: ResetOption[] = [
  {
    name: "Conversations",
    value: "conversations",
    description: "Chat history stored in memory/conversations/",
    paths: [join(MEMORY_DIR, "conversations")],
  },
  {
    name: "User Profile",
    value: "user_profile",
    description: "USER.md — everything the agent knows about you",
    paths: [join(MEMORY_DIR, "USER.md")],
  },
  {
    name: "Agent Identity",
    value: "identity",
    description: "IDENTITY.md — agent personality and learned behaviors",
    paths: [join(MEMORY_DIR, "IDENTITY.md")],
  },
  {
    name: "Knowledge (legacy)",
    value: "knowledge",
    description: "knowledge.json — legacy structured knowledge entries",
    paths: [join(MEMORY_DIR, "knowledge.json")],
  },
  {
    name: "Reasoning Logs",
    value: "reasoning",
    description: "reasoning.log — OODA reasoning traces",
    paths: [join(NOVA_DIR, "reasoning.log")],
  },
  {
    name: "Reminders",
    value: "reminders",
    description: "Reminders database and files",
    paths: [
      join(NOVA_DIR, "reminders"),
      join(NOVA_DIR, "reminders.db"),
      join(NOVA_DIR, "reminders.db-shm"),
      join(NOVA_DIR, "reminders.db-wal"),
    ],
  },
  {
    name: "Web Agent Data",
    value: "web_agent",
    description: "Web agent profiles and session data",
    paths: [join(NOVA_DIR, "web-agent"), join(NOVA_DIR, "profiles")],
  },
  {
    name: "Heartbeat",
    value: "heartbeat",
    description: "heartbeat.md — proactive task schedule",
    paths: [join(NOVA_DIR, "heartbeat.md")],
  },
  {
    name: "Onboarding / Config",
    value: "onboarding",
    description: "config.json + .env — API keys, LLM provider, model settings",
    paths: [join(NOVA_DIR, "config.json"), join(NOVA_DIR, ".env")],
  },
  {
    name: "Telegram Setup",
    value: "telegram",
    description: "Telegram bot token and owner config (stored in .env/config)",
    paths: [], // Handled by clearing config — included for visibility
  },
  {
    name: "Brave Search",
    value: "brave",
    description: "Brave Search API key (stored in .env)",
    paths: [], // Handled by clearing config — included for visibility
  },
  {
    name: "Google Workspace",
    value: "google",
    description: "Google OAuth credentials (stored in .env)",
    paths: [], // Handled by clearing config — included for visibility
  },
  {
    name: "WhatsApp Auth",
    value: "whatsapp",
    description: "WhatsApp authentication session data",
    paths: [join(NOVA_DIR, "whatsapp-auth")],
  },
  {
    name: "Legacy Databases",
    value: "legacy_db",
    description: "Old SQLite databases (memory.db, memory-v2.db)",
    paths: [
      join(NOVA_DIR, "memory.db"),
      join(NOVA_DIR, "memory-v2.db"),
      join(NOVA_DIR, "memory-v2.db-shm"),
      join(NOVA_DIR, "memory-v2.db-wal"),
    ],
  },
];

function deletePaths(paths: string[]): number {
  let count = 0;
  for (const p of paths) {
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      count++;
    }
  }
  return count;
}

export async function resetCommand(action?: string) {
  if (action === "all") {
    // Reset everything without prompting
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: chalk.red(
          "⚠️  This will delete ALL agent data (conversations, profiles, knowledge, logs, etc.). Are you sure?",
        ),
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.yellow("\n👋 Reset cancelled.\n"));
      return;
    }

    let totalDeleted = 0;
    for (const option of RESET_OPTIONS) {
      const deleted = deletePaths(option.paths);
      if (deleted > 0) {
        console.log(chalk.gray(`  ✓ ${option.name}`));
        totalDeleted += deleted;
      }
    }

    if (totalDeleted === 0) {
      console.log(chalk.yellow("\nNothing to reset — already clean.\n"));
    } else {
      console.log(
        chalk.green(`\n✅ Reset complete! Deleted ${totalDeleted} items.`),
      );
      console.log(chalk.gray("   Restart the daemon: nova daemon restart\n"));
    }
    return;
  }

  // Interactive selection
  console.log(chalk.cyan.bold("\n🔄 Nova Reset\n"));
  console.log("Select what you want to reset:\n");

  const existing = RESET_OPTIONS.filter((opt) =>
    opt.paths.some((p) => existsSync(p)),
  );

  if (existing.length === 0) {
    console.log(chalk.yellow("Nothing to reset — all clean! 🧹\n"));
    return;
  }

  const { selected } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "selected",
      message: "Choose items to reset:",
      choices: existing.map((opt) => ({
        name: `${opt.name} — ${chalk.gray(opt.description)}`,
        value: opt.value,
        checked: false,
      })),
    },
  ]);

  if (selected.length === 0) {
    console.log(chalk.yellow("\n👋 Nothing selected. Reset cancelled.\n"));
    return;
  }

  const selectedOptions = RESET_OPTIONS.filter((opt) =>
    selected.includes(opt.value),
  );

  // Telegram, Brave, Google creds live inside .env — auto-include config reset
  const configDependent = ["telegram", "brave", "google"];
  const needsConfig = selected.some((v: string) => configDependent.includes(v));
  const hasConfig = selected.includes("onboarding");
  if (needsConfig && !hasConfig) {
    const onboarding = RESET_OPTIONS.find((o) => o.value === "onboarding");
    if (onboarding) {
      selectedOptions.push(onboarding);
      console.log(
        chalk.yellow(
          "\n⚠️  Telegram/Brave/Google creds are in .env — including config reset.",
        ),
      );
    }
  }

  console.log(chalk.yellow("\nYou're about to reset:"));
  for (const opt of selectedOptions) {
    console.log(chalk.gray(`  • ${opt.name}`));
  }

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: "Proceed?",
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.yellow("\n👋 Reset cancelled.\n"));
    return;
  }

  let totalDeleted = 0;
  for (const opt of selectedOptions) {
    const deleted = deletePaths(opt.paths);
    if (deleted > 0) {
      console.log(chalk.green(`  ✓ ${opt.name}`));
      totalDeleted += deleted;
    }
  }

  console.log(
    chalk.green(`\n✅ Reset complete! Cleaned ${totalDeleted} items.`),
  );
  console.log(chalk.gray("   Restart the daemon: nova daemon restart\n"));
}

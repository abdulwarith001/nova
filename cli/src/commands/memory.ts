import chalk from "chalk";
import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";
import { MarkdownMemory } from "../../../runtime/src/markdown-memory/index.js";

const NOVA_DIR = join(homedir(), ".nova");
const MEMORY_DIR = join(NOVA_DIR, "memory");

/**
 * nova memory [action] [args...]
 *
 * Actions:
 *   status   — Show memory system overview
 *   user     — Show user profile (USER.md)
 *   agent    — Show agent identity (IDENTITY.md)
 *   rules    — Show core rules (RULES.md)
 *   list     — List conversations
 *   export   — Export profiles as JSON
 */
export async function memoryCommand(
  action?: string,
  argsInput?: string | string[],
): Promise<void> {
  const args = normalizeArgs(argsInput);
  const memory = MarkdownMemory.create(MEMORY_DIR);

  try {
    switch (action) {
      case "status":
        showStatus();
        break;
      case "user":
        showUserProfile(memory);
        break;
      case "agent":
        showAgentIdentity(memory);
        break;
      case "rules":
        showRules(memory);
        break;
      case "list":
        showList(args[0] || "conversations");
        break;
      case "export":
        exportMemory(memory);
        break;
      default:
        showHelp();
        break;
    }
  } finally {
    memory.close();
  }
}

function showStatus(): void {
  console.log(chalk.cyan("\n📊 Nova Memory Status\n"));

  const convDir = join(MEMORY_DIR, "conversations");
  const convCount = existsSync(convDir)
    ? readdirSync(convDir).filter((f) => f.endsWith(".md")).length
    : 0;

  const hasUser = existsSync(join(MEMORY_DIR, "USER.md"));
  const hasIdentity = existsSync(join(MEMORY_DIR, "IDENTITY.md"));
  const hasRules = existsSync(join(MEMORY_DIR, "RULES.md"));

  console.log(`  Conversations:  ${chalk.white(convCount)}`);
  console.log(
    `  USER.md:        ${hasUser ? chalk.green("✓") : chalk.red("✗")}`,
  );
  console.log(
    `  IDENTITY.md:    ${hasIdentity ? chalk.green("✓") : chalk.red("✗")}`,
  );
  console.log(
    `  RULES.md:       ${hasRules ? chalk.green("✓") : chalk.red("✗")}`,
  );
  console.log(`  Storage:        ${chalk.dim(MEMORY_DIR)}`);
  console.log();
}

function showUserProfile(memory: MarkdownMemory): void {
  const profileStore = memory.getProfileStore();
  const userContent = profileStore.getUser();

  console.log(chalk.cyan("\n👤 User Profile (USER.md):\n"));
  console.log(userContent);
}

function showAgentIdentity(memory: MarkdownMemory): void {
  const profileStore = memory.getProfileStore();
  const identityContent = profileStore.getIdentity();

  console.log(chalk.cyan("\n🤖 Agent Identity (IDENTITY.md):\n"));
  console.log(identityContent);
}

function showRules(memory: MarkdownMemory): void {
  const profileStore = memory.getProfileStore();
  const rulesContent = profileStore.getRules();

  console.log(chalk.cyan("\n📋 Core Rules (RULES.md):\n"));
  console.log(rulesContent);
}

function showList(entity: string): void {
  switch (entity) {
    case "conversations":
    case "convs": {
      const convDir = join(MEMORY_DIR, "conversations");
      if (!existsSync(convDir)) {
        console.log(chalk.yellow("No conversations yet."));
        return;
      }
      const files = readdirSync(convDir)
        .filter((f) => f.endsWith(".md"))
        .slice(0, 20);

      console.log(chalk.cyan(`\n💬 Recent Conversations (${files.length}):\n`));
      for (const file of files) {
        const id = basename(file, ".md");
        console.log(`  ${chalk.dim("•")} ${id}`);
      }
      console.log();
      break;
    }
    default:
      console.log(chalk.yellow(`Unknown entity: ${entity}`));
      console.log("Available: conversations");
  }
}

function exportMemory(memory: MarkdownMemory): void {
  const profileStore = memory.getProfileStore();

  const data = {
    exportedAt: new Date().toISOString(),
    userProfile: profileStore.getUser(),
    agentIdentity: profileStore.getIdentity(),
    coreRules: profileStore.getRules(),
  };

  console.log(JSON.stringify(data, null, 2));
}

function showHelp(): void {
  console.log(chalk.cyan("Nova Memory — Manage agent memory\n"));
  console.log("Usage: nova memory <action> [args]\n");
  console.log("Actions:");
  console.log("  status                   — Memory system overview");
  console.log("  user                     — Show user profile (USER.md)");
  console.log("  agent                    — Show agent identity (IDENTITY.md)");
  console.log("  rules                    — Show core rules (RULES.md)");
  console.log("  list conversations       — List recent conversations");
  console.log("  export                   — Export profiles as JSON");
}

function normalizeArgs(input?: string | string[]): string[] {
  if (!input) return [];
  if (typeof input === "string") return input.split(/\s+/).filter(Boolean);
  return input.flat().filter(Boolean);
}

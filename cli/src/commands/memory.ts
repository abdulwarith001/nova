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
 *   list     — List conversations, knowledge, or relationships
 *   search   — Search knowledge items
 *   export   — Export all memory as JSON
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
        showStatus(memory);
        break;
      case "user":
        showUserProfile(memory);
        break;
      case "agent":
        showAgentIdentity(memory);
        break;
      case "list":
        showList(memory, args[0] || "conversations");
        break;
      case "search":
        searchMemory(memory, args.join(" "));
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

function showStatus(memory: MarkdownMemory): void {
  console.log(chalk.cyan("\n📊 Nova Memory Status\n"));

  const convDir = join(MEMORY_DIR, "conversations");
  const convCount = existsSync(convDir)
    ? readdirSync(convDir).filter((f) => f.endsWith(".md")).length
    : 0;

  const store = memory.getKnowledgeJsonStore();
  const knowledgeCount = store.count();
  const agentTraits = store.getAgentTraits();
  const userContext = store.getUserContext();
  const pendingJobs = memory.getLearningEngine().listPendingJobs();

  console.log(`  Conversations:      ${chalk.white(convCount)}`);
  console.log(`  Knowledge entries:  ${chalk.white(knowledgeCount)}`);
  console.log(`  User context items: ${chalk.white(userContext.length)}`);
  console.log(`  Agent traits:       ${chalk.white(agentTraits.length)}`);
  console.log(`  Pending jobs:       ${chalk.white(pendingJobs.length)}`);
  console.log(`  Storage:            ${chalk.dim(MEMORY_DIR)}`);
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

function showList(memory: MarkdownMemory, entity: string): void {
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
    case "knowledge":
    case "memories": {
      const store = memory.getKnowledgeJsonStore();
      const items = store.getAllActive().slice(0, 20);
      if (items.length === 0) {
        console.log(chalk.yellow("No knowledge items yet."));
        return;
      }
      console.log(chalk.cyan(`\n🧠 Knowledge Items (${items.length}):\n`));
      for (const item of items) {
        const imp = (item.importance * 100).toFixed(0);
        console.log(
          `  ${chalk.dim("•")} [${item.category}] ${item.content.slice(0, 100)} ${chalk.dim(`(${imp}%)`)}`,
        );
      }
      console.log();
      break;
    }
    case "relationships":
    case "rels": {
      const store = memory.getKnowledgeJsonStore();
      const rels = store
        .search("", { category: "relationship" })
        .map((r) => r.entry);
      if (rels.length === 0) {
        console.log(chalk.yellow("No relationships yet."));
        return;
      }
      console.log(chalk.cyan(`\n🔗 Relationships (${rels.length}):\n`));
      for (const rel of rels) {
        console.log(
          `  ${chalk.white(rel.subject)} ${chalk.dim("→")} ${rel.content.slice(0, 80)}`,
        );
      }
      console.log();
      break;
    }
    default:
      console.log(chalk.yellow(`Unknown entity: ${entity}`));
      console.log("Available: conversations, knowledge, relationships");
  }
}

function searchMemory(memory: MarkdownMemory, query: string): void {
  if (!query.trim()) {
    console.log(
      chalk.yellow("Provide a search query: nova memory search <query>"),
    );
    return;
  }

  const store = memory.getKnowledgeJsonStore();
  const results = store.search(query, { limit: 10 });

  if (results.length === 0) {
    console.log(chalk.yellow(`No results for "${query}"`));
    return;
  }

  console.log(
    chalk.cyan(`\n🔍 Search Results for "${query}" (${results.length}):\n`),
  );
  for (const result of results) {
    const score = (result.score * 100).toFixed(0);
    console.log(
      `  ${chalk.dim("•")} [${result.entry.category}] ${result.entry.content.slice(0, 120)} ${chalk.dim(`(${score}%)`)}`,
    );
  }
  console.log();
}

function exportMemory(memory: MarkdownMemory): void {
  const store = memory.getKnowledgeJsonStore();
  const profileStore = memory.getProfileStore();

  const data = {
    exportedAt: new Date().toISOString(),
    userProfile: profileStore.getUser(),
    agentIdentity: profileStore.getIdentity(),
    knowledgeEntries: store.getAllActive(),
    agentTraits: store.getAgentTraits(),
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
  console.log(
    "  list <entity>            — List conversations|knowledge|relationships",
  );
  console.log("  search <query>           — Search knowledge items");
  console.log("  export                   — Export all memory as JSON");
}

function normalizeArgs(input?: string | string[]): string[] {
  if (!input) return [];
  if (typeof input === "string") return input.split(/\s+/).filter(Boolean);
  return input.flat().filter(Boolean);
}

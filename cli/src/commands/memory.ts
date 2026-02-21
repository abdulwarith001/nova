import chalk from "chalk";
import { existsSync, readFileSync, readdirSync } from "fs";
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
 *   user     — Show user traits
 *   agent    — Show agent identity traits
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
        showUserTraits(memory);
        break;
      case "agent":
        showAgentTraits(memory);
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

  const traits = memory.getKnowledgeStore().getUserTraits();
  const items = memory.getKnowledgeStore().getTopMemoryItems("owner", 100);
  const relationships = memory.getKnowledgeStore().getRelationships("owner");
  const agentTraits = memory.getKnowledgeStore().getAgentTraits();
  const pendingJobs = memory.getLearningEngine().listPendingJobs();

  console.log(`  Conversations:    ${chalk.white(convCount)}`);
  console.log(`  User traits:      ${chalk.white(traits.length)}`);
  console.log(`  Knowledge items:  ${chalk.white(items.length)}`);
  console.log(`  Relationships:    ${chalk.white(relationships.length)}`);
  console.log(`  Agent traits:     ${chalk.white(agentTraits.length)}`);
  console.log(`  Pending jobs:     ${chalk.white(pendingJobs.length)}`);
  console.log(`  Storage:          ${chalk.dim(MEMORY_DIR)}`);
  console.log();
}

function showUserTraits(memory: MarkdownMemory): void {
  const traits = memory.getKnowledgeStore().getUserTraits();

  if (traits.length === 0) {
    console.log(chalk.yellow("No user traits stored yet."));
    return;
  }

  console.log(chalk.cyan(`\n👤 User Traits (${traits.length}):\n`));
  for (const trait of traits) {
    console.log(`  ${chalk.white(trait.key)}: ${trait.value}`);
  }
  console.log();
}

function showAgentTraits(memory: MarkdownMemory): void {
  const traits = memory.getKnowledgeStore().getAgentTraits();

  if (traits.length === 0) {
    console.log(chalk.yellow("No agent traits stored yet."));
    return;
  }

  console.log(chalk.cyan(`\n🤖 Agent Traits (${traits.length}):\n`));
  for (const trait of traits) {
    console.log(`  ${chalk.white(trait.key)}: ${trait.value}`);
  }
  console.log();
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
      const items = memory.getKnowledgeStore().getTopMemoryItems("owner", 20);
      if (items.length === 0) {
        console.log(chalk.yellow("No knowledge items yet."));
        return;
      }
      console.log(chalk.cyan(`\n🧠 Knowledge Items (${items.length}):\n`));
      for (const item of items) {
        const imp = (item.importance * 100).toFixed(0);
        console.log(
          `  ${chalk.dim("•")} [${item.type}] ${item.content.slice(0, 100)} ${chalk.dim(`(${imp}%)`)}`,
        );
      }
      console.log();
      break;
    }
    case "relationships":
    case "rels": {
      const rels = memory.getKnowledgeStore().getRelationships("owner");
      if (rels.length === 0) {
        console.log(chalk.yellow("No relationships yet."));
        return;
      }
      console.log(chalk.cyan(`\n🔗 Relationships (${rels.length}):\n`));
      for (const rel of rels) {
        console.log(
          `  ${chalk.white(rel.subject)} ${chalk.dim("→")} ${rel.relation} ${chalk.dim("→")} ${chalk.white(rel.object)}`,
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

  const items = memory.getKnowledgeStore().getTopMemoryItems("owner", 50);
  const queryLower = query.toLowerCase();
  const matches = items.filter((item) =>
    item.content.toLowerCase().includes(queryLower),
  );

  if (matches.length === 0) {
    console.log(chalk.yellow(`No results for "${query}"`));
    return;
  }

  console.log(
    chalk.cyan(`\n🔍 Search Results for "${query}" (${matches.length}):\n`),
  );
  for (const item of matches.slice(0, 10)) {
    console.log(
      `  ${chalk.dim("•")} [${item.type}] ${item.content.slice(0, 120)}`,
    );
  }
  console.log();
}

function exportMemory(memory: MarkdownMemory): void {
  const data = {
    exportedAt: new Date().toISOString(),
    userTraits: memory.getKnowledgeStore().getUserTraits(),
    agentTraits: memory.getKnowledgeStore().getAgentTraits(),
    knowledgeItems: memory.getKnowledgeStore().getTopMemoryItems("owner", 1000),
    relationships: memory.getKnowledgeStore().getRelationships("owner"),
  };

  console.log(JSON.stringify(data, null, 2));
}

function showHelp(): void {
  console.log(chalk.cyan("Nova Memory — Manage agent memory\n"));
  console.log("Usage: nova memory <action> [args]\n");
  console.log("Actions:");
  console.log("  status                   — Memory system overview");
  console.log("  user                     — Show user traits");
  console.log("  agent                    — Show agent identity traits");
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

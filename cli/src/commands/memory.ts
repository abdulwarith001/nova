import chalk from "chalk";
import Database from "better-sqlite3";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DB_PATH = join(homedir(), ".nova", "memory.db");

export async function memoryCommand(action: string, query?: string) {
  if (!existsSync(DB_PATH)) {
    console.log(chalk.red("\n❌ Memory database not found\n"));
    console.log(
      chalk.gray(
        `Expected location: ${DB_PATH}\nRun some chat commands first to build up memory.\n`,
      ),
    );
    return;
  }

  const db = new Database(DB_PATH, { readonly: true });

  try {
    switch (action) {
      case "stats":
        showStats(db);
        break;
      case "chat":
      case "conversations":
        showConversations(db, query ? parseInt(query) : 10);
        break;
      case "tools":
        showTools(db, query ? parseInt(query) : 10);
        break;
      case "user":
        showUserProfile(db);
        break;
      case "agent":
        showAgentProfile(db);
        break;
      case "search":
        if (!query) {
          console.log(chalk.red("\n❌ Search query required\n"));
          console.log(chalk.gray("Usage: nova memory search <query>\n"));
          return;
        }
        searchMemories(db, query);
        break;
      case "clear":
        clearMemories(db);
        break;
      default:
        showHelp();
    }
  } finally {
    db.close();
  }
}

function showStats(db: Database.Database) {
  console.log(chalk.cyan.bold("\n📊 Memory Statistics\n"));

  const byCategory = db
    .prepare(
      "SELECT category, COUNT(*) as count FROM memories GROUP BY category",
    )
    .all() as Array<{ category: string; count: number }>;

  if (byCategory.length === 0) {
    console.log(chalk.gray("No memories stored yet.\n"));
    return;
  }

  for (const row of byCategory) {
    const emoji =
      row.category === "conversation"
        ? "💬"
        : row.category === "self"
          ? "🤖"
          : row.category === "user"
            ? "👤"
            : row.category === "task"
              ? "✅"
              : "📝";
    console.log(`${emoji} ${chalk.bold(row.category)}: ${row.count}`);
  }

  const total = db.prepare("SELECT COUNT(*) as count FROM memories").get() as {
    count: number;
  };
  console.log(chalk.gray(`\nTotal: ${total.count} memories\n`));
}

function showConversations(db: Database.Database, limit: number) {
  console.log(chalk.cyan.bold(`\n💬 Recent Conversations (${limit})\n`));

  const conversations = db
    .prepare(
      `SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') as time, 
              content, 
              metadata
       FROM memories 
       WHERE category='conversation' 
       ORDER BY timestamp DESC 
       LIMIT ?`,
    )
    .all(limit) as Array<{ time: string; content: string; metadata: string }>;

  if (conversations.length === 0) {
    console.log(chalk.gray("No conversations yet.\n"));
    return;
  }

  for (const conv of conversations) {
    const meta = JSON.parse(conv.metadata);
    const isUser = meta.role === "user";
    const icon = isUser ? "👤" : "🤖";
    const color = isUser ? chalk.blue : chalk.green;

    console.log(chalk.gray(conv.time));
    console.log(
      color(`${icon} ${isUser ? "You" : "Nova"}: `) +
        conv.content.substring(0, 100) +
        (conv.content.length > 100 ? "..." : ""),
    );
    console.log();
  }
}

function showTools(db: Database.Database, limit: number) {
  console.log(chalk.cyan.bold(`\n🔧 Recent Tool Usage (${limit})\n`));

  const tools = db
    .prepare(
      `SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') as time, 
              content,
              metadata
       FROM memories 
       WHERE category='self' AND tags LIKE '%tool-usage%'
       ORDER BY timestamp DESC 
       LIMIT ?`,
    )
    .all(limit) as Array<{ time: string; content: string; metadata: string }>;

  if (tools.length === 0) {
    console.log(chalk.gray("No tool usage recorded yet.\n"));
    return;
  }

  for (const tool of tools) {
    const meta = JSON.parse(tool.metadata);
    console.log(chalk.gray(tool.time));
    console.log(`🔧 ${chalk.bold(meta.tool)}`);
    console.log(chalk.gray(`   ${tool.content}`));
    console.log();
  }
}

function showUserProfile(db: Database.Database) {
  console.log(chalk.cyan.bold("\n👤 User Profile\n"));

  const profile = db
    .prepare("SELECT key, value FROM user_profile")
    .all() as Array<{ key: string; value: string }>;

  if (profile.length === 0) {
    console.log(chalk.gray("No user profile set yet.\n"));
  } else {
    for (const row of profile) {
      console.log(`${chalk.bold(row.key)}: ${row.value}`);
    }
    console.log();
  }

  console.log(chalk.cyan("Recent user-related memories:"));
  const userMemories = db
    .prepare(
      "SELECT content FROM memories WHERE category='user' ORDER BY timestamp DESC LIMIT 5",
    )
    .all() as Array<{ content: string }>;

  if (userMemories.length === 0) {
    console.log(chalk.gray("  None yet\n"));
  } else {
    for (const mem of userMemories) {
      console.log(chalk.gray(`  • ${mem.content}`));
    }
    console.log();
  }
}

function showAgentProfile(db: Database.Database) {
  console.log(chalk.cyan.bold("\n🤖 Agent Profile\n"));

  const profile = db
    .prepare("SELECT key, value FROM agent_profile")
    .all() as Array<{ key: string; value: string }>;

  if (profile.length === 0) {
    console.log(chalk.gray("No agent profile set yet.\n"));
  } else {
    for (const row of profile) {
      const value = JSON.parse(row.value);
      if (Array.isArray(value)) {
        console.log(chalk.bold(`${row.key}:`));
        for (const item of value) {
          console.log(chalk.gray(`  • ${item}`));
        }
      } else {
        console.log(`${chalk.bold(row.key)}: ${value}`);
      }
    }
    console.log();
  }
}

function searchMemories(db: Database.Database, query: string) {
  console.log(chalk.cyan.bold(`\n🔍 Searching for: "${query}"\n`));

  const results = db
    .prepare(
      `SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
              category,
              content
       FROM memories 
       WHERE content LIKE ? 
       ORDER BY timestamp DESC 
       LIMIT 20`,
    )
    .all(`%${query}%`) as Array<{
    time: string;
    category: string;
    content: string;
  }>;

  if (results.length === 0) {
    console.log(chalk.gray("No results found.\n"));
    return;
  }

  console.log(chalk.gray(`Found ${results.length} results:\n`));

  for (const result of results) {
    const emoji =
      result.category === "conversation"
        ? "💬"
        : result.category === "self"
          ? "🤖"
          : result.category === "user"
            ? "👤"
            : "📝";
    console.log(chalk.gray(result.time) + ` ${emoji} ${result.category}`);
    console.log(`  ${result.content.substring(0, 120)}...`);
    console.log();
  }
}

function clearMemories(db: Database.Database) {
  console.log(
    chalk.yellow("\n⚠️  This will delete ALL memories from the database.\n"),
  );
  console.log(
    chalk.gray("Note: This operation cannot be undone. Use with caution.\n"),
  );
  console.log(
    chalk.gray(
      "To clear memories, run: sqlite3 ~/.nova/memory.db 'DELETE FROM memories;'\n",
    ),
  );
}

function showHelp() {
  console.log(chalk.cyan.bold("\n🧠 Nova Memory Management\n"));
  console.log("Usage: nova memory <action> [options]\n");
  console.log("Actions:");
  console.log(
    "  " + chalk.bold("stats") + "              Show memory statistics",
  );
  console.log(
    "  " +
      chalk.bold("chat [N]") +
      "          Show last N conversations (default: 10)",
  );
  console.log(
    "  " +
      chalk.bold("tools [N]") +
      "         Show last N tool usages (default: 10)",
  );
  console.log("  " + chalk.bold("user") + "              Show user profile");
  console.log("  " + chalk.bold("agent") + "             Show agent profile");
  console.log(
    "  " + chalk.bold("search <query>") + "    Search memories for query",
  );
  console.log(
    "  " +
      chalk.bold("clear") +
      "             Instructions to clear all memories\n",
  );

  console.log("Examples:");
  console.log(chalk.gray("  nova memory stats"));
  console.log(chalk.gray("  nova memory chat 20"));
  console.log(chalk.gray("  nova memory search 'file operations'"));
  console.log();
}

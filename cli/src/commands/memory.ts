import chalk from "chalk";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const NOVA_DIR = join(homedir(), ".nova");
const LEGACY_DB_PATH = join(NOVA_DIR, "memory.db");
const DEFAULT_V2_DB_PATH = join(NOVA_DIR, "memory-v2.db");
const ENV_PATH = join(NOVA_DIR, ".env");

type MemoryDbMode = "v2" | "v1";
type ForgetScope = "all" | "traits" | "relationships" | "memories";

export async function memoryCommand(
  action?: string,
  argsInput?: string | string[],
): Promise<void> {
  const args = normalizeArgs(argsInput);
  const normalizedAction = String(action || "help")
    .trim()
    .toLowerCase();

  const resolvedDb = resolveMemoryDatabase();
  if (!resolvedDb) {
    console.log(chalk.red("\n❌ Memory database not found\n"));
    console.log(
      chalk.gray(
        `Checked:\n- ${resolveMemoryV2Path()}\n- ${LEGACY_DB_PATH}\n\nRun chat first to build memory.\n`,
      ),
    );
    return;
  }

  const writeActions = new Set(["delete", "forget", "clear"]);
  const db = new Database(resolvedDb.path, {
    readonly: !writeActions.has(normalizedAction),
  });

  try {
    if (resolvedDb.mode === "v2") {
      await handleV2MemoryCommand(db, normalizedAction, args);
      return;
    }
    handleLegacyMemoryCommand(db, normalizedAction, args);
  } finally {
    db.close();
  }
}

async function handleV2MemoryCommand(
  db: Database.Database,
  action: string,
  args: string[],
): Promise<void> {
  const defaultUserId = getDefaultUserId();

  switch (action) {
    case "status":
    case "stats": {
      const userId = args[0] || defaultUserId;
      showV2Status(db, userId);
      return;
    }
    case "user":
    case "me": {
      const parsed = parseUserAndLimit(args, defaultUserId, 12);
      showV2UserMemory(db, parsed.userId, parsed.limit);
      return;
    }
    case "agent": {
      const limit = parseLimit(args[0], 12);
      showV2AgentMemory(db, limit, defaultUserId);
      return;
    }
    case "list": {
      const entity = String(args[0] || "").toLowerCase();
      if (!entity) {
        console.log(chalk.red("\n❌ Missing list target\n"));
        console.log(
          chalk.gray(
            "Usage: nova memory list <memories|traits|relationships|messages|jobs|proactive|approvals|audit|conversations> [limit]\n",
          ),
        );
        return;
      }
      const parsed = parseUserAndLimit(args.slice(1), defaultUserId, 20);
      showV2List(db, entity, parsed.userId, parsed.limit);
      return;
    }
    case "search": {
      const query = args.join(" ").trim();
      if (!query) {
        console.log(chalk.red("\n❌ Search query required\n"));
        console.log(chalk.gray("Usage: nova memory search <query>\n"));
        return;
      }
      searchV2Memory(db, defaultUserId, query);
      return;
    }
    case "delete": {
      runV2DeleteCommand(db, defaultUserId, args);
      return;
    }
    case "forget":
    case "clear": {
      runV2ForgetCommand(db, defaultUserId, args, action);
      return;
    }
    case "export": {
      runV2ExportCommand(db, defaultUserId, args);
      return;
    }
    case "help":
    default:
      showV2Help();
  }
}

function showV2Status(db: Database.Database, userId: string): void {
  console.log(chalk.cyan.bold("\n🧠 Memory V2 Status\n"));
  console.log(`User: ${chalk.bold(userId)}`);

  const count = (sql: string, params: unknown[] = []): number => {
    const row = db.prepare(sql).get(...params) as { count?: number } | undefined;
    return Number(row?.count || 0);
  };

  const messages = count(`SELECT COUNT(*) as count FROM messages WHERE user_id = ?`, [
    userId,
  ]);
  const conversations = count(
    `SELECT COUNT(*) as count FROM conversations WHERE user_id = ?`,
    [userId],
  );
  const memories = count(
    `SELECT COUNT(*) as count FROM memory_items WHERE user_id = ? AND status = 'active'`,
    [userId],
  );
  const traits = count(
    `SELECT COUNT(*) as count FROM user_traits WHERE user_id = ? AND status = 'active'`,
    [userId],
  );
  const relationships = count(
    `SELECT COUNT(*) as count FROM relationships WHERE user_id = ? AND status = 'active'`,
    [userId],
  );
  const learningPending = count(
    `SELECT COUNT(*) as count FROM learning_jobs WHERE user_id = ? AND status IN ('pending', 'failed', 'processing')`,
    [userId],
  );
  const proactivePending = count(
    `SELECT COUNT(*) as count FROM proactive_events WHERE user_id = ? AND status = 'pending'`,
    [userId],
  );
  const proactiveSent = count(
    `SELECT COUNT(*) as count FROM proactive_events WHERE user_id = ? AND status = 'sent'`,
    [userId],
  );
  const approvalsPending = count(
    `SELECT COUNT(*) as count FROM approval_requests WHERE user_id = ? AND status IN ('pending', 'approved')`,
    [userId],
  );
  const auditRows = count(
    `SELECT COUNT(*) as count FROM memory_audit_log WHERE user_id = ?`,
    [userId],
  );
  const agentTraits = count(
    `SELECT COUNT(*) as count FROM agent_traits WHERE status = 'active'`,
  );

  const activity = db
    .prepare(
      `SELECT last_user_activity_at, last_agent_activity_at
       FROM users
       WHERE id = ?`,
    )
    .get(userId) as
    | { last_user_activity_at?: number; last_agent_activity_at?: number }
    | undefined;

  console.log(`💬 messages: ${messages}`);
  console.log(`🧵 conversations: ${conversations}`);
  console.log(`📝 memory items: ${memories}`);
  console.log(`👤 user traits: ${traits}`);
  console.log(`🫂 relationships: ${relationships}`);
  console.log(`🤖 agent traits: ${agentTraits}`);
  console.log(`🧠 learning jobs pending: ${learningPending}`);
  console.log(`📣 proactive pending: ${proactivePending}`);
  console.log(`✅ proactive sent: ${proactiveSent}`);
  console.log(`🔐 approvals pending: ${approvalsPending}`);
  console.log(`📜 audit rows: ${auditRows}`);
  console.log(
    `\nLast user activity: ${formatTimestamp(activity?.last_user_activity_at)}`,
  );
  console.log(
    `Last agent activity: ${formatTimestamp(activity?.last_agent_activity_at)}\n`,
  );
}

function showV2UserMemory(
  db: Database.Database,
  userId: string,
  limit: number,
): void {
  console.log(chalk.cyan.bold("\n👤 User Memory\n"));
  console.log(`User: ${chalk.bold(userId)}\n`);

  const traits = db
    .prepare(
      `SELECT id, trait_key, trait_value, confidence, contradiction_group, created_at
       FROM user_traits
       WHERE user_id = ? AND status = 'active'
       ORDER BY confidence DESC, created_at DESC
       LIMIT ?`,
    )
    .all(userId, limit) as Array<{
    id: string;
    trait_key: string;
    trait_value: string;
    confidence: number;
    contradiction_group?: string;
    created_at: number;
  }>;

  const relationships = db
    .prepare(
      `SELECT id, subject, relation, object, confidence, created_at
       FROM relationships
       WHERE user_id = ? AND status = 'active'
       ORDER BY confidence DESC, created_at DESC
       LIMIT ?`,
    )
    .all(userId, limit) as Array<{
    id: string;
    subject: string;
    relation: string;
    object: string;
    confidence: number;
    created_at: number;
  }>;

  const memories = db
    .prepare(
      `SELECT id, type, content, importance, confidence, created_at
       FROM memory_items
       WHERE user_id = ? AND status = 'active'
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
    )
    .all(userId, limit) as Array<{
    id: string;
    type: string;
    content: string;
    importance: number;
    confidence: number;
    created_at: number;
  }>;

  console.log(chalk.bold("Traits"));
  if (traits.length === 0) {
    console.log(chalk.gray("  none"));
  } else {
    for (const row of traits) {
      const contradictionSuffix = row.contradiction_group
        ? ` | contradictionGroup=${row.contradiction_group}`
        : "";
      console.log(
        `  - ${row.id} | ${row.trait_key}=${row.trait_value} | conf ${toPct(row.confidence)}${contradictionSuffix}`,
      );
    }
  }

  console.log(chalk.bold("\nRelationships"));
  if (relationships.length === 0) {
    console.log(chalk.gray("  none"));
  } else {
    for (const row of relationships) {
      console.log(
        `  - ${row.id} | ${row.subject} ${row.relation} ${row.object} | conf ${toPct(row.confidence)}`,
      );
    }
  }

  console.log(chalk.bold("\nTop Memory Items"));
  if (memories.length === 0) {
    console.log(chalk.gray("  none"));
  } else {
    for (const row of memories) {
      console.log(
        `  - ${row.id} | [${row.type}] ${truncate(row.content, 120)} | imp ${toPct(row.importance)} conf ${toPct(row.confidence)}`,
      );
    }
  }
  console.log();
}

function showV2AgentMemory(
  db: Database.Database,
  limit: number,
  userId: string,
): void {
  console.log(chalk.cyan.bold("\n🤖 Agent Memory\n"));

  const traits = db
    .prepare(
      `SELECT id, trait_key, trait_value, confidence, created_at
       FROM agent_traits
       WHERE status = 'active'
       ORDER BY confidence DESC, created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    trait_key: string;
    trait_value: string;
    confidence: number;
    created_at: number;
  }>;

  const selfMemory = db
    .prepare(
      `SELECT id, type, content, confidence, created_at
       FROM memory_items
       WHERE user_id = ?
         AND type IN ('self_reflection', 'system_audit', 'autonomous_action_result', 'autonomous_action_failure')
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(userId, limit) as Array<{
    id: string;
    type: string;
    content: string;
    confidence: number;
    created_at: number;
  }>;

  console.log(chalk.bold("Identity Traits"));
  if (traits.length === 0) {
    console.log(chalk.gray("  none"));
  } else {
    for (const row of traits) {
      console.log(
        `  - ${row.id} | ${row.trait_key}=${row.trait_value} | conf ${toPct(row.confidence)}`,
      );
    }
  }

  console.log(chalk.bold("\nRecent Self-Learning/Audit"));
  if (selfMemory.length === 0) {
    console.log(chalk.gray("  none"));
  } else {
    for (const row of selfMemory) {
      console.log(
        `  - ${row.id} | [${row.type}] ${truncate(row.content, 120)} | ${formatTimestamp(row.created_at)}`,
      );
    }
  }
  console.log();
}

function showV2List(
  db: Database.Database,
  entity: string,
  userId: string,
  limit: number,
): void {
  switch (entity) {
    case "memories":
    case "memory":
      showV2Rows(
        "Memory Items",
        db
          .prepare(
            `SELECT id, type, content, importance, confidence, created_at
             FROM memory_items
             WHERE user_id = ? AND status = 'active'
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(userId, limit),
      );
      return;
    case "traits":
      showV2Rows(
        "User Traits",
        db
          .prepare(
            `SELECT id, trait_key, trait_value, confidence, created_at
             FROM user_traits
             WHERE user_id = ? AND status = 'active'
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(userId, limit),
      );
      return;
    case "relationships":
      showV2Rows(
        "Relationships",
        db
          .prepare(
            `SELECT id, subject, relation, object, confidence, created_at
             FROM relationships
             WHERE user_id = ? AND status = 'active'
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(userId, limit),
      );
      return;
    case "messages":
      showV2Rows(
        "Messages",
        db
          .prepare(
            `SELECT id, conversation_id, role, channel, content, created_at
             FROM messages
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(userId, limit),
      );
      return;
    case "conversations":
      showV2Rows(
        "Conversations",
        db
          .prepare(
            `SELECT id, channel, status, created_at, updated_at
             FROM conversations
             WHERE user_id = ?
             ORDER BY updated_at DESC
             LIMIT ?`,
          )
          .all(userId, limit),
      );
      return;
    case "jobs":
    case "learning-jobs":
      showV2Rows(
        "Learning Jobs",
        db
          .prepare(
            `SELECT id, type, status, attempts, max_attempts, run_after, created_at
             FROM learning_jobs
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(userId, limit),
      );
      return;
    case "proactive":
    case "proactive-events":
      showV2Rows(
        "Proactive Events",
        db
          .prepare(
            `SELECT id, channel, event_type, status, reason, created_at, sent_at
             FROM proactive_events
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(userId, limit),
      );
      return;
    case "approvals":
    case "approval-requests":
      showV2Rows(
        "Approval Requests",
        db
          .prepare(
            `SELECT id, action_type, status, reason, expires_at, created_at
             FROM approval_requests
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(userId, limit),
      );
      return;
    case "audit":
    case "audit-log":
      showV2Rows(
        "Memory Audit Log",
        db
          .prepare(
            `SELECT id, action, scope, detail, created_at
             FROM memory_audit_log
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(userId, limit),
      );
      return;
    default:
      console.log(chalk.red(`\n❌ Unknown list target '${entity}'\n`));
      console.log(
        chalk.gray(
          "Use: memories, traits, relationships, messages, conversations, jobs, proactive, approvals, audit\n",
        ),
      );
  }
}

function showV2Rows(title: string, rows: any[]): void {
  console.log(chalk.cyan.bold(`\n${title}\n`));
  if (rows.length === 0) {
    console.log(chalk.gray("No rows found.\n"));
    return;
  }

  for (const row of rows) {
    const parts = Object.entries(row).map(([key, value]) => {
      if (typeof value === "number" && key.endsWith("_at")) {
        return `${key}=${formatTimestamp(value)}`;
      }
      if (key === "content" || key === "detail") {
        return `${key}=${truncate(String(value || ""), 120)}`;
      }
      return `${key}=${String(value)}`;
    });
    console.log(`- ${parts.join(" | ")}`);
  }
  console.log();
}

function searchV2Memory(
  db: Database.Database,
  userId: string,
  query: string,
): void {
  console.log(chalk.cyan.bold(`\n🔍 Search: "${query}"\n`));

  const like = `%${query}%`;
  const rows = db
    .prepare(
      `
      SELECT 'memory_item' AS source, id, content AS snippet, created_at
      FROM memory_items
      WHERE user_id = ? AND status = 'active' AND content LIKE ?
      UNION ALL
      SELECT 'user_trait' AS source, id, trait_key || '=' || trait_value AS snippet, created_at
      FROM user_traits
      WHERE user_id = ? AND status = 'active'
        AND (trait_key LIKE ? OR trait_value LIKE ?)
      UNION ALL
      SELECT 'relationship' AS source, id, subject || ' ' || relation || ' ' || object AS snippet, created_at
      FROM relationships
      WHERE user_id = ? AND status = 'active'
        AND (subject LIKE ? OR relation LIKE ? OR object LIKE ?)
      UNION ALL
      SELECT 'message' AS source, id, role || ': ' || content AS snippet, created_at
      FROM messages
      WHERE user_id = ? AND content LIKE ?
      UNION ALL
      SELECT 'agent_trait' AS source, id, trait_key || '=' || trait_value AS snippet, created_at
      FROM agent_traits
      WHERE status = 'active' AND (trait_key LIKE ? OR trait_value LIKE ?)
      ORDER BY created_at DESC
      LIMIT 50
      `,
    )
    .all(
      userId,
      like,
      userId,
      like,
      like,
      userId,
      like,
      like,
      like,
      userId,
      like,
      like,
      like,
    ) as Array<{
    source: string;
    id: string;
    snippet: string;
    created_at: number;
  }>;

  if (rows.length === 0) {
    console.log(chalk.gray("No matching memory rows.\n"));
    return;
  }

  for (const row of rows) {
    console.log(
      `- [${row.source}] ${row.id} | ${truncate(row.snippet, 140)} | ${formatTimestamp(row.created_at)}`,
    );
  }
  console.log();
}

function runV2DeleteCommand(
  db: Database.Database,
  userId: string,
  args: string[],
): void {
  const target = String(args[0] || "").toLowerCase();
  const value = String(args[1] || "").trim();

  if (!target) {
    console.log(chalk.red("\n❌ Missing delete target\n"));
    console.log(
      chalk.gray(
        "Usage:\n  nova memory delete memory <id>\n  nova memory delete trait <id>\n  nova memory delete relationship <id>\n  nova memory delete message <id>\n",
      ),
    );
    return;
  }

  if (
    target === "traits" ||
    target === "relationships" ||
    target === "memories" ||
    target === "all"
  ) {
    runV2ForgetCommand(db, userId, [target, String(args[1] || "")], "delete");
    return;
  }

  if (!value) {
    console.log(chalk.red(`\n❌ Missing id for '${target}' deletion\n`));
    return;
  }

  const normalizedTarget = normalizeDeleteTarget(target);
  if (!normalizedTarget) {
    console.log(chalk.red(`\n❌ Unknown delete target '${target}'\n`));
    return;
  }

  const deletedRows = deleteByIdV2(db, userId, normalizedTarget, value);
  if (deletedRows <= 0) {
    console.log(chalk.yellow(`\nNo rows deleted for ${target} id '${value}'.\n`));
    return;
  }

  console.log(
    chalk.green(
      `\nDeleted ${deletedRows} row(s) for ${normalizedTarget} id '${value}'.\n`,
    ),
  );
}

function runV2ForgetCommand(
  db: Database.Database,
  userId: string,
  args: string[],
  action: string,
): void {
  const scope = String(args[0] || "").toLowerCase() as ForgetScope;
  const confirm = String(args[1] || "").toLowerCase();

  const validScopes = new Set<ForgetScope>([
    "traits",
    "relationships",
    "memories",
    "all",
  ]);
  if (!validScopes.has(scope)) {
    console.log(chalk.red("\n❌ Invalid forget scope\n"));
    console.log(
      chalk.gray("Use: nova memory forget <traits|relationships|memories|all>\n"),
    );
    return;
  }

  if (scope === "all" && confirm !== "confirm") {
    console.log(chalk.yellow("\n⚠️ Refusing to delete all memory without confirmation.\n"));
    console.log(chalk.gray("Run: nova memory forget all confirm\n"));
    return;
  }

  const result = forgetScopeV2(db, userId, scope);
  console.log(
    chalk.green(
      `\n${action === "clear" ? "Clear" : "Forget"} completed for '${scope}'. Deleted rows: ${result.deletedRows}.\n`,
    ),
  );
}

function runV2ExportCommand(
  db: Database.Database,
  defaultUserId: string,
  args: string[],
): void {
  let userId = defaultUserId;
  let outputPath: string | undefined;

  if (args.length === 1) {
    if (looksLikePath(args[0])) {
      outputPath = args[0];
    } else {
      userId = args[0];
    }
  } else if (args.length >= 2) {
    userId = args[0];
    outputPath = args[1];
  }

  const exportData = exportV2UserData(db, userId);
  const serialized = JSON.stringify(exportData, null, 2);

  if (outputPath) {
    writeFileSync(resolvePathFromHome(outputPath), serialized, "utf-8");
    console.log(
      chalk.green(
        `\nExported memory for user '${userId}' to ${resolvePathFromHome(outputPath)}\n`,
      ),
    );
    return;
  }

  console.log(serialized);
}

function deleteByIdV2(
  db: Database.Database,
  userId: string,
  target:
    | "memory"
    | "trait"
    | "relationship"
    | "message"
    | "job"
    | "proactive"
    | "approval"
    | "audit"
    | "agent_trait",
  id: string,
): number {
  const tx = db.transaction(() => {
    if (target === "memory") {
      const evidenceDeleted = db
        .prepare(`DELETE FROM memory_evidence WHERE memory_item_id = ? AND user_id = ?`)
        .run(id, userId).changes;
      const memoryDeleted = db
        .prepare(`DELETE FROM memory_items WHERE id = ? AND user_id = ?`)
        .run(id, userId).changes;
      const total = evidenceDeleted + memoryDeleted;
      if (total > 0) {
        addAuditLog(db, {
          userId,
          action: "memory_item_delete",
          scope: "memory",
          detail: `Deleted memory item ${id}`,
          metadata: { id, evidenceDeleted, memoryDeleted },
        });
      }
      return total;
    }

    if (target === "agent_trait") {
      const deleted = db
        .prepare(`DELETE FROM agent_traits WHERE id = ?`)
        .run(id).changes;
      if (deleted > 0) {
        addAuditLog(db, {
          userId,
          action: "agent_trait_delete",
          scope: "agent_trait",
          detail: `Deleted agent trait ${id}`,
          metadata: { id },
        });
      }
      return deleted;
    }

    const table =
      target === "trait"
        ? "user_traits"
        : target === "relationship"
          ? "relationships"
          : target === "message"
            ? "messages"
            : target === "job"
              ? "learning_jobs"
              : target === "proactive"
                ? "proactive_events"
                : target === "approval"
                  ? "approval_requests"
                  : "memory_audit_log";

    const deleted = db
      .prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`)
      .run(id, userId).changes;
    if (deleted > 0) {
      addAuditLog(db, {
        userId,
        action: `${target}_delete`,
        scope: target,
        detail: `Deleted ${target} ${id}`,
        metadata: { id, table },
      });
    }
    return deleted;
  });

  return tx();
}

function forgetScopeV2(
  db: Database.Database,
  userId: string,
  scope: ForgetScope,
): { deletedRows: number } {
  const tx = db.transaction(() => {
    let deletedRows = 0;

    if (scope === "all" || scope === "traits") {
      deletedRows += db
        .prepare(`DELETE FROM user_traits WHERE user_id = ?`)
        .run(userId).changes;
    }

    if (scope === "all" || scope === "relationships") {
      deletedRows += db
        .prepare(`DELETE FROM relationships WHERE user_id = ?`)
        .run(userId).changes;
    }

    if (scope === "all" || scope === "memories") {
      deletedRows += db
        .prepare(`DELETE FROM memory_evidence WHERE user_id = ?`)
        .run(userId).changes;
      deletedRows += db
        .prepare(`DELETE FROM memory_items WHERE user_id = ?`)
        .run(userId).changes;
    }

    if (scope === "all") {
      deletedRows += db
        .prepare(`DELETE FROM messages WHERE user_id = ?`)
        .run(userId).changes;
      deletedRows += db
        .prepare(`DELETE FROM conversations WHERE user_id = ?`)
        .run(userId).changes;
      deletedRows += db
        .prepare(`DELETE FROM learning_jobs WHERE user_id = ?`)
        .run(userId).changes;
      deletedRows += db
        .prepare(`DELETE FROM proactive_events WHERE user_id = ?`)
        .run(userId).changes;
      deletedRows += db
        .prepare(`DELETE FROM approval_requests WHERE user_id = ?`)
        .run(userId).changes;
    }

    addAuditLog(db, {
      userId,
      action: "forget_scope",
      scope,
      detail: `Deleted ${deletedRows} rows`,
      metadata: { deletedRows, scope },
    });
    return { deletedRows };
  });

  return tx();
}

function exportV2UserData(db: Database.Database, userId: string): Record<string, unknown> {
  const selectAll = (table: string) =>
    db.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY created_at ASC`).all(userId);

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  const agentTraits = db
    .prepare(`SELECT * FROM agent_traits WHERE status = 'active' ORDER BY created_at ASC`)
    .all();

  return {
    user,
    conversations: selectAll("conversations"),
    messages: selectAll("messages"),
    memoryItems: selectAll("memory_items"),
    memoryEvidence: selectAll("memory_evidence"),
    userTraits: selectAll("user_traits"),
    relationships: selectAll("relationships"),
    learningJobs: selectAll("learning_jobs"),
    proactiveEvents: selectAll("proactive_events"),
    approvalRequests: selectAll("approval_requests"),
    auditLog: selectAll("memory_audit_log"),
    agentTraits,
  };
}

function addAuditLog(
  db: Database.Database,
  input: {
    userId: string;
    action: string;
    scope: string;
    detail: string;
    metadata?: Record<string, unknown>;
  },
): void {
  const now = Date.now();
  const id = `audit-${now}-${randomUUID()}`;
  db.prepare(
    `INSERT INTO memory_audit_log (
      id, user_id, action, scope, detail, created_at, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    input.action,
    input.scope,
    input.detail,
    now,
    JSON.stringify(input.metadata || {}),
  );
}

function showV2Help(): void {
  console.log(chalk.cyan.bold("\n🧠 Nova Memory CLI (V2)\n"));
  console.log("Usage: nova memory <action> [args]\n");
  console.log("Actions:");
  console.log(`  ${chalk.bold("status [userId]")}                        Show memory counters`);
  console.log(`  ${chalk.bold("user [userId] [limit]")}                  Show user traits/relationships/memories`);
  console.log(`  ${chalk.bold("agent [limit]")}                          Show agent traits and self-memory`);
  console.log(
    `  ${chalk.bold("list <entity> [userId] [limit]")}           List rows (memories|traits|relationships|messages|conversations|jobs|proactive|approvals|audit)`,
  );
  console.log(`  ${chalk.bold("search <query>")}                         Search across user+agent memory`);
  console.log(`  ${chalk.bold("delete memory <id>")}                     Delete one memory item`);
  console.log(`  ${chalk.bold("delete trait <id>")}                      Delete one user trait`);
  console.log(`  ${chalk.bold("delete relationship <id>")}               Delete one relationship`);
  console.log(`  ${chalk.bold("forget <traits|relationships|memories>")} Delete by scope`);
  console.log(`  ${chalk.bold("forget all confirm")}                     Delete all user memory`);
  console.log(`  ${chalk.bold("export [userId] [path]")}                 Export memory JSON`);
  console.log();
  console.log("Examples:");
  console.log(chalk.gray("  nova memory status"));
  console.log(chalk.gray("  nova memory user"));
  console.log(chalk.gray("  nova memory list memories owner 25"));
  console.log(chalk.gray("  nova memory search \"working late\""));
  console.log(chalk.gray("  nova memory delete memory mem-123"));
  console.log(chalk.gray("  nova memory forget all confirm"));
  console.log(chalk.gray("  nova memory export owner ~/Downloads/nova-memory.json"));
  console.log();
}

function handleLegacyMemoryCommand(
  db: Database.Database,
  action: string,
  args: string[],
): void {
  const query = args[0];
  switch (action) {
    case "stats":
      showLegacyStats(db);
      break;
    case "chat":
    case "conversations":
      showLegacyConversations(db, query ? parseInt(query, 10) : 10);
      break;
    case "tools":
      showLegacyTools(db, query ? parseInt(query, 10) : 10);
      break;
    case "user":
      showLegacyUserProfile(db);
      break;
    case "agent":
      showLegacyAgentProfile(db);
      break;
    case "search": {
      const searchQuery = args.join(" ").trim();
      if (!searchQuery) {
        console.log(chalk.red("\n❌ Search query required\n"));
        console.log(chalk.gray("Usage: nova memory search <query>\n"));
        return;
      }
      searchLegacyMemories(db, searchQuery);
      break;
    }
    case "clear":
      clearLegacyMemories();
      break;
    default:
      showLegacyHelp();
  }
}

function showLegacyStats(db: Database.Database): void {
  console.log(chalk.cyan.bold("\n📊 Legacy Memory Statistics\n"));

  const byCategory = db
    .prepare(`SELECT category, COUNT(*) as count FROM memories GROUP BY category`)
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

  const total = db.prepare(`SELECT COUNT(*) as count FROM memories`).get() as {
    count: number;
  };
  console.log(chalk.gray(`\nTotal: ${total.count} memories\n`));
}

function showLegacyConversations(db: Database.Database, limit: number): void {
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
    const meta = safeParseJson(conv.metadata);
    const isUser = meta.role === "user";
    const icon = isUser ? "👤" : "🤖";
    const color = isUser ? chalk.blue : chalk.green;
    console.log(chalk.gray(conv.time));
    console.log(
      color(`${icon} ${isUser ? "You" : "Nova"}: `) +
        truncate(conv.content, 120),
    );
    console.log();
  }
}

function showLegacyTools(db: Database.Database, limit: number): void {
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
    const meta = safeParseJson(tool.metadata);
    console.log(chalk.gray(tool.time));
    console.log(`🔧 ${chalk.bold(String(meta.tool || "unknown_tool"))}`);
    console.log(chalk.gray(`   ${truncate(tool.content, 120)}`));
    console.log();
  }
}

function showLegacyUserProfile(db: Database.Database): void {
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
}

function showLegacyAgentProfile(db: Database.Database): void {
  console.log(chalk.cyan.bold("\n🤖 Agent Profile\n"));

  const profile = db
    .prepare("SELECT key, value FROM agent_profile")
    .all() as Array<{ key: string; value: string }>;

  if (profile.length === 0) {
    console.log(chalk.gray("No agent profile set yet.\n"));
    return;
  }

  for (const row of profile) {
    const parsed = safeParseJson(row.value);
    if (Array.isArray(parsed)) {
      console.log(chalk.bold(`${row.key}:`));
      for (const item of parsed) {
        console.log(chalk.gray(`  • ${String(item)}`));
      }
      continue;
    }
    if (typeof parsed === "string") {
      console.log(`${chalk.bold(row.key)}: ${parsed}`);
      continue;
    }
    console.log(`${chalk.bold(row.key)}: ${row.value}`);
  }
  console.log();
}

function searchLegacyMemories(db: Database.Database, query: string): void {
  console.log(chalk.cyan.bold(`\n🔍 Searching Legacy Memory: "${query}"\n`));

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
    .all(`%${query}%`) as Array<{ time: string; category: string; content: string }>;

  if (results.length === 0) {
    console.log(chalk.gray("No results found.\n"));
    return;
  }

  for (const row of results) {
    console.log(`${chalk.gray(row.time)} [${row.category}]`);
    console.log(`  ${truncate(row.content, 120)}`);
    console.log();
  }
}

function clearLegacyMemories(): void {
  console.log(chalk.yellow("\n⚠️  Legacy DB clear operation is manual by design.\n"));
  console.log(
    chalk.gray("Run: sqlite3 ~/.nova/memory.db 'DELETE FROM memories;'\n"),
  );
}

function showLegacyHelp(): void {
  console.log(chalk.cyan.bold("\n🧠 Nova Memory Management (Legacy)\n"));
  console.log("Usage: nova memory <action> [options]\n");
  console.log("Actions:");
  console.log(`  ${chalk.bold("stats")}              Show memory statistics`);
  console.log(`  ${chalk.bold("chat [N]")}           Show recent conversations`);
  console.log(`  ${chalk.bold("tools [N]")}          Show recent tool usage`);
  console.log(`  ${chalk.bold("user")}               Show user profile`);
  console.log(`  ${chalk.bold("agent")}              Show agent profile`);
  console.log(`  ${chalk.bold("search <query>")}     Search memory`);
  console.log(`  ${chalk.bold("clear")}              Show clear instructions\n`);
}

function resolveMemoryDatabase():
  | {
      path: string;
      mode: MemoryDbMode;
    }
  | null {
  const candidates = [resolveMemoryV2Path(), DEFAULT_V2_DB_PATH, LEGACY_DB_PATH];
  const seen = new Set<string>();

  for (const rawPath of candidates) {
    const normalizedPath = resolvePathFromHome(rawPath);
    if (seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);
    if (!existsSync(normalizedPath)) continue;

    const mode = detectDbMode(normalizedPath);
    if (!mode) continue;
    return { path: normalizedPath, mode };
  }
  return null;
}

function detectDbMode(path: string): MemoryDbMode | null {
  const db = new Database(path, { readonly: true });
  try {
    const hasV2 = hasTable(db, "memory_items") && hasTable(db, "messages");
    if (hasV2) return "v2";
    const hasV1 = hasTable(db, "memories");
    if (hasV1) return "v1";
    return null;
  } finally {
    db.close();
  }
}

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 as found
       FROM sqlite_master
       WHERE type='table' AND name = ?
       LIMIT 1`,
    )
    .get(tableName) as { found?: number } | undefined;
  return row?.found === 1;
}

function resolveMemoryV2Path(): string {
  const envVars = loadNovaEnv();
  const configured =
    process.env.NOVA_MEMORY_V2_DB_PATH || envVars.NOVA_MEMORY_V2_DB_PATH;
  if (!configured || !configured.trim()) return DEFAULT_V2_DB_PATH;
  return resolvePathFromHome(configured.trim());
}

function getDefaultUserId(): string {
  const envVars = loadNovaEnv();
  const value = process.env.NOVA_SINGLE_OWNER_USER_ID || envVars.NOVA_SINGLE_OWNER_USER_ID;
  const userId = String(value || "owner").trim();
  return userId || "owner";
}

function loadNovaEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const content = readFileSync(ENV_PATH, "utf-8");
  const out: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function normalizeArgs(input?: string | string[]): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const single = String(input || "").trim();
  return single ? [single] : [];
}

function parseUserAndLimit(
  args: string[],
  defaultUserId: string,
  defaultLimit: number,
): { userId: string; limit: number } {
  if (args.length === 0) {
    return { userId: defaultUserId, limit: defaultLimit };
  }

  const first = String(args[0] || "").trim();
  const second = String(args[1] || "").trim();

  if (isPositiveInteger(first)) {
    return {
      userId: defaultUserId,
      limit: parseLimit(first, defaultLimit),
    };
  }

  return {
    userId: first || defaultUserId,
    limit: parseLimit(second, defaultLimit),
  };
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(200, parsed));
}

function formatTimestamp(value: unknown): string {
  const ts = Number(value || 0);
  if (!Number.isFinite(ts) || ts <= 0) return "n/a";
  return new Date(ts).toISOString();
}

function toPct(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const clamped = Math.max(0, Math.min(1, value));
  return `${Math.round(clamped * 100)}%`;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function safeParseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function resolvePathFromHome(pathValue: string): string {
  if (!pathValue) return pathValue;
  if (pathValue.startsWith("~/")) {
    return join(homedir(), pathValue.slice(2));
  }
  return pathValue;
}

function normalizeDeleteTarget(
  target: string,
):
  | "memory"
  | "trait"
  | "relationship"
  | "message"
  | "job"
  | "proactive"
  | "approval"
  | "audit"
  | "agent_trait"
  | null {
  if (target === "memory" || target === "mem") return "memory";
  if (target === "trait") return "trait";
  if (target === "relationship" || target === "relation") return "relationship";
  if (target === "message" || target === "msg") return "message";
  if (target === "job" || target === "learning-job") return "job";
  if (target === "proactive" || target === "proactive-event") return "proactive";
  if (target === "approval" || target === "approval-request") return "approval";
  if (target === "audit" || target === "audit-log") return "audit";
  if (target === "agent-trait" || target === "agent_trait") return "agent_trait";
  return null;
}

function looksLikePath(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) return false;
  return (
    text.startsWith("/") ||
    text.startsWith("~/") ||
    text.startsWith("./") ||
    text.startsWith("../") ||
    text.endsWith(".json")
  );
}

function isPositiveInteger(value: string): boolean {
  return /^[1-9]\d*$/.test(String(value || "").trim());
}

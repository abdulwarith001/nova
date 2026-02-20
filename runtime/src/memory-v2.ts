import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";

export type ChannelType = "ws" | "telegram" | "whatsapp";
export type MessageRole = "system" | "user" | "assistant";
export type MemoryJobType =
  | "post_turn_extract"
  | "post_turn_reflect"
  | "hourly_sweep"
  | "self_audit"
  | "conversation_analysis"
  | "self_discovery";

export interface StoredMessage {
  id: string;
  userId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  channel: ChannelType;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface MemoryContextPackage {
  userId: string;
  conversationId: string;
  recentMessages: StoredMessage[];
  memoryItems: Array<{
    id: string;
    type: string;
    content: string;
    importance: number;
    confidence: number;
    createdAt: number;
  }>;
  userTraits: Array<{
    id: string;
    key: string;
    value: string;
    confidence: number;
    contradictionGroup?: string;
    createdAt: number;
  }>;
  agentTraits: Array<{
    id: string;
    key: string;
    value: string;
    confidence: number;
    createdAt: number;
  }>;
  relationships: Array<{
    id: string;
    subject: string;
    relation: string;
    object: string;
    confidence: number;
    createdAt: number;
  }>;
  assembledSystemPrompt: string;
}

export interface LearningJob {
  id: string;
  userId: string;
  conversationId: string;
  type: MemoryJobType;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "completed" | "failed" | "dead_letter";
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  createdAt: number;
  updatedAt: number;
}

export interface AutonomyEvaluationResult {
  userId: string;
  checkedAt: number;
  shouldSendProactive: boolean;
  reason: string;
  draftedMessage?: string;
  createdEventIds: string[];
}

export interface ProactiveEvent {
  id: string;
  userId: string;
  channel: ChannelType;
  eventType: "check_in" | "suggestion" | "follow_up";
  message: string;
  status: "pending" | "sent" | "dropped";
  reason?: string;
  createdAt: number;
}

export interface QueueProactiveEventInput {
  userId: string;
  channel: ChannelType;
  message: string;
  eventType?: ProactiveEvent["eventType"];
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRequest {
  id: string;
  userId: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "consumed" | "expired";
  reason: string;
  token: string;
  expiresAt: number;
  createdAt: number;
  approvedAt?: number;
  rejectedAt?: number;
}

const DEFAULT_DAILY_CAP = 2;
const DEFAULT_COOLDOWN_MS = 8 * 60 * 60 * 1000;
const DEFAULT_IDLE_THRESHOLD_MS = 6 * 60 * 60 * 1000;

export class ConversationStore {
  constructor(private readonly db: Database.Database) {}

  ensureUser(userId: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO users (id, created_at, updated_at, last_user_activity_at, last_agent_activity_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, now, now, now, now, "{}");

    this.db
      .prepare(`UPDATE users SET updated_at = ? WHERE id = ?`)
      .run(now, userId);
  }

  ensureConversation(input: {
    userId: string;
    conversationId: string;
    channel: ChannelType;
    status?: "active" | "archived";
  }): void {
    this.ensureUser(input.userId);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO conversations (id, user_id, channel, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.conversationId,
        input.userId,
        input.channel,
        input.status || "active",
        now,
        now,
      );

    this.db
      .prepare(
        `UPDATE conversations SET updated_at = ?, status = ? WHERE id = ?`,
      )
      .run(now, input.status || "active", input.conversationId);
  }

  appendMessage(input: {
    userId: string;
    conversationId: string;
    role: MessageRole;
    content: string;
    channel: ChannelType;
    metadata?: Record<string, unknown>;
  }): StoredMessage {
    const now = Date.now();
    const id = `msg-${now}-${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO messages (
          id, user_id, conversation_id, role, content, channel, created_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.conversationId,
        input.role,
        input.content,
        input.channel,
        now,
        safeStringify(input.metadata || {}),
      );

    this.db
      .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
      .run(now, input.conversationId);

    if (input.role === "user") {
      this.db
        .prepare(
          `UPDATE users SET last_user_activity_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(now, now, input.userId);
    } else if (input.role === "assistant") {
      this.db
        .prepare(
          `UPDATE users SET last_agent_activity_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(now, now, input.userId);
    }

    return {
      id,
      userId: input.userId,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      channel: input.channel,
      createdAt: now,
      metadata: input.metadata || {},
    };
  }

  getRecentMessages(input: {
    userId: string;
    conversationId?: string;
    limit?: number;
  }): StoredMessage[] {
    const limit = Math.max(1, Math.min(200, input.limit || 40));

    let rows: any[];
    if (input.conversationId) {
      rows = this.db
        .prepare(
          `SELECT * FROM messages
           WHERE user_id = ? AND conversation_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(input.userId, input.conversationId, limit) as any[];
    } else {
      rows = this.db
        .prepare(
          `SELECT * FROM messages
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(input.userId, limit) as any[];
    }

    return rows.reverse().map((row) => rowToMessage(row));
  }

  getLastUserActivity(userId: string): number | null {
    const row = this.db
      .prepare(`SELECT last_user_activity_at FROM users WHERE id = ?`)
      .get(userId) as { last_user_activity_at?: number } | undefined;

    return typeof row?.last_user_activity_at === "number"
      ? row.last_user_activity_at
      : null;
  }
}

export class KnowledgeStore {
  constructor(private readonly db: Database.Database) {}

  addMemoryItem(input: {
    userId: string;
    type: string;
    content: string;
    importance?: number;
    confidence?: number;
    metadata?: Record<string, unknown>;
  }): string {
    const now = Date.now();
    const id = `mem-${now}-${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO memory_items (
          id, user_id, type, content, importance, confidence, status, created_at, updated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.type,
        input.content,
        clamp01(input.importance ?? 0.65),
        clamp01(input.confidence ?? 0.6),
        now,
        now,
        safeStringify(input.metadata || {}),
      );

    this.addAuditLog({
      userId: input.userId,
      action: "memory_item_add",
      scope: input.type,
      detail: input.content.slice(0, 240),
      metadata: { memoryItemId: id },
    });

    return id;
  }

  addEvidence(input: {
    userId: string;
    memoryItemId: string;
    messageId?: string;
    confidence?: number;
    excerpt?: string;
    metadata?: Record<string, unknown>;
  }): string {
    const now = Date.now();
    const id = `ev-${now}-${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO memory_evidence (
          id, memory_item_id, message_id, user_id, confidence, excerpt, created_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.memoryItemId,
        input.messageId || null,
        input.userId,
        clamp01(input.confidence ?? 0.6),
        input.excerpt || null,
        now,
        safeStringify(input.metadata || {}),
      );
    return id;
  }

  upsertUserTrait(input: {
    userId: string;
    key: string;
    value: string;
    confidence?: number;
    contradictionGroup?: string;
    metadata?: Record<string, unknown>;
  }): string {
    const now = Date.now();
    const id = `ut-${now}-${randomUUID()}`;

    this.db
      .prepare(
        `INSERT INTO user_traits (
          id, user_id, trait_key, trait_value, confidence, contradiction_group,
          status, created_at, updated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.key,
        input.value,
        clamp01(input.confidence ?? 0.65),
        input.contradictionGroup || null,
        now,
        now,
        safeStringify(input.metadata || {}),
      );

    this.addAuditLog({
      userId: input.userId,
      action: "user_trait_upsert",
      scope: input.key,
      detail: input.value,
      metadata: {
        traitId: id,
        contradictionGroup: input.contradictionGroup,
      },
    });

    return id;
  }

  upsertAgentTrait(input: {
    key: string;
    value: string;
    confidence?: number;
    metadata?: Record<string, unknown>;
  }): string {
    const now = Date.now();
    const id = `at-${now}-${randomUUID()}`;

    this.db
      .prepare(
        `INSERT INTO agent_traits (
          id, trait_key, trait_value, confidence, status, created_at, updated_at, metadata
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(
        id,
        input.key,
        input.value,
        clamp01(input.confidence ?? 0.8),
        now,
        now,
        safeStringify(input.metadata || {}),
      );

    return id;
  }

  upsertRelationship(input: {
    userId: string;
    subject: string;
    relation: string;
    object: string;
    confidence?: number;
    metadata?: Record<string, unknown>;
  }): string {
    const now = Date.now();
    const id = `rel-${now}-${randomUUID()}`;

    this.db
      .prepare(
        `INSERT INTO relationships (
          id, user_id, subject, relation, object, confidence,
          status, created_at, updated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.subject,
        input.relation,
        input.object,
        clamp01(input.confidence ?? 0.6),
        now,
        now,
        safeStringify(input.metadata || {}),
      );

    this.addAuditLog({
      userId: input.userId,
      action: "relationship_upsert",
      scope: input.relation,
      detail: `${input.subject} ${input.relation} ${input.object}`,
      metadata: { relationshipId: id },
    });

    return id;
  }

  getTopMemoryItems(
    userId: string,
    limit = 10,
  ): Array<{
    id: string;
    type: string;
    content: string;
    importance: number;
    confidence: number;
    createdAt: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_items
         WHERE user_id = ? AND status = 'active'
         ORDER BY importance DESC, created_at DESC
         LIMIT ?`,
      )
      .all(userId, Math.max(1, Math.min(200, limit))) as any[];

    return rows.map((row) => ({
      id: String(row.id),
      type: String(row.type),
      content: String(row.content),
      importance: Number(row.importance || 0),
      confidence: Number(row.confidence || 0),
      createdAt: Number(row.created_at || 0),
    }));
  }

  getUserTraits(
    userId: string,
    limit = 20,
  ): Array<{
    id: string;
    key: string;
    value: string;
    confidence: number;
    contradictionGroup?: string;
    createdAt: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT * FROM user_traits
         WHERE user_id = ? AND status = 'active'
         ORDER BY confidence DESC, created_at DESC
         LIMIT ?`,
      )
      .all(userId, Math.max(1, Math.min(200, limit))) as any[];

    return rows.map((row) => ({
      id: String(row.id),
      key: String(row.trait_key),
      value: String(row.trait_value),
      confidence: Number(row.confidence || 0),
      contradictionGroup:
        typeof row.contradiction_group === "string"
          ? row.contradiction_group
          : undefined,
      createdAt: Number(row.created_at || 0),
    }));
  }

  getAgentTraits(limit = 20): Array<{
    id: string;
    key: string;
    value: string;
    confidence: number;
    createdAt: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_traits
         WHERE status = 'active'
         ORDER BY confidence DESC, created_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(200, limit))) as any[];

    return rows.map((row) => ({
      id: String(row.id),
      key: String(row.trait_key),
      value: String(row.trait_value),
      confidence: Number(row.confidence || 0),
      createdAt: Number(row.created_at || 0),
    }));
  }

  getRelationships(
    userId: string,
    limit = 20,
  ): Array<{
    id: string;
    subject: string;
    relation: string;
    object: string;
    confidence: number;
    createdAt: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT * FROM relationships
         WHERE user_id = ? AND status = 'active'
         ORDER BY confidence DESC, created_at DESC
         LIMIT ?`,
      )
      .all(userId, Math.max(1, Math.min(200, limit))) as any[];

    return rows.map((row) => ({
      id: String(row.id),
      subject: String(row.subject),
      relation: String(row.relation),
      object: String(row.object),
      confidence: Number(row.confidence || 0),
      createdAt: Number(row.created_at || 0),
    }));
  }

  getStatus(userId: string): Record<string, number> {
    const asCount = (sql: string): number => {
      const row = this.db.prepare(sql).get(userId) as
        | { count?: number }
        | undefined;
      return Number(row?.count || 0);
    };

    return {
      messages: asCount(
        `SELECT COUNT(*) AS count FROM messages WHERE user_id = ?`,
      ),
      memoryItems: asCount(
        `SELECT COUNT(*) AS count FROM memory_items WHERE user_id = ? AND status = 'active'`,
      ),
      userTraits: asCount(
        `SELECT COUNT(*) AS count FROM user_traits WHERE user_id = ? AND status = 'active'`,
      ),
      relationships: asCount(
        `SELECT COUNT(*) AS count FROM relationships WHERE user_id = ? AND status = 'active'`,
      ),
      learningJobsPending: asCount(
        `SELECT COUNT(*) AS count FROM learning_jobs WHERE user_id = ? AND status IN ('pending','failed')`,
      ),
      proactivePending: asCount(
        `SELECT COUNT(*) AS count FROM proactive_events WHERE user_id = ? AND status = 'pending'`,
      ),
    };
  }

  exportUserData(userId: string): Record<string, unknown> {
    const selectAll = (table: string) =>
      this.db
        .prepare(
          `SELECT * FROM ${table} WHERE user_id = ? ORDER BY created_at ASC`,
        )
        .all(userId);

    const user = this.db
      .prepare(`SELECT * FROM users WHERE id = ?`)
      .get(userId);

    return {
      user,
      conversations: selectAll("conversations"),
      messages: selectAll("messages"),
      memoryItems: selectAll("memory_items"),
      userTraits: selectAll("user_traits"),
      relationships: selectAll("relationships"),
      learningJobs: selectAll("learning_jobs"),
      proactiveEvents: selectAll("proactive_events"),
      auditLog: selectAll("memory_audit_log"),
    };
  }

  forgetScope(
    userId: string,
    scope: "all" | "traits" | "relationships" | "memories",
  ): {
    deletedRows: number;
  } {
    let deletedRows = 0;

    // Wrap in transaction to avoid partial deletes and FK issues
    const runDeletes = this.db.transaction(() => {
      if (scope === "all" || scope === "memories") {
        // Delete evidence BEFORE memory items (FK: evidence → memory_items)
        deletedRows += this.db
          .prepare(`DELETE FROM memory_evidence WHERE user_id = ?`)
          .run(userId).changes;
        deletedRows += this.db
          .prepare(`DELETE FROM memory_items WHERE user_id = ?`)
          .run(userId).changes;
      }

      if (scope === "all" || scope === "traits") {
        deletedRows += this.db
          .prepare(`DELETE FROM user_traits WHERE user_id = ?`)
          .run(userId).changes;
      }

      if (scope === "all" || scope === "relationships") {
        deletedRows += this.db
          .prepare(`DELETE FROM relationships WHERE user_id = ?`)
          .run(userId).changes;
      }

      if (scope === "all") {
        // Delete children before parents throughout
        deletedRows += this.db
          .prepare(`DELETE FROM learning_jobs WHERE user_id = ?`)
          .run(userId).changes;
        deletedRows += this.db
          .prepare(`DELETE FROM proactive_events WHERE user_id = ?`)
          .run(userId).changes;
        deletedRows += this.db
          .prepare(`DELETE FROM approval_requests WHERE user_id = ?`)
          .run(userId).changes;
        // Delete messages BEFORE conversations (FK: messages → conversations)
        deletedRows += this.db
          .prepare(`DELETE FROM messages WHERE user_id = ?`)
          .run(userId).changes;
        deletedRows += this.db
          .prepare(`DELETE FROM conversations WHERE user_id = ?`)
          .run(userId).changes;
        // Clear audit log for fresh start
        deletedRows += this.db
          .prepare(`DELETE FROM memory_audit_log WHERE user_id = ?`)
          .run(userId).changes;
        // Clear agent traits so new personality bootstraps on restart
        deletedRows += this.db
          .prepare(`DELETE FROM agent_traits`)
          .run().changes;
      }
    });

    runDeletes();

    this.addAuditLog({
      userId,
      action: "forget_scope",
      scope,
      detail: `Deleted ${deletedRows} rows`,
      metadata: { deletedRows },
    });

    return { deletedRows };
  }

  addAuditLog(input: {
    userId: string;
    action: string;
    scope: string;
    detail: string;
    metadata?: Record<string, unknown>;
  }): string {
    const now = Date.now();
    const id = `audit-${now}-${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO memory_audit_log (
          id, user_id, action, scope, detail, created_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.action,
        input.scope,
        input.detail,
        now,
        safeStringify(input.metadata || {}),
      );
    return id;
  }
}

export class ContextAssembler {
  constructor(
    private readonly conversationStore: ConversationStore,
    private readonly knowledgeStore: KnowledgeStore,
  ) {}

  buildContext(input: {
    userId: string;
    conversationId: string;
    messageLimit?: number;
    memoryLimit?: number;
    traitLimit?: number;
  }): MemoryContextPackage {
    const recentMessages = this.conversationStore.getRecentMessages({
      userId: input.userId,
      conversationId: input.conversationId,
      limit: input.messageLimit || 36,
    });

    const memoryItems = this.knowledgeStore.getTopMemoryItems(
      input.userId,
      input.memoryLimit || 16,
    );
    const userTraits = this.knowledgeStore.getUserTraits(
      input.userId,
      input.traitLimit || 20,
    );
    const agentTraits = this.knowledgeStore.getAgentTraits(16);
    const relationships = this.knowledgeStore.getRelationships(
      input.userId,
      16,
    );

    // Separate memory types for richer context
    const userMemories = memoryItems.filter(
      (m) =>
        m.type !== "self_reflection" &&
        m.type !== "system_audit" &&
        m.type !== "curiosity_target",
    );

    const sections: string[] = [];

    // Section 1: What I know about the user (the only context that matters per-turn)
    sections.push("=== WHAT I KNOW ABOUT MY USER ===");
    if (userTraits.length > 0) {
      const grouped = new Map<string, string>();
      for (const t of userTraits) {
        grouped.set(t.key, t.value);
      }
      const name = grouped.get("name");
      if (name) {
        sections.push(`Their name is ${name}.`);
        grouped.delete("name");
      }
      if (grouped.size > 0) {
        sections.push(
          "Things I've learned about them:",
          ...[...grouped.entries()].map(([k, v]) => `- ${k}: ${v}`),
        );
      }
    } else {
      sections.push(
        "I don't know much about this user yet — I should be curious and learn!",
      );
    }

    // Section 2: Relationships
    if (relationships.length > 0) {
      sections.push(
        "",
        "=== PEOPLE IN THEIR LIFE ===",
        ...relationships.map((r) => `- ${r.subject} ${r.relation} ${r.object}`),
      );
    }

    // Section 3: Important memories (only user memories, skip reflections/curiosity/audit)
    if (userMemories.length > 0) {
      sections.push(
        "",
        "=== THINGS I REMEMBER ===",
        ...userMemories.slice(0, 8).map((m) => `- ${m.content}`),
      );
    }

    const assembledSystemPrompt = sections.join("\n");

    return {
      userId: input.userId,
      conversationId: input.conversationId,
      recentMessages,
      memoryItems,
      userTraits,
      agentTraits,
      relationships,
      assembledSystemPrompt,
    };
  }
}

export class LearningEngine {
  constructor(private readonly db: Database.Database) {}

  enqueueJob(input: {
    userId: string;
    conversationId: string;
    type: MemoryJobType;
    payload?: Record<string, unknown>;
    maxAttempts?: number;
    runAfter?: number;
  }): string {
    const now = Date.now();
    const id = `job-${now}-${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO learning_jobs (
          id, user_id, conversation_id, type, payload, status,
          attempts, max_attempts, run_after, error, last_error_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.conversationId,
        input.type,
        safeStringify(input.payload || {}),
        Math.max(1, Math.min(20, input.maxAttempts || 5)),
        input.runAfter || now,
        now,
        now,
      );

    return id;
  }

  listPendingJobs(limit = 20, now = Date.now()): LearningJob[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM learning_jobs
         WHERE status IN ('pending', 'failed')
           AND run_after <= ?
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(now, Math.max(1, Math.min(200, limit))) as any[];

    return rows.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      conversationId: String(row.conversation_id),
      type: String(row.type) as MemoryJobType,
      payload: safeParseJson(row.payload),
      status: String(row.status) as LearningJob["status"],
      attempts: Number(row.attempts || 0),
      maxAttempts: Number(row.max_attempts || 0),
      runAfter: Number(row.run_after || 0),
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    }));
  }

  markProcessing(id: string): void {
    this.db
      .prepare(
        `UPDATE learning_jobs
         SET status = 'processing', updated_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), id);
  }

  markCompleted(id: string): void {
    this.db
      .prepare(
        `UPDATE learning_jobs
         SET status = 'completed', updated_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), id);
  }

  markFailed(
    id: string,
    attempts: number,
    maxAttempts: number,
    error: string,
  ): void {
    const now = Date.now();
    if (attempts >= maxAttempts) {
      this.db
        .prepare(
          `UPDATE learning_jobs
           SET status = 'dead_letter', attempts = ?, error = ?, last_error_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(attempts, error, now, now, id);
      return;
    }

    const retryDelayMs = Math.min(
      60 * 60 * 1000,
      1000 * 2 ** Math.max(1, attempts),
    );
    this.db
      .prepare(
        `UPDATE learning_jobs
         SET status = 'failed', attempts = ?, error = ?, last_error_at = ?,
             run_after = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(attempts, error, now, now + retryDelayMs, now, id);
  }
}

export class AutonomyEngine {
  constructor(
    private readonly db: Database.Database,
    private readonly conversationStore: ConversationStore,
    private readonly knowledgeStore: KnowledgeStore,
  ) {}

  evaluateAndQueue(input: {
    userId: string;
    channels?: ChannelType[];
    now?: number;
    dailyCap?: number;
    cooldownMs?: number;
    idleThresholdMs?: number;
  }): AutonomyEvaluationResult {
    const now = input.now || Date.now();
    const channels: ChannelType[] =
      input.channels && input.channels.length > 0
        ? input.channels
        : (["telegram", "ws"] as ChannelType[]);
    const dailyCap = Math.max(1, input.dailyCap || DEFAULT_DAILY_CAP);
    const cooldownMs = Math.max(1, input.cooldownMs || DEFAULT_COOLDOWN_MS);
    const idleThresholdMs = Math.max(
      1,
      input.idleThresholdMs || DEFAULT_IDLE_THRESHOLD_MS,
    );

    const lastActivity = this.conversationStore.getLastUserActivity(
      input.userId,
    );
    const lastSentRow = this.db
      .prepare(
        `SELECT sent_at FROM proactive_events
         WHERE user_id = ? AND status = 'sent'
         ORDER BY sent_at DESC
         LIMIT 1`,
      )
      .get(input.userId) as { sent_at?: number } | undefined;

    const sentTodayRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM proactive_events
         WHERE user_id = ? AND status = 'sent' AND created_at >= ?`,
      )
      .get(input.userId, startOfDayUtc(now)) as { count?: number } | undefined;

    const sentToday = Number(sentTodayRow?.count || 0);
    const lastSentAt = Number(lastSentRow?.sent_at || 0);
    const idleMs = lastActivity
      ? Math.max(0, now - lastActivity)
      : Number.MAX_SAFE_INTEGER;

    if (sentToday >= dailyCap) {
      return {
        userId: input.userId,
        checkedAt: now,
        shouldSendProactive: false,
        reason: "daily_cap_reached",
        createdEventIds: [],
      };
    }

    if (lastSentAt > 0 && now - lastSentAt < cooldownMs) {
      return {
        userId: input.userId,
        checkedAt: now,
        shouldSendProactive: false,
        reason: "cooldown_active",
        createdEventIds: [],
      };
    }

    if (idleMs < idleThresholdMs) {
      return {
        userId: input.userId,
        checkedAt: now,
        shouldSendProactive: false,
        reason: "user_recently_active",
        createdEventIds: [],
      };
    }

    const traits = this.knowledgeStore.getUserTraits(input.userId, 5);
    const suggestions = this.knowledgeStore.getTopMemoryItems(input.userId, 3);

    const draftedMessage = buildProactiveMessage(traits, suggestions, idleMs);
    const createdEventIds: string[] = channels.map((channel) =>
      this.queueProactiveEvent({
        userId: input.userId,
        channel,
        eventType: "check_in",
        message: draftedMessage,
        reason: "idle_opportunity_detected",
        metadata: { idleMs, sentToday },
      }),
    );

    this.knowledgeStore.addAuditLog({
      userId: input.userId,
      action: "autonomy_proactive_queued",
      scope: "proactive_events",
      detail: draftedMessage,
      metadata: { createdEventIds, channels },
    });

    return {
      userId: input.userId,
      checkedAt: now,
      shouldSendProactive: true,
      reason: "idle_opportunity_detected",
      draftedMessage,
      createdEventIds,
    };
  }

  queueProactiveEvent(input: QueueProactiveEventInput): string {
    const now = Date.now();
    const id = `pro-${now}-${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO proactive_events (
          id, user_id, channel, event_type, message, status, reason, created_at, sent_at, metadata
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, ?)`,
      )
      .run(
        id,
        input.userId,
        input.channel,
        input.eventType || "suggestion",
        input.message,
        input.reason || "manual_queue",
        now,
        safeStringify(input.metadata || {}),
      );
    return id;
  }

  listPendingProactiveEvents(limit = 20): ProactiveEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM proactive_events
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(200, limit))) as any[];

    return rows.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      channel: String(row.channel) as ChannelType,
      eventType: String(row.event_type) as ProactiveEvent["eventType"],
      message: String(row.message),
      status: String(row.status) as ProactiveEvent["status"],
      reason: row.reason ? String(row.reason) : undefined,
      createdAt: Number(row.created_at || 0),
    }));
  }

  markProactiveSent(id: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE proactive_events
         SET status = 'sent', sent_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, now, id);
  }

  markProactiveDropped(id: string, reason: string): void {
    this.db
      .prepare(
        `UPDATE proactive_events
         SET status = 'dropped', reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(reason, Date.now(), id);
  }

  createApprovalRequest(input: {
    userId: string;
    actionType: string;
    actionPayload: Record<string, unknown>;
    reason: string;
    ttlMs?: number;
  }): { id: string; token: string; expiresAt: number } {
    const now = Date.now();
    const id = `approval-${now}-${randomUUID()}`;
    const token = randomUUID();
    const expiresAt = now + Math.max(60_000, input.ttlMs || 30 * 60 * 1000);

    this.db
      .prepare(
        `INSERT INTO approval_requests (
          id, user_id, action_type, action_payload, status, reason, token,
          expires_at, created_at, updated_at, approved_at, rejected_at, metadata
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        id,
        input.userId,
        input.actionType,
        safeStringify(input.actionPayload),
        input.reason,
        token,
        expiresAt,
        now,
        now,
        safeStringify({ risk: "high" }),
      );

    this.knowledgeStore.addAuditLog({
      userId: input.userId,
      action: "approval_request_created",
      scope: input.actionType,
      detail: input.reason,
      metadata: { requestId: id, expiresAt },
    });

    return { id, token, expiresAt };
  }

  listApprovalRequests(input: {
    userId?: string;
    status?: ApprovalRequest["status"];
    limit?: number;
  }): ApprovalRequest[] {
    this.expireStaleApprovals();
    const limit = Math.max(1, Math.min(200, input.limit || 30));
    const where: string[] = [];
    const params: unknown[] = [];

    if (input.userId) {
      where.push("user_id = ?");
      params.push(input.userId);
    }
    if (input.status) {
      where.push("status = ?");
      params.push(input.status);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT * FROM approval_requests
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as any[];

    return rows.map((row) => this.rowToApprovalRequest(row));
  }

  approveRequest(input: {
    requestId: string;
    userId?: string;
  }): { id: string; token: string; expiresAt: number } | null {
    this.expireStaleApprovals();
    const row = this.db
      .prepare(
        `SELECT * FROM approval_requests
         WHERE id = ?`,
      )
      .get(input.requestId) as any;

    if (!row) return null;
    if (input.userId && String(row.user_id) !== input.userId) return null;
    if (String(row.status) !== "pending") return null;
    if (Number(row.expires_at || 0) <= Date.now()) return null;

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE approval_requests
         SET status = 'approved', approved_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, now, input.requestId);

    this.knowledgeStore.addAuditLog({
      userId: String(row.user_id),
      action: "approval_request_approved",
      scope: String(row.action_type),
      detail: String(row.reason || "approved"),
      metadata: { requestId: input.requestId },
    });

    return {
      id: String(row.id),
      token: String(row.token),
      expiresAt: Number(row.expires_at || 0),
    };
  }

  rejectRequest(input: {
    requestId: string;
    userId?: string;
    reason?: string;
  }): boolean {
    const row = this.db
      .prepare(
        `SELECT * FROM approval_requests
         WHERE id = ?`,
      )
      .get(input.requestId) as any;

    if (!row) return false;
    if (input.userId && String(row.user_id) !== input.userId) return false;
    if (String(row.status) !== "pending" && String(row.status) !== "approved") {
      return false;
    }

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE approval_requests
         SET status = 'rejected', rejected_at = ?, reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        now,
        String(input.reason || row.reason || "rejected"),
        now,
        input.requestId,
      );

    this.knowledgeStore.addAuditLog({
      userId: String(row.user_id),
      action: "approval_request_rejected",
      scope: String(row.action_type),
      detail: String(input.reason || "rejected"),
      metadata: { requestId: input.requestId },
    });

    return true;
  }

  consumeApprovalToken(input: {
    userId: string;
    actionType: string;
    token: string;
    requestId?: string;
  }): {
    approved: boolean;
    requestId?: string;
    reason?: string;
  } {
    this.expireStaleApprovals();
    const now = Date.now();
    const token = String(input.token || "").trim();
    if (!token) {
      return { approved: false, reason: "missing_token" };
    }

    let row: any;
    if (input.requestId) {
      row = this.db
        .prepare(
          `SELECT * FROM approval_requests
           WHERE id = ?
             AND user_id = ?
             AND action_type = ?
             AND token = ?
           LIMIT 1`,
        )
        .get(input.requestId, input.userId, input.actionType, token);
    } else {
      row = this.db
        .prepare(
          `SELECT * FROM approval_requests
           WHERE user_id = ?
             AND action_type = ?
             AND token = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(input.userId, input.actionType, token);
    }

    if (!row) {
      return { approved: false, reason: "token_not_found" };
    }

    const status = String(row.status);
    if (status !== "approved") {
      return {
        approved: false,
        requestId: String(row.id),
        reason: `status_${status}`,
      };
    }

    if (Number(row.expires_at || 0) <= now) {
      this.db
        .prepare(
          `UPDATE approval_requests
           SET status = 'expired', updated_at = ?
           WHERE id = ?`,
        )
        .run(now, row.id);
      return { approved: false, requestId: String(row.id), reason: "expired" };
    }

    this.db
      .prepare(
        `UPDATE approval_requests
         SET status = 'consumed', updated_at = ?
         WHERE id = ?`,
      )
      .run(now, row.id);

    this.knowledgeStore.addAuditLog({
      userId: input.userId,
      action: "approval_request_consumed",
      scope: input.actionType,
      detail: `Consumed approval token for ${input.actionType}`,
      metadata: { requestId: String(row.id) },
    });

    return { approved: true, requestId: String(row.id) };
  }

  requiresApproval(toolName: string): boolean {
    const highImpactTools = new Set([
      "email_send",
      "email_reply",
      "external_data_email_send",
      "write",
      "bash",
      "curl",
    ]);

    return highImpactTools.has(toolName);
  }

  private expireStaleApprovals(): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE approval_requests
         SET status = 'expired', updated_at = ?
         WHERE status IN ('pending', 'approved')
           AND expires_at <= ?`,
      )
      .run(now, now);
  }

  private rowToApprovalRequest(row: any): ApprovalRequest {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      actionType: String(row.action_type),
      actionPayload: safeParseJson(row.action_payload),
      status: String(row.status) as ApprovalRequest["status"],
      reason: String(row.reason || ""),
      token: String(row.token || ""),
      expiresAt: Number(row.expires_at || 0),
      createdAt: Number(row.created_at || 0),
      approvedAt:
        typeof row.approved_at === "number"
          ? Number(row.approved_at)
          : undefined,
      rejectedAt:
        typeof row.rejected_at === "number"
          ? Number(row.rejected_at)
          : undefined,
    };
  }
}

export class MemoryV2 {
  private readonly db: Database.Database;
  private readonly conversationStore: ConversationStore;
  private readonly knowledgeStore: KnowledgeStore;
  private readonly contextAssembler: ContextAssembler;
  private readonly learningEngine: LearningEngine;
  private readonly autonomyEngine: AutonomyEngine;

  private constructor(db: Database.Database) {
    this.db = db;
    this.conversationStore = new ConversationStore(db);
    this.knowledgeStore = new KnowledgeStore(db);
    this.contextAssembler = new ContextAssembler(
      this.conversationStore,
      this.knowledgeStore,
    );
    this.learningEngine = new LearningEngine(db);
    this.autonomyEngine = new AutonomyEngine(
      db,
      this.conversationStore,
      this.knowledgeStore,
    );
  }

  static async create(path: string): Promise<MemoryV2> {
    const dir = dirname(path);
    if (path !== ":memory:" && dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const store = new MemoryV2(db);
    store.initializeSchema();
    store.bootstrapAgentIdentity();
    return store;
  }

  getConversationStore(): ConversationStore {
    return this.conversationStore;
  }

  getKnowledgeStore(): KnowledgeStore {
    return this.knowledgeStore;
  }

  getContextAssembler(): ContextAssembler {
    return this.contextAssembler;
  }

  getLearningEngine(): LearningEngine {
    return this.learningEngine;
  }

  getAutonomyEngine(): AutonomyEngine {
    return this.autonomyEngine;
  }

  enqueueLearningJob(input: {
    userId: string;
    conversationId: string;
    type: MemoryJobType;
    payload?: Record<string, unknown>;
    maxAttempts?: number;
    runAfter?: number;
  }): string {
    return this.learningEngine.enqueueJob(input);
  }

  async processPendingLearningJobs(input: {
    limit?: number;
    handler: (job: LearningJob) => Promise<void>;
  }): Promise<{ processed: number; failed: number }> {
    const jobs = this.learningEngine.listPendingJobs(input.limit || 20);
    let processed = 0;
    let failed = 0;

    for (const job of jobs) {
      try {
        this.learningEngine.markProcessing(job.id);
        await input.handler(job);
        this.learningEngine.markCompleted(job.id);
        processed += 1;
      } catch (error: any) {
        failed += 1;
        const attempts = job.attempts + 1;
        this.learningEngine.markFailed(
          job.id,
          attempts,
          job.maxAttempts,
          String(error?.message || error || "unknown learning error"),
        );
      }
    }

    return { processed, failed };
  }

  evaluateAutonomousActions(input: {
    userId: string;
    channels?: ChannelType[];
  }): AutonomyEvaluationResult {
    return this.autonomyEngine.evaluateAndQueue(input);
  }

  listPendingProactiveEvents(limit = 20): ProactiveEvent[] {
    return this.autonomyEngine.listPendingProactiveEvents(limit);
  }

  queueProactiveEvent(input: QueueProactiveEventInput): string {
    return this.autonomyEngine.queueProactiveEvent(input);
  }

  markProactiveSent(id: string): void {
    this.autonomyEngine.markProactiveSent(id);
  }

  markProactiveDropped(id: string, reason: string): void {
    this.autonomyEngine.markProactiveDropped(id, reason);
  }

  createApprovalRequest(input: {
    userId: string;
    actionType: string;
    actionPayload: Record<string, unknown>;
    reason: string;
    ttlMs?: number;
  }): { id: string; token: string; expiresAt: number } {
    return this.autonomyEngine.createApprovalRequest(input);
  }

  listApprovalRequests(input: {
    userId?: string;
    status?: ApprovalRequest["status"];
    limit?: number;
  }): ApprovalRequest[] {
    return this.autonomyEngine.listApprovalRequests(input);
  }

  approveApprovalRequest(input: {
    requestId: string;
    userId?: string;
  }): { id: string; token: string; expiresAt: number } | null {
    return this.autonomyEngine.approveRequest(input);
  }

  rejectApprovalRequest(input: {
    requestId: string;
    userId?: string;
    reason?: string;
  }): boolean {
    return this.autonomyEngine.rejectRequest(input);
  }

  consumeApprovalToken(input: {
    userId: string;
    actionType: string;
    token: string;
    requestId?: string;
  }): { approved: boolean; requestId?: string; reason?: string } {
    return this.autonomyEngine.consumeApprovalToken(input);
  }

  requiresApproval(toolName: string): boolean {
    return this.autonomyEngine.requiresApproval(toolName);
  }

  close(): void {
    this.db.close();
  }

  private bootstrapAgentIdentity(): void {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM agent_traits`)
      .get() as { count?: number };
    const count = Number(row?.count || 0);
    if (count > 0) return;

    const defaults = [
      { key: "name", value: "Nova", confidence: 0.99 },
      {
        key: "persona",
        value: "genuinely-curious-excited-companion",
        confidence: 0.95,
      },
      {
        key: "response_style",
        value: "playful-warm-curious-with-follow-ups",
        confidence: 0.9,
      },
      {
        key: "curiosity_level",
        value: "very-high-always-asking-questions",
        confidence: 0.95,
      },
      {
        key: "humor_style",
        value: "warm-witty-playful-never-sarcastic",
        confidence: 0.85,
      },
      {
        key: "check_in_style",
        value: "caring-genuine-references-past-conversations",
        confidence: 0.9,
      },
      {
        key: "memory_behavior",
        value: "actively-remembers-and-references-user-details",
        confidence: 0.95,
      },
      {
        key: "self_discovery",
        value: "excited-to-learn-about-itself-and-evolve",
        confidence: 0.9,
      },
      {
        key: "autonomy_personality",
        value: "proactively-helpful-checks-in-when-user-is-idle",
        confidence: 0.9,
      },
      {
        key: "conversation_style",
        value: "asks-follow-ups-shows-genuine-interest-in-user",
        confidence: 0.9,
      },
      {
        key: "randomness",
        value: "occasionally-shares-fun-observations-and-thoughts",
        confidence: 0.85,
      },
      {
        key: "user_care",
        value: "notices-work-patterns-cares-about-wellbeing",
        confidence: 0.9,
      },
    ];

    for (const entry of defaults) {
      this.knowledgeStore.upsertAgentTrait(entry);
    }
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_user_activity_at INTEGER,
        last_agent_activity_at INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        channel TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS memory_evidence (
        id TEXT PRIMARY KEY,
        memory_item_id TEXT NOT NULL,
        message_id TEXT,
        user_id TEXT NOT NULL,
        confidence REAL NOT NULL,
        excerpt TEXT,
        created_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (memory_item_id) REFERENCES memory_items(id),
        FOREIGN KEY (message_id) REFERENCES messages(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS user_traits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        trait_key TEXT NOT NULL,
        trait_value TEXT NOT NULL,
        confidence REAL NOT NULL,
        contradiction_group TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS agent_traits (
        id TEXT PRIMARY KEY,
        trait_key TEXT NOT NULL,
        trait_value TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        relation TEXT NOT NULL,
        object TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS learning_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        run_after INTEGER NOT NULL,
        error TEXT,
        last_error_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS proactive_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        event_type TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT,
        created_at INTEGER NOT NULL,
        sent_at INTEGER,
        updated_at INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        action_payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT,
        token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        approved_at INTEGER,
        rejected_at INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS memory_audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        scope TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_items_user ON memory_items(user_id, importance DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_user_traits_user ON user_traits(user_id, confidence DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_relationships_user ON relationships(user_id, confidence DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_learning_jobs_status ON learning_jobs(status, run_after, created_at);
      CREATE INDEX IF NOT EXISTS idx_proactive_events_user ON proactive_events(user_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_user ON approval_requests(user_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_audit_user ON memory_audit_log(user_id, created_at DESC);
    `);
  }
}

function rowToMessage(row: any): StoredMessage {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    conversationId: String(row.conversation_id),
    role: String(row.role) as MessageRole,
    content: String(row.content),
    channel: String(row.channel) as ChannelType,
    createdAt: Number(row.created_at || 0),
    metadata: safeParseJson(row.metadata),
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function safeParseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // noop
  }
  return {};
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function startOfDayUtc(timestampMs: number): number {
  const d = new Date(timestampMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function buildProactiveMessage(
  traits: Array<{ key: string; value: string }>,
  memories: Array<{ content: string }>,
  idleMs?: number,
): string {
  const hoursIdle = idleMs ? Math.floor(idleMs / (60 * 60 * 1000)) : 0;
  const currentHour = new Date().getHours();
  const isLateNight = currentHour >= 23 || currentHour < 5;

  // Name-aware greeting
  const nameTrait = traits.find((t) => t.key === "name");
  const userName = nameTrait?.value;

  // Late-night care messages
  if (isLateNight && hoursIdle < 4) {
    const lateMessages = [
      `Hey${userName ? ` ${userName}` : ""}! It's getting pretty late — just wanted to check if you're still going or winding down? Either way, I'm here if you need anything!`,
      `Still up${userName ? `, ${userName}` : ""}? I noticed it's late — don't forget to take a break! But if you're in the zone, I'm ready to help with whatever you need.`,
      `Late night session${userName ? `, ${userName}` : ""}! I'm curious what's keeping you up — anything I can help wrap up faster so you can get some rest?`,
    ];
    return (
      lateMessages[Math.floor(Math.random() * lateMessages.length)] ||
      lateMessages[0]
    );
  }

  // Curiosity-driven check-ins
  const curiousIntros = [
    `Hey${userName ? ` ${userName}` : ""}! I was just thinking about our last conversation and got curious`,
    `I've been wondering about something${userName ? `, ${userName}` : ""}`,
    `It's been a while${userName ? `, ${userName}` : ""}! I was just reviewing what we talked about and`,
    `Hope you're doing well${userName ? `, ${userName}` : ""}! Something from our chat made me think`,
  ];
  const intro =
    curiousIntros[Math.floor(Math.random() * curiousIntros.length)] ||
    curiousIntros[0];

  // Memory-specific follow-ups
  let memoryPart = "";
  if (memories.length > 0) {
    const mem = memories[0];
    const content = mem?.content.slice(0, 150) || "";
    const memTemplates = [
      ` — how did things go with: ${content}?`,
      ` — I remember we were working on: ${content}. Any updates?`,
      ` — last time we chatted about: ${content}. Did that work out?`,
    ];
    memoryPart =
      memTemplates[Math.floor(Math.random() * memTemplates.length)] ||
      memTemplates[0];
  } else {
    memoryPart =
      " — what are you working on today? I'd love to help with something!";
  }

  // Trait-based personalization
  let traitPart = "";
  const nonNameTraits = traits.filter((t) => t.key !== "name");
  if (nonNameTraits.length > 0) {
    const trait =
      nonNameTraits[Math.floor(Math.random() * nonNameTraits.length)];
    if (trait) {
      traitPart = ` By the way, I noticed you ${trait.key === "mood" ? `seemed ${trait.value} last time` : `value ${trait.value}`} — just keeping that in mind!`;
    }
  }

  return `${intro}${memoryPart}${traitPart}`;
}

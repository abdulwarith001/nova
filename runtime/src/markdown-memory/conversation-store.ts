/**
 * conversation-store.ts — Markdown-based conversation store.
 *
 * Replaces the SQLite-backed ConversationStore.
 *
 * Files managed:
 *   ~/.nova/memory/conversations/<conv-id>.md — One file per conversation
 *
 * Compaction:
 *   - Tool-result noise is filtered on write
 *   - Long assistant responses are truncated
 *   - Auto-compact collapses old messages into a summary when file grows large
 */

import { join } from "path";
import { existsSync, readdirSync, statSync } from "fs";
import { randomUUID } from "crypto";
import {
  readMarkdownFile,
  writeMarkdownFile,
  appendMarkdownFile,
  ensureDir,
} from "./markdown-store.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type ChannelType = "ws" | "telegram";
export type MessageRole = "system" | "user" | "assistant";

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

// ── Constants ───────────────────────────────────────────────────────────────

/** Skip messages that are pure tool-result noise. */
const TOOL_LOG_PATTERN = /^\[tool:\s*\S+\]\s*(success|failed|error)/i;

/** Max characters for stored assistant responses (longer ones get truncated). */
const MAX_ASSISTANT_LENGTH = 500;

/** Auto-compact when file exceeds this many bytes (~50KB). */
const AUTO_COMPACT_BYTES = 50_000;

/** Number of recent messages to keep verbatim during compaction. */
const COMPACT_KEEP_RECENT = 20;

// ── Store ───────────────────────────────────────────────────────────────────

export class MarkdownConversationStore {
  private readonly conversationsDir: string;

  constructor(memoryDir: string) {
    this.conversationsDir = join(memoryDir, "conversations");
    ensureDir(this.conversationsDir);
  }

  /**
   * Ensure a user exists. In Markdown mode, users are implicit — no-op.
   */
  ensureUser(userId: string): void {
    // Users are implicit in the file-based system
  }

  /**
   * Create or get a conversation file.
   */
  ensureConversation(
    userId: string,
    conversationId: string,
    channel: ChannelType,
  ): string {
    const convPath = this.getConversationPath(conversationId);
    if (!existsSync(convPath)) {
      const now = new Date();
      const header = [
        `# Conversation ${now.toISOString().split("T")[0]}`,
        "",
        `- user: ${userId}`,
        `- channel: ${channel}`,
        `- started: ${now.toISOString()}`,
        "",
        "---",
        "",
      ].join("\n");
      writeMarkdownFile(convPath, header);
    }
    return conversationId;
  }

  /**
   * Append a message to a conversation file.
   * Filters out tool-result noise and truncates long assistant responses.
   */
  addMessage(input: {
    userId: string;
    conversationId: string;
    role: MessageRole;
    content: string;
    channel: ChannelType;
    metadata?: Record<string, unknown>;
  }): string {
    // Filter out tool-result noise
    if (TOOL_LOG_PATTERN.test(input.content.trim())) {
      return "skipped";
    }

    const id = `msg-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    this.ensureConversation(input.userId, input.conversationId, input.channel);

    // Truncate long assistant responses
    let content = input.content;
    if (input.role === "assistant" && content.length > MAX_ASSISTANT_LENGTH) {
      content = content.slice(0, MAX_ASSISTANT_LENGTH - 3) + "...";
    }

    const speaker = input.role === "user" ? "user" : "nova";
    const entry = `**${speaker}** (${time}): ${content}\n\n`;
    const convPath = this.getConversationPath(input.conversationId);
    appendMarkdownFile(convPath, entry);

    // Auto-compact if file is getting large
    try {
      const stat = statSync(convPath);
      if (stat.size > AUTO_COMPACT_BYTES) {
        this.compact(input.conversationId, input.userId, input.channel);
      }
    } catch {
      // Non-fatal — compaction is best-effort
    }

    return id;
  }

  /**
   * Get recent messages from a conversation.
   */
  getRecentMessages(input: {
    userId: string;
    conversationId: string;
    limit?: number;
  }): StoredMessage[] {
    const convPath = this.getConversationPath(input.conversationId);
    const content = readMarkdownFile(convPath);
    if (!content) return [];

    const limit = input.limit || 36;
    const messages: StoredMessage[] = [];

    // Parse messages from Markdown format:
    // **user** (14:21): message content
    // **nova** (14:21): response content
    const msgRegex =
      /\*\*(user|nova)\*\*\s+\((\d{2}:\d{2})\):\s+(.+?)(?=\n\n\*\*(?:user|nova)\*\*|\n*$)/gs;
    let match: RegExpExecArray | null;

    while ((match = msgRegex.exec(content)) !== null) {
      const speaker = match[1];
      const time = match[2];
      const text = match[3].trim();

      messages.push({
        id: `msg-${messages.length}`,
        userId: input.userId,
        conversationId: input.conversationId,
        role: speaker === "user" ? "user" : "assistant",
        content: text,
        channel: "ws",
        createdAt: Date.now(),
        metadata: {},
      });
    }

    // Return the last N messages
    return messages.slice(-limit);
  }

  /**
   * Compact a conversation file by summarizing old messages.
   * Keeps the last `keepRecent` messages verbatim and collapses
   * older messages into a brief summary block.
   */
  compact(
    conversationId: string,
    userId?: string,
    channel?: ChannelType,
    keepRecent = COMPACT_KEEP_RECENT,
  ): void {
    const convPath = this.getConversationPath(conversationId);
    const content = readMarkdownFile(convPath);
    if (!content) return;

    // Parse all messages
    const msgRegex =
      /\*\*(user|nova)\*\*\s+\((\d{2}:\d{2})\):\s+(.+?)(?=\n\n\*\*(?:user|nova)\*\*|\n*$)/gs;
    const allMessages: Array<{ speaker: string; time: string; text: string }> =
      [];
    let match: RegExpExecArray | null;

    while ((match = msgRegex.exec(content)) !== null) {
      allMessages.push({
        speaker: match[1],
        time: match[2],
        text: match[3].trim(),
      });
    }

    // Nothing to compact if under threshold
    // Safety: if regex parsed very few messages from a large file, don't compact (avoid data loss)
    if (allMessages.length <= keepRecent || allMessages.length < 5) return;

    const oldMessages = allMessages.slice(0, -keepRecent);
    const recentMessages = allMessages.slice(-keepRecent);

    // Build summary of old messages (one line per message, user messages only for brevity)
    const summaryLines = oldMessages.map((m) => {
      const label = m.speaker === "user" ? "user" : "nova";
      const shortContent =
        m.text.length > 80 ? m.text.slice(0, 77) + "..." : m.text;
      return `- ${label}: ${shortContent}`;
    });

    // Extract header from original file
    const headerMatch = content.match(/^(.+?---\n)/s);
    const header = headerMatch
      ? headerMatch[1] + "\n"
      : `# Conversation (compacted)\n\n- user: ${userId || "unknown"}\n- channel: ${channel || "ws"}\n\n---\n\n`;

    // Build compacted file
    const compactedParts = [
      header,
      `> **[Summary of ${oldMessages.length} earlier messages]**\n`,
      ...summaryLines.map((l) => `> ${l}\n`),
      "\n",
      ...recentMessages.map(
        (m) => `**${m.speaker}** (${m.time}): ${m.text}\n\n`,
      ),
    ];

    writeMarkdownFile(convPath, compactedParts.join(""));
    console.log(
      `📦 Compacted conversation ${conversationId}: ${oldMessages.length} old → summary, keeping ${recentMessages.length} recent`,
    );
  }

  /**
   * Get the most recent conversation ID for a user.
   */
  getLatestConversationId(userId: string): string | null {
    if (!existsSync(this.conversationsDir)) return null;

    const files = readdirSync(this.conversationsDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();

    return files.length > 0 ? files[0].replace(".md", "") : null;
  }

  /**
   * Update the user's last activity timestamp. No-op in file-based system.
   */
  touchUserActivity(userId: string): void {
    // Activity is implicit from message timestamps
  }

  private getConversationPath(conversationId: string): string {
    return join(this.conversationsDir, `${conversationId}.md`);
  }
}

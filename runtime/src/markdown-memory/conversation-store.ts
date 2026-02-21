/**
 * conversation-store.ts — Markdown-based conversation store.
 *
 * Replaces the SQLite-backed ConversationStore.
 *
 * Files managed:
 *   ~/.nova/memory/conversations/<conv-id>.md — One file per conversation
 */

import { join } from "path";
import { existsSync, readdirSync } from "fs";
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
   */
  addMessage(input: {
    userId: string;
    conversationId: string;
    role: MessageRole;
    content: string;
    channel: ChannelType;
    metadata?: Record<string, unknown>;
  }): string {
    const id = `msg-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    this.ensureConversation(input.userId, input.conversationId, input.channel);

    const speaker = input.role === "user" ? "user" : "nova";
    const entry = `**${speaker}** (${time}): ${input.content}\n\n`;
    appendMarkdownFile(this.getConversationPath(input.conversationId), entry);

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

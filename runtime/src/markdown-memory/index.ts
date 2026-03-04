/**
 * MarkdownMemory — Orchestrator for the file-based memory system.
 *
 * Replaces the SQLite-backed MemoryV2 with Markdown/JSON files.
 * All persistent state lives in ~/.nova/memory/.
 */

import { join } from "path";
import { homedir } from "os";
import { ensureDir } from "./markdown-store.js";
import {
  MarkdownConversationStore,
  type StoredMessage,
  type ChannelType,
  type MessageRole,
} from "./conversation-store.js";
import { ProfileStore } from "./profile-store.js";

// Re-export all types
export type { StoredMessage, ChannelType, MessageRole };

// Re-export sub-modules
export { MarkdownConversationStore } from "./conversation-store.js";
export { ProfileStore } from "./profile-store.js";

// ── Default paths ───────────────────────────────────────────────────────────

const DEFAULT_MEMORY_DIR = join(homedir(), ".nova", "memory");

// ── Orchestrator ────────────────────────────────────────────────────────────

export class MarkdownMemory {
  private readonly memoryDir: string;
  private readonly conversationStore: MarkdownConversationStore;
  private readonly profileStore: ProfileStore;

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir || DEFAULT_MEMORY_DIR;
    ensureDir(this.memoryDir);

    this.conversationStore = new MarkdownConversationStore(this.memoryDir);
    this.profileStore = new ProfileStore(this.memoryDir);
  }

  static create(memoryDir?: string): MarkdownMemory {
    return new MarkdownMemory(memoryDir);
  }

  // ── Sub-store accessors ─────────────────────────────────────────────────

  getConversationStore(): MarkdownConversationStore {
    return this.conversationStore;
  }

  getProfileStore(): ProfileStore {
    return this.profileStore;
  }

  /**
   * No-op close — no database connections to shut down.
   */
  close(): void {
    // Nothing to close for file-based stores
  }
}

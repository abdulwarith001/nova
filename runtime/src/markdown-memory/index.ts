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
import {
  MarkdownLearningEngine,
  type LearningJob,
  type MemoryJobType,
} from "./learning-engine.js";
import {
  MarkdownContextAssembler,
  type MemoryContextPackage,
} from "./context-assembler.js";
import {
  KnowledgeJsonStore,
  type KnowledgeEntry,
  type KnowledgeCategory,
  type KnowledgeSearchResult,
  type KnowledgeSearchOptions,
} from "./knowledge-json-store.js";
import { ProfileStore } from "./profile-store.js";

// Re-export all types
export type {
  StoredMessage,
  ChannelType,
  MessageRole,
  LearningJob,
  MemoryJobType,
  MemoryContextPackage,
  KnowledgeEntry,
  KnowledgeCategory,
  KnowledgeSearchResult,
  KnowledgeSearchOptions,
};

// Re-export sub-modules
export { MarkdownConversationStore } from "./conversation-store.js";
export { MarkdownLearningEngine } from "./learning-engine.js";
export { MarkdownContextAssembler } from "./context-assembler.js";
export {
  KnowledgeJsonStore,
  VALID_CATEGORIES,
  normalizeText,
  textSimilarity,
} from "./knowledge-json-store.js";
export { ProfileStore } from "./profile-store.js";

// ── Default paths ───────────────────────────────────────────────────────────

const DEFAULT_MEMORY_DIR = join(homedir(), ".nova", "memory");

// ── Orchestrator ────────────────────────────────────────────────────────────

export class MarkdownMemory {
  private readonly memoryDir: string;
  private readonly conversationStore: MarkdownConversationStore;
  private readonly contextAssembler: MarkdownContextAssembler;
  private readonly learningEngine: MarkdownLearningEngine;
  private readonly knowledgeJsonStore: KnowledgeJsonStore;
  private readonly profileStore: ProfileStore;

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir || DEFAULT_MEMORY_DIR;
    ensureDir(this.memoryDir);

    this.conversationStore = new MarkdownConversationStore(this.memoryDir);
    this.learningEngine = new MarkdownLearningEngine(this.memoryDir);
    this.knowledgeJsonStore = new KnowledgeJsonStore(this.memoryDir);
    this.profileStore = new ProfileStore(this.memoryDir);
    this.contextAssembler = new MarkdownContextAssembler(
      this.conversationStore,
      this.knowledgeJsonStore,
    );
  }

  static create(memoryDir?: string): MarkdownMemory {
    return new MarkdownMemory(memoryDir);
  }

  // ── Sub-store accessors ─────────────────────────────────────────────────

  getConversationStore(): MarkdownConversationStore {
    return this.conversationStore;
  }

  getContextAssembler(): MarkdownContextAssembler {
    return this.contextAssembler;
  }

  getLearningEngine(): MarkdownLearningEngine {
    return this.learningEngine;
  }

  getKnowledgeJsonStore(): KnowledgeJsonStore {
    return this.knowledgeJsonStore;
  }

  getProfileStore(): ProfileStore {
    return this.profileStore;
  }

  // ── Convenience methods (matching MemoryV2's API) ───────────────────────

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

  buildContext(input: {
    userId: string;
    conversationId: string;
    messageLimit?: number;
  }): MemoryContextPackage {
    return this.contextAssembler.buildContext(input);
  }

  /**
   * No-op close — no database connections to shut down.
   */
  close(): void {
    // Nothing to close for file-based stores
  }
}

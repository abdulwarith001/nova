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
  MarkdownKnowledgeStore,
  type MemoryItem,
  type UserTrait,
  type AgentTrait,
  type Relationship,
} from "./knowledge-store.js";
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

// Re-export all types
export type {
  MemoryItem,
  UserTrait,
  AgentTrait,
  Relationship,
  StoredMessage,
  ChannelType,
  MessageRole,
  LearningJob,
  MemoryJobType,
  MemoryContextPackage,
};

// Re-export sub-modules
export { MarkdownKnowledgeStore } from "./knowledge-store.js";
export { MarkdownConversationStore } from "./conversation-store.js";
export { MarkdownLearningEngine } from "./learning-engine.js";
export { MarkdownContextAssembler } from "./context-assembler.js";

// ── Default paths ───────────────────────────────────────────────────────────

const DEFAULT_MEMORY_DIR = join(homedir(), ".nova", "memory");

// ── Orchestrator ────────────────────────────────────────────────────────────

export class MarkdownMemory {
  private readonly memoryDir: string;
  private readonly conversationStore: MarkdownConversationStore;
  private readonly knowledgeStore: MarkdownKnowledgeStore;
  private readonly contextAssembler: MarkdownContextAssembler;
  private readonly learningEngine: MarkdownLearningEngine;

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir || DEFAULT_MEMORY_DIR;
    ensureDir(this.memoryDir);

    this.conversationStore = new MarkdownConversationStore(this.memoryDir);
    this.knowledgeStore = new MarkdownKnowledgeStore(this.memoryDir);
    this.learningEngine = new MarkdownLearningEngine(this.memoryDir);
    this.contextAssembler = new MarkdownContextAssembler(
      this.conversationStore,
      this.knowledgeStore,
    );
  }

  static create(memoryDir?: string): MarkdownMemory {
    return new MarkdownMemory(memoryDir);
  }

  // ── Sub-store accessors ─────────────────────────────────────────────────

  getConversationStore(): MarkdownConversationStore {
    return this.conversationStore;
  }

  getKnowledgeStore(): MarkdownKnowledgeStore {
    return this.knowledgeStore;
  }

  getContextAssembler(): MarkdownContextAssembler {
    return this.contextAssembler;
  }

  getLearningEngine(): MarkdownLearningEngine {
    return this.learningEngine;
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
    memoryLimit?: number;
    traitLimit?: number;
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

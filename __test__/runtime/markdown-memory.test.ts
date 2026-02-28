import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MarkdownMemory } from "../../runtime/src/markdown-memory/index";
import {
  KnowledgeJsonStore,
  normalizeText,
  textSimilarity,
} from "../../runtime/src/markdown-memory/knowledge-json-store";

describe("MarkdownMemory", () => {
  let memDir: string;
  let memory: MarkdownMemory;

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), "nova-test-memory-"));
    memory = MarkdownMemory.create(memDir);
  });

  afterEach(() => {
    memory.close();
    rmSync(memDir, { recursive: true, force: true });
  });

  describe("ConversationStore", () => {
    it("creates conversation files and appends messages", () => {
      const conv = memory.getConversationStore();
      conv.addMessage({
        userId: "user-1",
        conversationId: "conv-1",
        role: "user",
        content: "Hello Nova!",
        channel: "ws",
      });

      conv.addMessage({
        userId: "user-1",
        conversationId: "conv-1",
        role: "assistant",
        content: "Hey there! How can I help?",
        channel: "ws",
      });

      const filePath = join(memDir, "conversations", "conv-1.md");
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("Hello Nova!");
      expect(content).toContain("How can I help?");
      expect(content).toContain("**user**");
      expect(content).toContain("**nova**");
    });

    it("retrieves recent messages", () => {
      const conv = memory.getConversationStore();
      conv.addMessage({
        userId: "user-1",
        conversationId: "conv-2",
        role: "user",
        content: "First message",
        channel: "ws",
      });
      conv.addMessage({
        userId: "user-1",
        conversationId: "conv-2",
        role: "assistant",
        content: "First response",
        channel: "ws",
      });

      const messages = conv.getRecentMessages({
        userId: "user-1",
        conversationId: "conv-2",
      });
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages[0].content).toContain("First message");
    });
  });

  describe("KnowledgeJsonStore", () => {
    it("adds and retrieves knowledge entries", () => {
      const store = memory.getKnowledgeJsonStore();
      store.addEntry({
        category: "user_trait",
        subject: "name",
        content: "Abdul",
        importance: 0.95,
        source: "user_explicit",
      });

      store.addEntry({
        category: "preference",
        subject: "editor",
        content: "Prefers dark mode",
        importance: 0.6,
        tags: ["ui", "preference"],
      });

      const essentials = store.getEssentials(0.7);
      expect(essentials.length).toBe(1);
      expect(essentials[0].content).toBe("Abdul");

      const all = store.getAllActive();
      expect(all.length).toBe(2);
    });

    it("searches with improved scoring", () => {
      const store = memory.getKnowledgeJsonStore();
      store.addEntry({
        category: "fact",
        subject: "typescript",
        content: "User likes TypeScript for rapid prototyping",
        tags: ["programming", "typescript"],
        importance: 0.8,
      });

      store.addEntry({
        category: "fact",
        subject: "rust",
        content: "User is learning Rust",
        tags: ["programming", "rust"],
        importance: 0.5,
      });

      const results = store.search("TypeScript prototyping");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].entry.subject).toBe("typescript");
      expect(results[0].score).toBeGreaterThan(0.15);
    });

    it("deduplicates near-duplicate entries via fuzzy matching", () => {
      const store = memory.getKnowledgeJsonStore();

      store.addEntry({
        category: "preference",
        subject: "programming_language",
        content: "User likes TypeScript for rapid prototyping",
        importance: 0.8,
      });

      // Add a near-duplicate
      store.addEntry({
        category: "preference",
        subject: "programming_language",
        content: "The user enjoys TypeScript for rapid prototyping",
        importance: 0.7,
      });

      // Should be merged, not a new entry
      expect(store.count(true)).toBe(1);
      const all = store.getAllActive();
      expect(all[0].importance).toBe(0.8); // kept the higher importance
    });

    it("validates categories and defaults invalid ones to 'fact'", () => {
      const store = memory.getKnowledgeJsonStore();

      store.addEntry({
        category: "invalid_category" as any,
        subject: "test",
        content: "This has an invalid category",
        importance: 0.5,
      });

      const all = store.getAllActive();
      expect(all.length).toBe(1);
      expect(all[0].category).toBe("fact");
    });

    it("supersedes entries with single write", () => {
      const store = memory.getKnowledgeJsonStore();

      const original = store.addEntry({
        category: "user_trait",
        subject: "timezone",
        content: "EST",
        importance: 0.9,
      });

      const superseded = store.supersedeEntry(original.id, {
        content: "WAT",
        confidence: 0.95,
      });

      expect(superseded).not.toBeNull();
      expect(superseded!.supersedes).toBe(original.id);
      expect(superseded!.content).toBe("WAT");

      // Original should be inactive
      const all = store.getAllActive();
      expect(all.length).toBe(1);
      expect(all[0].content).toBe("WAT");
    });

    it("relabels entry categories", () => {
      const store = memory.getKnowledgeJsonStore();

      const entry = store.addEntry({
        category: "fact",
        subject: "user_name",
        content: "Abdul",
        importance: 0.9,
      });

      const updated = store.relabel(entry.id, "user_trait");
      expect(updated).not.toBeNull();
      expect(updated!.category).toBe("user_trait");
    });

    it("stores and retrieves agent traits", () => {
      const store = memory.getKnowledgeJsonStore();

      store.addEntry({
        category: "agent_trait",
        subject: "capability",
        content: "Browser automation with Playwright",
        importance: 0.8,
        source: "system",
      });

      const traits = store.getAgentTraits();
      expect(traits.length).toBe(1);
      expect(traits[0].content).toContain("Playwright");
    });

    it("getUserContext returns user_traits, preferences, and relationships", () => {
      const store = memory.getKnowledgeJsonStore();

      store.addEntry({
        category: "user_trait",
        subject: "name",
        content: "Abdul",
        importance: 0.95,
      });

      store.addEntry({
        category: "preference",
        subject: "dark_mode",
        content: "Prefers dark mode",
        importance: 0.7,
      });

      store.addEntry({
        category: "relationship",
        subject: "colleague",
        content: "Works with Emeka",
        importance: 0.8,
      });

      store.addEntry({
        category: "fact",
        subject: "weather",
        content: "Rain today",
        importance: 0.3,
      });

      const ctx = store.getUserContext(0.6);
      // Should include user_trait, preference, and relationship (>0.6)
      expect(ctx.length).toBe(3);
      // fact with low importance relationship should be excluded
      expect(ctx.find((e) => e.category === "fact")).toBeUndefined();
    });

    it("deduplicateAll merges existing near-duplicates", () => {
      const store = memory.getKnowledgeJsonStore();

      // Add entries that should be detected as near-duplicates
      store.addEntry({
        category: "fact",
        subject: "project",
        content: "Working on Nova AI agent project",
        importance: 0.7,
      });

      // Force a second entry by directly writing (bypass addEntry dedup)
      store.invalidateCache();
      const entries = JSON.parse(
        readFileSync(join(memDir, "knowledge.json"), "utf-8"),
      );
      entries.push({
        id: "k-manual-dup",
        category: "fact",
        subject: "project",
        content: "Working on the Nova AI agent project",
        tags: [],
        importance: 0.6,
        confidence: 0.8,
        source: "conversation",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        supersedes: null,
        active: true,
      });
      writeFileSync(join(memDir, "knowledge.json"), JSON.stringify(entries));
      store.invalidateCache();

      expect(store.count(true)).toBe(2);

      const merged = store.deduplicateAll();
      expect(merged).toBe(1);
      expect(store.count(true)).toBe(1);
    });
  });

  describe("LearningEngine", () => {
    it("enqueues and lists pending jobs", () => {
      const engine = memory.getLearningEngine();
      const id = engine.enqueueJob({
        userId: "user-1",
        conversationId: "conv-1",
        type: "post_turn_extract",
      });

      expect(id).toBeTruthy();

      const jobs = engine.listPendingJobs();
      expect(jobs.length).toBe(1);
      expect(jobs[0].type).toBe("post_turn_extract");
    });

    it("marks jobs completed", () => {
      const engine = memory.getLearningEngine();
      const id = engine.enqueueJob({
        userId: "user-1",
        conversationId: "conv-1",
        type: "post_turn_reflect",
      });

      engine.markProcessing(id);
      engine.markCompleted(id);

      const pending = engine.listPendingJobs();
      expect(pending.length).toBe(0);
    });
  });

  describe("ContextAssembler", () => {
    it("builds context with user knowledge and agent traits", () => {
      const store = memory.getKnowledgeJsonStore();
      store.addEntry({
        category: "user_trait",
        subject: "name",
        content: "Abdul",
        importance: 0.95,
        source: "user_explicit",
      });

      store.addEntry({
        category: "agent_trait",
        subject: "personality",
        content: "Curious and helpful",
        importance: 0.8,
        source: "system",
      });

      const ctx = memory.buildContext({
        userId: "user-1",
        conversationId: "conv-1",
      });

      expect(ctx.assembledSystemPrompt).toContain("Abdul");
      expect(ctx.assembledSystemPrompt).toContain("Curious and helpful");
      expect(ctx.userKnowledge.length).toBeGreaterThanOrEqual(1);
      expect(ctx.agentTraits.length).toBe(1);
    });
  });

  describe("Text Utilities", () => {
    it("normalizeText strips stop words and punctuation", () => {
      const result = normalizeText("The user likes TypeScript!");
      expect(result).toContain("likes");
      expect(result).toContain("typescript");
      expect(result).not.toContain("the");
    });

    it("textSimilarity detects near-duplicates", () => {
      const sim = textSimilarity(
        "User likes TypeScript for rapid prototyping",
        "The user enjoys TypeScript for rapid prototyping",
      );
      expect(sim).toBeGreaterThan(0.5);
    });

    it("textSimilarity returns 0 for unrelated text", () => {
      const sim = textSimilarity(
        "User likes TypeScript",
        "The weather is sunny today",
      );
      expect(sim).toBeLessThan(0.2);
    });
  });
});

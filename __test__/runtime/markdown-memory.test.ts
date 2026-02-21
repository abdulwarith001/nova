import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MarkdownMemory } from "../../runtime/src/markdown-memory/index";

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

  describe("KnowledgeStore", () => {
    it("upserts and reads user traits", () => {
      const knowledge = memory.getKnowledgeStore();
      knowledge.upsertUserTrait("user-1", "name", "Abdul");
      knowledge.upsertUserTrait("user-1", "timezone", "WAT");

      const traits = knowledge.getUserTraits();
      expect(traits.length).toBe(2);
      expect(traits.find((t) => t.key === "name")?.value).toBe("Abdul");
      expect(traits.find((t) => t.key === "timezone")?.value).toBe("WAT");
    });

    it("adds and retrieves memory items", () => {
      const knowledge = memory.getKnowledgeStore();
      knowledge.addMemoryItem("user-1", "fact", "User likes TypeScript", 0.8);
      knowledge.addMemoryItem("user-1", "preference", "Prefers dark mode", 0.6);

      const items = knowledge.getTopMemoryItems("user-1");
      expect(items.length).toBe(2);
      expect(items[0].importance).toBeGreaterThanOrEqual(items[1].importance);
    });

    it("adds and retrieves relationships", () => {
      const knowledge = memory.getKnowledgeStore();
      knowledge.addRelationship("user-1", "Abdul", "works with", "Emeka", 0.9);

      const rels = knowledge.getRelationships("user-1");
      expect(rels.length).toBe(1);
      expect(rels[0].subject).toBe("Abdul");
      expect(rels[0].relation).toBe("works with");
      expect(rels[0].object).toBe("Emeka");
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
    it("builds context with user traits and memories", () => {
      const knowledge = memory.getKnowledgeStore();
      knowledge.upsertUserTrait("user-1", "name", "Abdul");
      knowledge.addMemoryItem("user-1", "fact", "User is a developer", 0.8);

      const ctx = memory.buildContext({
        userId: "user-1",
        conversationId: "conv-1",
      });

      expect(ctx.assembledSystemPrompt).toContain("Abdul");
      expect(ctx.assembledSystemPrompt).toContain("developer");
      expect(ctx.userTraits.length).toBe(1);
      expect(ctx.memoryItems.length).toBe(1);
    });
  });
});

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

  describe("ProfileStore", () => {
    it("creates default profile files", () => {
      const profileStore = memory.getProfileStore();

      const user = profileStore.getUser();
      expect(user).toContain("User Profile");

      const identity = profileStore.getIdentity();
      expect(identity).toContain("Identity");

      const rules = profileStore.getRules();
      expect(rules).toContain("Core Rules");
    });

    it("updates profile files", () => {
      const profileStore = memory.getProfileStore();

      profileStore.updateUser("# Updated User");
      expect(profileStore.getUser()).toBe("# Updated User");

      profileStore.updateIdentity("# Updated Identity");
      expect(profileStore.getIdentity()).toBe("# Updated Identity");

      profileStore.updateRules("# Updated Rules");
      expect(profileStore.getRules()).toBe("# Updated Rules");
    });
  });
});

import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ResearchSessionStore } from "../../runtime/src/research-session-store.js";

describe("ResearchSessionStore", () => {
  it("persists and restores active sessions", () => {
    const rootDir = join(tmpdir(), `nova-research-store-${Date.now()}`);
    mkdirSync(rootDir, { recursive: true });

    try {
      const store = new ResearchSessionStore(rootDir);
      store.upsert("chat-1", {
        topic: "Battery storage trends",
        summary: "Summary",
        lastAnswer: "Answer body",
        keyFindings: ["Finding A"],
        disagreements: [],
        openQuestions: ["What changed in 2026?"],
        followUpQuestions: ["Can you prioritize regulations?"],
        sources: [
          {
            title: "Source A",
            url: "https://example.com/a",
            whyRelevant: "Primary data",
          },
        ],
        confidence: 0.72,
        rounds: 2,
        laneSummary: [
          {
            focusArea: "Regulation",
            pagesVisited: ["https://example.com/a"],
            notableDeviations: [],
          },
        ],
      });

      const restored = new ResearchSessionStore(rootDir).getActive("chat-1");
      expect(restored).toBeDefined();
      expect(restored?.topic).toBe("Battery storage trends");
      expect(restored?.openQuestions).toContain("What changed in 2026?");
      expect(restored?.sources.length).toBe(1);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("expires sessions after ttl", () => {
    const rootDir = join(tmpdir(), `nova-research-ttl-${Date.now()}`);
    mkdirSync(rootDir, { recursive: true });

    try {
      let now = 1_000;
      const store = new ResearchSessionStore(rootDir, {
        ttlMs: 1_000,
        now: () => now,
      });

      store.upsert("chat-ttl", {
        topic: "TTL test",
        summary: "Summary",
        lastAnswer: "Answer",
        keyFindings: [],
        disagreements: [],
        openQuestions: [],
        followUpQuestions: [],
        sources: [],
        confidence: 0.5,
        rounds: 1,
        laneSummary: [],
      });

      expect(store.hasActive("chat-ttl")).toBe(true);
      now = 3_000;
      expect(store.hasActive("chat-ttl")).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("clears session explicitly", () => {
    const rootDir = join(tmpdir(), `nova-research-clear-${Date.now()}`);
    mkdirSync(rootDir, { recursive: true });

    try {
      const store = new ResearchSessionStore(rootDir);
      store.upsert("chat-clear", {
        topic: "Reset test",
        summary: "Summary",
        lastAnswer: "Answer",
        keyFindings: [],
        disagreements: [],
        openQuestions: [],
        followUpQuestions: [],
        sources: [],
        confidence: 0.5,
        rounds: 1,
        laneSummary: [],
      });

      expect(store.hasActive("chat-clear")).toBe(true);
      expect(store.clear("chat-clear")).toBe(true);
      expect(store.hasActive("chat-clear")).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  planChatExecution,
  trimConversationHistory,
  truncateToolContent,
} from "../../gateway/src/chat-speed.js";

describe("planChatExecution", () => {
  it("routes greeting to tool path so agent can decide on tools", () => {
    const plan = planChatExecution("hi there");
    expect(plan.path).toBe("tool");
    expect(plan.maxIterations).toBe(1);
  });

  it("uses tool path with default iteration for explicit search prompt", () => {
    const plan = planChatExecution("search the web for nova ai news", {
      NOVA_CHAT_SPEED_MODE: "turbo",
      NOVA_CHAT_MAX_ITER_DEFAULT: "1",
      NOVA_CHAT_MAX_ITER_COMPLEX: "4",
      NOVA_CHAT_FAST_MAX_TOKENS: "120",
    } as NodeJS.ProcessEnv);
    expect(plan.path).toBe("tool");
    expect(plan.maxIterations).toBe(1);
  });

  it("uses configured default max iteration without regex intent routing", () => {
    const plan = planChatExecution(
      "any prompt",
      {
        NOVA_CHAT_SPEED_MODE: "turbo",
        NOVA_CHAT_MAX_ITER_DEFAULT: "3",
        NOVA_CHAT_MAX_ITER_COMPLEX: "4",
        NOVA_CHAT_FAST_MAX_TOKENS: "120",
      } as NodeJS.ProcessEnv,
    );
    expect(plan.path).toBe("tool");
    expect(plan.maxIterations).toBe(3);
  });
});

describe("trimConversationHistory", () => {
  it("keeps one system message and trims to max non-system messages", () => {
    const history = [
      { role: "system", content: "time context" },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `m-${i}`,
      })),
    ];

    const trimmed = trimConversationHistory(history, 12);
    expect(trimmed[0].role).toBe("system");
    expect(trimmed.length).toBe(13);
    expect(trimmed[1].content).toBe("m-8");
  });
});

describe("truncateToolContent", () => {
  it("truncates oversized tool payloads", () => {
    const input = { value: "a".repeat(2000) };
    const output = truncateToolContent(input, 120);
    expect(output.length).toBeLessThan(300);
    expect(output).toContain("[truncated");
  });
});

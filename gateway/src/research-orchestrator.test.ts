import { describe, expect, it, vi } from "vitest";
import { ResearchOrchestrator } from "./research-orchestrator.js";
import type { ChatHistoryMessage } from "./chat-speed.js";

function buildRuntimeMock() {
  const store = vi.fn().mockResolvedValue(undefined);
  const executeTool = vi.fn().mockResolvedValue({
    results: [
      {
        title: "OpenClaw Project",
        url: "https://example.com/openclaw",
        description: "Project update",
      },
    ],
  });

  return {
    getMemory: () => ({ store }),
    getToolsForAgent: () => [
      {
        name: "search_web",
        description: "Search the web",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ],
    executeTool,
    _store: store,
    _executeTool: executeTool,
  } as any;
}

function baseHistory(): ChatHistoryMessage[] {
  return [
    {
      role: "system",
      content: "Current date and time: 2026-02-16T00:00:00.000Z",
    },
  ];
}

describe("ResearchOrchestrator", () => {
  it("continues after tool call and produces final synthesis", async () => {
    const runtime = buildRuntimeMock();
    const chatWithTools = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            id: "tool_1",
            name: "search_web",
            parameters: { query: "latest openclaw creator news" },
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          answer: "OpenClaw creator recently announced a new release.",
          sources: [
            {
              title: "OpenClaw Project",
              url: "https://example.com/openclaw",
              whyRelevant: "Primary source update",
            },
          ],
          uncertainty: "May change as new updates arrive.",
          confidence: 0.78,
        }),
        usage: { inputTokens: 20, outputTokens: 8 },
      });
    const agent = {
      chatWithTools,
      chat: vi.fn(),
    } as any;

    const orchestrator = new ResearchOrchestrator(runtime, agent, {
      provider: "openai",
      maxIterations: 10,
      toolTimeoutMs: 45000,
      maxSources: 8,
      enableTelemetry: true,
    });

    const result = await orchestrator.runChatTurn({
      message: "what's the latest news on the openclaw creator",
      history: baseHistory(),
      sessionId: "test-session",
    });

    expect(result.success).toBe(true);
    expect(result.response).toContain("OpenClaw creator");
    expect(result.research.sources.length).toBeGreaterThan(0);
    expect(runtime._executeTool).toHaveBeenCalledTimes(1);
    expect(result.metrics.model_calls).toBe(2);
  });

  it("forces final synthesis when loop cap is reached after tool execution", async () => {
    const runtime = buildRuntimeMock();
    const chatWithTools = vi.fn().mockResolvedValue({
      content: "",
      toolCalls: [
        {
          id: "tool_1",
          name: "search_web",
          parameters: { query: "openclaw creator" },
        },
      ],
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const chat = vi.fn().mockResolvedValue(
      JSON.stringify({
        answer: "The OpenClaw creator is discussed in recent project updates.",
        sources: [
          {
            title: "OpenClaw Project",
            url: "https://example.com/openclaw",
            whyRelevant: "Contains creator updates",
          },
        ],
        uncertainty: "Identity details may vary by source.",
        confidence: 0.66,
      }),
    );
    const agent = { chatWithTools, chat } as any;

    const orchestrator = new ResearchOrchestrator(runtime, agent, {
      provider: "openai",
      maxIterations: 1,
      toolTimeoutMs: 45000,
      maxSources: 8,
      enableTelemetry: true,
    });

    const result = await orchestrator.runChatTurn({
      message: "what's the latest news on the openclaw creator",
      history: baseHistory(),
      sessionId: "test-session",
    });

    expect(result.response).not.toBe("I'm sorry, I couldn't complete that request.");
    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.metrics.fallback_reason).toBe(
      "forced_synthesis_after_tool_execution",
    );
  });

  it("runs citation repair when web tools were used but response has no sources", async () => {
    const runtime = buildRuntimeMock();
    const chatWithTools = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            id: "tool_1",
            name: "search_web",
            parameters: { query: "openclaw creator latest" },
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        content: "OpenClaw creator shared a new milestone.",
        usage: { inputTokens: 16, outputTokens: 6 },
      });
    const chat = vi.fn().mockResolvedValue(
      JSON.stringify({
        answer: "OpenClaw creator shared a new milestone in the project update.",
        sources: [
          {
            title: "OpenClaw Project",
            url: "https://example.com/openclaw",
            whyRelevant: "Contains the milestone note",
          },
        ],
        uncertainty: "Based on currently fetched sources.",
        confidence: 0.72,
      }),
    );
    const agent = { chatWithTools, chat } as any;

    const orchestrator = new ResearchOrchestrator(runtime, agent, {
      provider: "openai",
      maxIterations: 5,
      toolTimeoutMs: 45000,
      maxSources: 8,
      enableTelemetry: true,
    });

    const result = await orchestrator.runChatTurn({
      message: "latest news on openclaw creator",
      history: baseHistory(),
      sessionId: "test-session",
    });

    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.research.sources.length).toBeGreaterThan(0);
    expect(result.research.confidence).toBeGreaterThan(0.5);
  });
});

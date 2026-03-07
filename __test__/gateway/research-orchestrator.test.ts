import { describe, expect, it, vi } from "vitest";
import { ResearchOrchestrator } from "../../gateway/src/research-orchestrator.js";
import type { ChatHistoryMessage } from "../../gateway/src/chat-speed.js";
import { ResearchSessionStore } from "../../runtime/src/research-session-store.js";
import { join } from "path";
import { tmpdir } from "os";

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

  const search = vi.fn().mockResolvedValue([]);

  const mockConvStore = {
    addMessage: vi.fn(),
    getRecentMessages: vi.fn().mockReturnValue([]),
    ensureConversation: vi.fn(),
  };

  const mockProfileStore = {
    getUser: vi
      .fn()
      .mockReturnValue("# User Profile\n\n## Basics\n- Name: (unknown)\n"),
    getIdentity: vi.fn().mockReturnValue("# Nova — Identity\n"),
    updateUser: vi.fn(),
    updateIdentity: vi.fn(),
    getPath: vi.fn().mockReturnValue("/mock/path"),
  };

  return {
    getMemory: () => ({ store, search }),
    getMarkdownMemory: () => ({
      getConversationStore: () => mockConvStore,
      getProfileStore: () => mockProfileStore,
    }),
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

function buildSessionStore(testId: string): ResearchSessionStore {
  return new ResearchSessionStore(
    join(tmpdir(), `nova-research-orchestrator-${testId}-${Date.now()}`),
  );
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
      sessionStore: buildSessionStore("synthesis"),
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
      sessionStore: buildSessionStore("forced"),
    });

    const result = await orchestrator.runChatTurn({
      message: "what's the latest news on the openclaw creator",
      history: baseHistory(),
      sessionId: "test-session",
    });

    expect(result.response).not.toContain(
      "I wasn't able to fully resolve that request",
    );
    // 3 OODA calls (observe, orient, decide) + 1 forced synthesis = 4
    expect(chat).toHaveBeenCalledTimes(4);
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
            name: "web_search",
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
        answer:
          "OpenClaw creator shared a new milestone in the project update.",
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
      sessionStore: buildSessionStore("repair"),
    });

    const result = await orchestrator.runChatTurn({
      message: "latest news on openclaw creator",
      history: baseHistory(),
      sessionId: "test-session",
    });

    // 3 OODA calls (observe, orient, decide) + 1 citation repair = 4
    expect(chat).toHaveBeenCalledTimes(4);
    expect(result.research.sources.length).toBeGreaterThan(0);
    expect(result.research.confidence).toBeGreaterThan(0.5);
  });

  it("lets the LLM decide to use deep_research without forced routing", async () => {
    const runtime = buildRuntimeMock();
    const chatWithTools = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            id: "tool_1",
            name: "deep_research",
            parameters: { topic: "battery recycling policy in the EU" },
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          answer: "Battery recycling policy analysis complete.",
          sources: [
            {
              title: "EU Battery Regulation",
              url: "https://example.com/eu-battery",
              whyRelevant: "Primary regulation source",
            },
          ],
          uncertainty: "Based on current proposals.",
          confidence: 0.85,
        }),
        usage: { inputTokens: 20, outputTokens: 8 },
      });
    runtime._executeTool = vi.fn().mockResolvedValue({
      answer: "Deep research result.",
      sources: [
        {
          title: "Source",
          url: "https://example.com",
          whyRelevant: "Evidence",
        },
      ],
      uncertainty: "Low",
      confidence: 0.9,
      keyFindings: ["A"],
      disagreements: [],
      openQuestions: [],
      followUpQuestions: [],
      needsFollowUp: false,
      agentHint: "The research is conclusive.",
      session: {
        sessionId: "test",
        continued: false,
        expiresAt: Date.now() + 1000,
      },
      laneSummary: [],
    });
    runtime.executeTool = runtime._executeTool;

    const agent = {
      chatWithTools,
      chat: vi.fn(),
    } as any;

    const orchestrator = new ResearchOrchestrator(runtime, agent, {
      provider: "openai",
      maxIterations: 5,
      toolTimeoutMs: 45000,
      maxSources: 8,
      enableTelemetry: true,
      sessionStore: buildSessionStore("llm-decides"),
    });

    const result = await orchestrator.runChatTurn({
      message: "Please do deep research on battery recycling policy in the EU",
      history: baseHistory(),
      sessionId: "test-session",
    });

    // The LLM was called to decide (not bypassed)
    expect(chatWithTools).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("returns structured brief content with disagreements and follow-up questions", async () => {
    const runtime = buildRuntimeMock();
    runtime._executeTool = vi
      .fn()
      .mockImplementation(async (toolName: string) => {
        if (toolName === "deep_research") {
          return {
            answer:
              "Research Topic: AI policy\n\nFinal Answer:\nPartially conclusive.\n\nKey Findings:\n- Finding 1\n\nDisagreements:\n- Source A contradicts Source B.\n\nOpen Questions:\n- Which proposal has stronger enforcement data?\n\nSuggested Follow-up Questions:\n- Should I prioritize primary legislation text over commentary?",
            sources: [
              {
                title: "Source A",
                url: "https://example.com/a",
                whyRelevant: "Primary",
              },
            ],
            uncertainty: "Some gaps remain",
            confidence: 0.63,
            keyFindings: ["Finding 1"],
            disagreements: ["Source A contradicts Source B."],
            openQuestions: ["Which proposal has stronger enforcement data?"],
            followUpQuestions: [
              "Should I prioritize primary legislation text over commentary?",
            ],
            needsFollowUp: true,
            agentHint: "The research is not fully conclusive.",
            session: {
              sessionId: "test-session",
              continued: true,
              expiresAt: Date.now() + 1000,
            },
            laneSummary: [],
          };
        }
        return {};
      });
    runtime.executeTool = runtime._executeTool;

    const chatWithTools = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            id: "tool_1",
            name: "deep_research",
            parameters: { topic: "AI policy enforcement outcomes" },
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          answer:
            "Research Topic: AI policy\n\nFinal Answer:\nPartially conclusive.\n\nKey Findings:\n- Finding 1\n\nDisagreements:\n- Source A contradicts Source B.\n\nOpen Questions:\n- Which proposal has stronger enforcement data?\n\nSuggested Follow-up Questions:\n- Should I prioritize primary legislation text over commentary?",
          sources: [
            {
              title: "Source A",
              url: "https://example.com/a",
              whyRelevant: "Primary",
            },
          ],
          uncertainty: "Some gaps remain",
          confidence: 0.63,
        }),
        usage: { inputTokens: 20, outputTokens: 8 },
      });

    const agent = {
      chatWithTools,
      chat: vi.fn().mockResolvedValue(
        JSON.stringify({
          answer: "Partially conclusive AI policy analysis.",
          sources: [
            {
              title: "Source A",
              url: "https://example.com/a",
              whyRelevant: "Primary",
            },
          ],
          uncertainty: "Some gaps remain",
          confidence: 0.63,
        }),
      ),
    } as any;

    const orchestrator = new ResearchOrchestrator(runtime, agent, {
      provider: "openai",
      maxIterations: 5,
      toolTimeoutMs: 45000,
      maxSources: 8,
      enableTelemetry: true,
      sessionStore: buildSessionStore("structured-output"),
    });

    const result = await orchestrator.runChatTurn({
      message: "Investigate AI policy enforcement outcomes",
      history: baseHistory(),
      sessionId: "test-session",
    });

    expect(result.response).toContain("Disagreements:");
    expect(result.response).toContain("Suggested Follow-up Questions:");
  });

  it("injects session context for follow-up turns and does not force routing", async () => {
    const sessionStore = buildSessionStore("followup");
    sessionStore.upsert("test-session", {
      topic: "AI policy",
      summary: "Prior summary",
      lastAnswer: "Prior answer",
      keyFindings: ["A"],
      disagreements: [],
      openQuestions: ["What about cost impact?"],
      followUpQuestions: ["Should we prioritize regulation?"],
      sources: [
        {
          title: "Source A",
          url: "https://example.com/a",
          whyRelevant: "Prior evidence",
        },
      ],
      confidence: 0.6,
      rounds: 1,
      laneSummary: [],
    });

    const runtime = buildRuntimeMock();
    const chatWithTools = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        answer: "Follow-up answer about cost impacts.",
        sources: [
          {
            title: "Source B",
            url: "https://example.com/b",
            whyRelevant: "Cost data",
          },
        ],
        uncertainty: "Low",
        confidence: 0.8,
      }),
      usage: { inputTokens: 20, outputTokens: 8 },
    });
    const agent = {
      chatWithTools,
      chat: vi.fn(),
    } as any;

    const orchestrator = new ResearchOrchestrator(runtime, agent, {
      provider: "openai",
      maxIterations: 3,
      toolTimeoutMs: 45000,
      maxSources: 8,
      enableTelemetry: true,
      sessionStore,
    });

    await orchestrator.runChatTurn({
      message: "what about downstream cost impacts?",
      history: baseHistory(),
      sessionId: "test-session",
    });

    // LLM was called (not bypassed by forced routing)
    expect(chatWithTools).toHaveBeenCalled();

    // Session context was injected as a system message
    const firstCallMessages = chatWithTools.mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    const hasSessionContext = firstCallMessages.some(
      (message) =>
        message.role === "system" &&
        message.content.includes("[Research context]") &&
        message.content.includes("AI policy"),
    );
    expect(hasSessionContext).toBe(true);
  });
});

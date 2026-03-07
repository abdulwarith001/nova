import { describe, expect, it, vi } from "vitest";
import { ResearchLanePlanner } from "../../runtime/src/research-agent/lane-planner.js";

function buildMockLLM() {
  return vi.fn(async (prompt: string) => {
    // Return a valid lane decomposition for any topic
    return JSON.stringify({
      lanes: [
        {
          focusArea: "policy timeline",
          objective: "Investigate the chronological development of policies",
          seedQueries: [
            "AI regulation Europe timeline 2024 2025",
            "EU AI Act implementation schedule",
          ],
          watchFor: ["Key dates", "Legislative milestones"],
        },
        {
          focusArea: "enforcement impact",
          objective:
            "Investigate enforcement mechanisms and their real-world impact",
          seedQueries: [
            "EU AI Act enforcement penalties cases",
            "AI regulation enforcement outcomes Europe",
          ],
          watchFor: ["Penalty amounts", "Compliance rates"],
        },
        {
          focusArea: "industry response",
          objective: "Investigate how companies are responding to regulations",
          seedQueries: [
            "tech companies AI regulation compliance Europe",
            "industry lobbying EU AI Act",
          ],
          watchFor: ["Corporate statements", "Compliance investments"],
        },
        {
          focusArea: "expert perspectives",
          objective:
            "Investigate expert and academic analysis of the regulation",
          seedQueries: [
            "AI regulation experts analysis effectiveness",
            "academic research EU AI Act impact",
          ],
          watchFor: ["Expert opinions", "Research findings"],
        },
      ],
    });
  });
}

describe("ResearchLanePlanner", () => {
  it("creates unique focus lanes with 3-5 target pages each", async () => {
    const searchFn = async (query: string) => {
      const q = encodeURIComponent(query);
      return [
        { title: "A", url: `https://source.example.com/${q}/a`, snippet: "x" },
        { title: "B", url: `https://source.example.com/${q}/b`, snippet: "x" },
        { title: "C", url: `https://source.example.com/${q}/c`, snippet: "x" },
        { title: "D", url: `https://source.example.com/${q}/d`, snippet: "x" },
      ];
    };

    const planner = new ResearchLanePlanner(searchFn, buildMockLLM());

    const lanes = await planner.planLanes({
      topic: "AI regulation in Europe",
      focusHints: ["policy timeline", "enforcement impact"],
      unresolvedQuestions: [],
      subAgentCount: 4,
    });

    expect(lanes).toHaveLength(4);
    const focusSet = new Set(lanes.map((lane) => lane.focusArea.toLowerCase()));
    expect(focusSet.size).toBe(4);
    for (const lane of lanes) {
      expect(lane.targetPages.length).toBeGreaterThanOrEqual(3);
      expect(lane.targetPages.length).toBeLessThanOrEqual(5);
    }
  });

  it("uses LLM-generated seed queries instead of templates", async () => {
    const mockLLM = buildMockLLM();
    const searchCalls: string[] = [];
    const searchFn = async (query: string) => {
      searchCalls.push(query);
      return [
        {
          title: "A",
          url: `https://example.com/${encodeURIComponent(query)}/a`,
          snippet: "x",
        },
        {
          title: "B",
          url: `https://example.com/${encodeURIComponent(query)}/b`,
          snippet: "x",
        },
      ];
    };

    const planner = new ResearchLanePlanner(searchFn, mockLLM);
    await planner.planLanes({
      topic: "AI regulation in Europe",
      focusHints: [],
      unresolvedQuestions: [],
      subAgentCount: 2,
    });

    // Verify LLM was called for decomposition
    expect(mockLLM).toHaveBeenCalled();
    const llmPrompt = mockLLM.mock.calls[0][0] as string;
    expect(llmPrompt).toContain("AI regulation in Europe");
    expect(llmPrompt).toContain("orthogonal");

    // Verify search queries came from LLM output, not templates
    const hasLLMQuery = searchCalls.some(
      (q) =>
        q.includes("EU AI Act") ||
        q.includes("enforcement") ||
        q.includes("timeline"),
    );
    expect(hasLLMQuery).toBe(true);
  });

  it("deduplicates overlapping primary pages instead of throwing", async () => {
    const mockLLM = buildMockLLM();
    const planner = new ResearchLanePlanner(async () => [], mockLLM);

    // This should NOT throw — it should deduplicate
    const lanes = [
      {
        id: "lane-1",
        focusArea: "f1",
        objective: "o",
        seedQueries: [],
        targetPages: [
          "https://same.example.com/a",
          "https://unique.example.com/b",
        ],
        watchFor: [],
        requiredActions: [],
      },
      {
        id: "lane-2",
        focusArea: "f2",
        objective: "o",
        seedQueries: [],
        targetPages: [
          "https://same.example.com/a",
          "https://unique.example.com/c",
        ],
        watchFor: [],
        requiredActions: [],
      },
    ];

    // Access private method to test deduplication
    (planner as any).deduplicatePrimaryPages(lanes);

    // Lane 2's primary should have shifted to avoid overlap
    expect(lanes[1].targetPages[0]).toBe("https://unique.example.com/c");
  });

  it("falls back to heuristic when LLM fails", async () => {
    const failingLLM = vi.fn(async () => {
      throw new Error("LLM unavailable");
    });
    const searchFn = async (query: string) => {
      const q = encodeURIComponent(query);
      return [
        {
          title: "A",
          url: `https://fallback.example.com/${q}/a`,
          snippet: "x",
        },
        {
          title: "B",
          url: `https://fallback.example.com/${q}/b`,
          snippet: "x",
        },
        {
          title: "C",
          url: `https://fallback.example.com/${q}/c`,
          snippet: "x",
        },
      ];
    };

    const planner = new ResearchLanePlanner(searchFn, failingLLM);
    const lanes = await planner.planLanes({
      topic: "Test topic",
      focusHints: [],
      unresolvedQuestions: [],
      subAgentCount: 2,
    });

    // Should still produce lanes via heuristic fallback
    expect(lanes).toHaveLength(2);
    expect(lanes[0].focusArea).toBeTruthy();
  });
});

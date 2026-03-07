import { describe, expect, it, vi } from "vitest";
import { DeepResearchCoordinator } from "../../runtime/src/research-agent/coordinator.js";
import { ResearchSessionStore } from "../../runtime/src/research-session-store.js";
import { join } from "path";
import { tmpdir } from "os";

function buildLane(index: number) {
  return {
    id: `lane-${index + 1}`,
    focusArea: `focus-${index + 1}`,
    objective: `objective-${index + 1}`,
    seedQueries: [`query-${index + 1}`],
    targetPages: [
      `https://lane${index + 1}.example.com/a`,
      `https://lane${index + 1}.example.com/b`,
    ],
    watchFor: ["claims"],
    requiredActions: ["visit pages"],
  };
}

function buildSessionStore(testId: string): ResearchSessionStore {
  return new ResearchSessionStore(
    join(tmpdir(), `nova-research-coordinator-${testId}-${Date.now()}`),
  );
}

describe("DeepResearchCoordinator", () => {
  it("runs up to 4 lanes in parallel and waits for all reports", async () => {
    let concurrentScrapes = 0;
    let maxConcurrentScrapes = 0;

    const runtime = {
      executeTool: vi.fn(async (name: string, params: any) => {
        if (name === "web_search") return { results: [] };
        if (name === "scrape") {
          concurrentScrapes++;
          maxConcurrentScrapes = Math.max(
            maxConcurrentScrapes,
            concurrentScrapes,
          );
          await new Promise((resolve) => setTimeout(resolve, 35));
          concurrentScrapes--;
          return {
            url: params.url,
            title: `Title ${params.url}`,
            content: `Evidence from ${params.url}`,
          };
        }
        return {};
      }),
    } as any;

    const synthesisResponse = JSON.stringify({
      answer: "Conclusive answer.",
      confidence: 0.9,
      keyFindings: ["finding"],
      disagreements: [],
      openQuestions: [],
      followUpQuestions: [],
    });

    const agent = {
      chat: vi.fn(async (prompt: string) => {
        if (prompt.includes("evaluating evidence quality")) {
          return JSON.stringify({
            needsMore: false,
            reason: "Evidence is sufficient",
          });
        }
        if (prompt.includes("focused research sub-agent")) {
          return JSON.stringify({
            summary: "Lane summary",
            keyFindings: ["lane finding"],
            openQuestions: [],
            notableDeviations: [],
            confidence: 0.8,
          });
        }
        if (prompt.includes("lead research branch")) {
          return JSON.stringify({
            summary: "Main branch summary",
            keyFindings: ["main finding"],
            openQuestions: [],
            confidence: 0.8,
          });
        }
        return synthesisResponse;
      }),
    } as any;

    const planner = {
      planLanes: vi.fn(async () => [0, 1, 2, 3].map((i) => buildLane(i))),
    } as any;

    const store = buildSessionStore("parallel");

    const coordinator = new DeepResearchCoordinator({
      runtime,
      agent,
      planner,
      sessionStore: store,
    });

    const result = await coordinator.runDeepResearch({
      topic: "Parallel lane test",
      subAgentCount: 4,
      maxRounds: 1,
    });

    expect(result.laneSummary).toHaveLength(4);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(maxConcurrentScrapes).toBeGreaterThan(1);
  });

  it("runs second round only when first round is inconclusive", async () => {
    const runtime = {
      executeTool: vi.fn(async (name: string, params: any) => {
        if (name === "web_search") return { results: [] };
        if (name === "scrape") {
          return {
            url: params.url,
            title: `Title ${params.url}`,
            content: `Evidence from ${params.url}`,
          };
        }
        return {};
      }),
    } as any;

    let synthesisCount = 0;
    const agent = {
      chat: vi.fn(async (prompt: string) => {
        if (prompt.includes("evaluating evidence quality")) {
          return JSON.stringify({
            needsMore: false,
            reason: "Evidence is sufficient",
          });
        }
        if (prompt.includes("focused research sub-agent")) {
          return JSON.stringify({
            summary: "Lane summary",
            keyFindings: ["lane finding"],
            openQuestions: [],
            notableDeviations: [],
            confidence: 0.7,
          });
        }
        if (prompt.includes("lead research branch")) {
          return JSON.stringify({
            summary: "Main branch summary",
            keyFindings: ["main finding"],
            openQuestions: [],
            confidence: 0.7,
          });
        }
        synthesisCount++;
        if (synthesisCount === 1) {
          return JSON.stringify({
            answer: "Need more evidence",
            confidence: 0.55,
            keyFindings: ["partial"],
            disagreements: ["conflict"],
            openQuestions: ["What changed in 2026?"],
            followUpQuestions: [],
          });
        }
        return JSON.stringify({
          answer: "Conclusive now",
          confidence: 0.88,
          keyFindings: ["resolved"],
          disagreements: [],
          openQuestions: [],
          followUpQuestions: [],
        });
      }),
    } as any;

    const planner = {
      planLanes: vi.fn(async () => [buildLane(0), buildLane(1)]),
    } as any;

    const coordinator = new DeepResearchCoordinator({
      runtime,
      agent,
      planner,
      sessionStore: buildSessionStore("round-two"),
    });

    const result = await coordinator.runDeepResearch({
      topic: "Round behavior test",
      maxRounds: 2,
    });

    expect(planner.planLanes).toHaveBeenCalledTimes(2);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.needsFollowUp).toBe(false);
  });

  it("stops after one round when evidence is conclusive", async () => {
    const runtime = {
      executeTool: vi.fn(async (name: string, params: any) => {
        if (name === "web_search") return { results: [] };
        if (name === "scrape") {
          return {
            url: params.url,
            title: `Title ${params.url}`,
            content: `Evidence from ${params.url}`,
          };
        }
        return {};
      }),
    } as any;

    const agent = {
      chat: vi.fn(async (prompt: string) => {
        if (prompt.includes("evaluating evidence quality")) {
          return JSON.stringify({
            needsMore: false,
            reason: "Evidence is sufficient",
          });
        }
        if (prompt.includes("focused research sub-agent")) {
          return JSON.stringify({
            summary: "Lane summary",
            keyFindings: ["lane finding"],
            openQuestions: [],
            notableDeviations: [],
            confidence: 0.8,
          });
        }
        if (prompt.includes("lead research branch")) {
          return JSON.stringify({
            summary: "Main branch summary",
            keyFindings: ["main finding"],
            openQuestions: [],
            confidence: 0.8,
          });
        }
        return JSON.stringify({
          answer: "Conclusive in first round",
          confidence: 0.9,
          keyFindings: ["resolved"],
          disagreements: [],
          openQuestions: [],
          followUpQuestions: [],
        });
      }),
    } as any;

    const planner = {
      planLanes: vi.fn(async () => [buildLane(0), buildLane(1)]),
    } as any;

    const coordinator = new DeepResearchCoordinator({
      runtime,
      agent,
      planner,
      sessionStore: buildSessionStore("round-one"),
    });

    await coordinator.runDeepResearch({
      topic: "Conclusive test",
      maxRounds: 2,
    });

    expect(planner.planLanes).toHaveBeenCalledTimes(1);
  });
});

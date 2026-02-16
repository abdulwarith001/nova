import { describe, expect, it } from "vitest";
import { ReasoningEngine } from "../src/reasoning/reasoning-engine.js";

const tools = [
  {
    name: "bash",
    description: "Execute shell commands",
    keywords: ["command", "shell", "run"],
  },
  {
    name: "read",
    description: "Read file contents",
    keywords: ["file", "read"],
  },
];

describe("ReasoningEngine", () => {
  it("selects tools using heuristic mode", async () => {
    const engine = new ReasoningEngine(undefined, { mode: "fast" });
    const observation = await engine.observe({
      task: "read a file",
      history: [],
      tools,
    });
    const orientation = await engine.orient(observation);
    const decision = await engine.decide(orientation, observation);

    expect(decision.selectedTools.length).toBeGreaterThan(0);
    expect(decision.selectedTools[0].name).toBe("read");
  });

  it("selectTools returns an OODA state with selected tools", async () => {
    const engine = new ReasoningEngine(undefined, { mode: "fast" });
    const state = await engine.selectTools("read a file", tools);

    expect(state.observe.task).toBe("read a file");
    expect(state.decide.selectedTools.length).toBeGreaterThan(0);
    expect(state.decide.selectedTools[0].name).toBe("read");
  });
});

import { describe, expect, it } from "vitest";
import { ChainOfThought } from "../../agent/src/reasoning/chain-of-thought.js";

class FakeLLM {
  private response: string;
  constructor(response: string) {
    this.response = response;
  }
  async chat() {
    return this.response;
  }
}

describe("ChainOfThought", () => {
  it("parses valid reasoning output", async () => {
    const response = JSON.stringify({
      steps: [
        {
          type: "observation",
          content: "User wants to read a file.",
          confidence: 0.7,
        },
        {
          type: "conclusion",
          content: "Use read tool.",
          confidence: 0.8,
        },
      ],
      decision: {
        toolNames: ["read"],
        rationale: "Reading is required.",
        fallback: "Use bash to cat the file.",
      },
      confidence: 0.75,
      risks: [],
    });

    const chain = new ChainOfThought(new FakeLLM(response));
    const result = await chain.buildChain("read a file", {
      task: "read a file",
      memoryContext: "",
      observation: {
        task: "read a file",
        availableTools: [{ name: "read", description: "Read file" }],
        constraints: { maxTools: 5 },
        notes: [],
      },
      orientation: {
        intent: "read a file",
        candidates: [],
        confidence: 0.6,
        risks: [],
      },
      tools: [{ name: "read", description: "Read file" }],
    });

    const validation = chain.validate(result);
    expect(validation.ok).toBe(true);
    expect(result.decision.toolNames).toContain("read");
  });

  it("falls back on invalid output", async () => {
    const chain = new ChainOfThought(new FakeLLM("not json"));
    const result = await chain.buildChain("do something", {
      task: "do something",
      observation: {
        task: "do something",
        availableTools: [],
        constraints: { maxTools: 5 },
        notes: [],
      },
      orientation: {
        intent: "do something",
        candidates: [],
        confidence: 0.2,
        risks: [],
      },
      tools: [],
    });

    expect(result.decision.toolNames.length).toBe(0);
  });
});

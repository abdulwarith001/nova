import { describe, expect, it } from "vitest";
import { ToolSelector } from "../../runtime/src/tool-selector.js";

const tools = [
  {
    name: "read",
    description: "Read files",
    parametersSchema: {},
    permissions: [],
  },
  {
    name: "bash",
    description: "Run shell commands",
    parametersSchema: {},
    permissions: [],
  },
];

describe("ToolSelector", () => {
  it("respects reasoning tool order", async () => {
    const selector = new ToolSelector();
    const result = await selector.selectToolsWithReasoning("read", tools, {
      reasoning: {
        toolNames: ["read"],
        rationale: "Need to read a file",
        confidence: 0.9,
      },
    });

    expect(result.tools[0].name).toBe("read");
  });
});

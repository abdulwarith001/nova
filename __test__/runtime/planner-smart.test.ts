import { describe, it, expect, vi } from "vitest";
import { Planner } from "../../runtime/src/planner";
import type { Task } from "../../runtime/src/index";

describe("Planner", () => {
  it("generates a sequential plan when no LLM is provided", async () => {
    const planner = new Planner();
    const task: Task = {
      id: "t1",
      description: "Simple task",
      toolCalls: [
        { toolName: "tool1", parameters: {} },
        { toolName: "tool2", parameters: {} },
      ],
    };

    const plan = await planner.plan(task);
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[0].id).toBe("step-0");
    expect(plan.steps[1].id).toBe("step-1");
    expect(plan.steps[1].dependencies).toEqual([]);
  });

  it("detects dependencies using the provided LLM chat function", async () => {
    const mockChat = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify([{ stepId: "step-1", dependsOn: ["step-0"] }]),
      );
    const planner = new Planner(mockChat);
    const task: Task = {
      id: "t2",
      description: "Search then scrape",
      toolCalls: [
        { toolName: "web_search", parameters: { query: "news" } },
        { toolName: "scrape", parameters: { url: "{{step-0.result.url}}" } },
      ],
    };

    const plan = await planner.plan(task);
    expect(mockChat).toHaveBeenCalled();
    expect(plan.steps[1].dependencies).toContain("step-0");
  });

  it("falls back to sequential execution if LLM fails", async () => {
    const mockChat = vi.fn().mockRejectedValue(new Error("LLM Down"));
    const planner = new Planner(mockChat);
    const task: Task = {
      id: "t3",
      description: "Fallback test",
      toolCalls: [
        { toolName: "a", parameters: {} },
        { toolName: "b", parameters: {} },
      ],
    };

    const plan = await planner.plan(task);
    expect(plan.steps[1].dependencies).toContain("step-0"); // Sequential fallback
  });
});

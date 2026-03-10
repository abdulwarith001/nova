import { describe, expect, it } from "vitest";
import { WebAgentOrchestrator } from "../../runtime/src/web-agent/orchestrator.js";
import { WebWorldModel } from "../../runtime/src/web-agent/world-model.js";
import type { WebObservation } from "../../runtime/src/web-agent/contracts.js";

describe("WebAgentOrchestrator", () => {
  const orchestrator = new WebAgentOrchestrator();

  function makeObservation(
    overrides?: Partial<WebObservation>,
  ): WebObservation {
    return {
      url: "https://example.com",
      title: "Example",
      domSummary: "headings=2, interactive_elements=5, text_chars=1000",
      visibleText: "Some page content ".repeat(100),
      elements: [],
      timestamp: new Date().toISOString(),
      ...overrides,
    };
  }

  describe("decideNext", () => {
    it("navigates when goal has explicit URL and no observation", async () => {
      const wm = new WebWorldModel("s1");
      const decision = await orchestrator.decideNext({
        goal: "Go to https://example.com and check",
        worldModel: wm,
      });
      expect(decision.action.type).toBe("navigate");
      expect(decision.action.url).toBe("https://example.com");
      expect(decision.risk).toBe("low");
    });

    it("searches when goal has no URL and no observation", async () => {
      const wm = new WebWorldModel("s1");
      const decision = await orchestrator.decideNext({
        goal: "find latest AI news",
        worldModel: wm,
      });
      expect(decision.action.type).toBe("search");
      expect(decision.action.value).toBe("find latest AI news");
    });

    it("clicks when goal says click", async () => {
      const wm = new WebWorldModel("s1");
      const decision = await orchestrator.decideNext({
        goal: 'click "Submit"',
        observation: makeObservation(),
        worldModel: wm,
      });
      expect(decision.action.type).toBe("click");
      expect(decision.action.target?.text).toBe("Submit");
    });

    it("fills when goal says fill", async () => {
      const wm = new WebWorldModel("s1");
      const decision = await orchestrator.decideNext({
        goal: 'fill "hello world"',
        observation: makeObservation(),
        worldModel: wm,
      });
      expect(decision.action.type).toBe("fill");
      expect(decision.action.value).toBe("hello world");
    });

    it("scrolls when goal says scroll and text is short", async () => {
      const wm = new WebWorldModel("s1");
      const decision = await orchestrator.decideNext({
        goal: "scroll down to see more",
        observation: makeObservation({ visibleText: "short" }),
        worldModel: wm,
      });
      expect(decision.action.type).toBe("scroll");
    });

    it("extracts as default action", async () => {
      const wm = new WebWorldModel("s1");
      const decision = await orchestrator.decideNext({
        goal: "what is on this page",
        observation: makeObservation(),
        worldModel: wm,
      });
      expect(decision.action.type).toBe("extract");
    });
  });

  describe("extractQuotedTarget", () => {
    it("extracts double-quoted text", () => {
      const result = (orchestrator as any).extractQuotedTarget(
        'click "Buy Now"',
      );
      expect(result).toBe("Buy Now");
    });

    it("extracts single-quoted text", () => {
      const result = (orchestrator as any).extractQuotedTarget(
        "click 'Submit'",
      );
      expect(result).toBe("Submit");
    });

    it("returns null when no quotes", () => {
      const result = (orchestrator as any).extractQuotedTarget("click button");
      expect(result).toBeNull();
    });
  });
});

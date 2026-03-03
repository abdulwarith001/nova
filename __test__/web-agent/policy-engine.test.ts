import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../../runtime/src/web-agent/policy-engine.js";
import { signApprovalToken } from "../../runtime/src/web-agent/approval.js";
import type { WebAction } from "../../runtime/src/web-agent/contracts.js";

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  describe("classifyRisk", () => {
    it("submit → high", () => {
      expect(engine.classifyRisk({ type: "submit" })).toBe("high");
    });

    it("click with buy keyword → high", () => {
      expect(
        engine.classifyRisk({ type: "click", target: { text: "Buy now" } }),
      ).toBe("high");
    });

    it("click with delete keyword → high", () => {
      expect(
        engine.classifyRisk({
          type: "click",
          target: { text: "Delete account" },
        }),
      ).toBe("high");
    });

    it("click without keywords → medium", () => {
      expect(
        engine.classifyRisk({ type: "click", target: { text: "Learn more" } }),
      ).toBe("medium");
    });

    it("fill → medium", () => {
      expect(engine.classifyRisk({ type: "fill", value: "hello" })).toBe(
        "medium",
      );
    });

    it.each(["navigate", "search", "extract", "scroll", "wait"] as const)(
      "%s → low",
      (type) => {
        expect(engine.classifyRisk({ type })).toBe("low");
      },
    );
  });

  describe("evaluate", () => {
    it("returns PolicyDecision with digest", () => {
      const action: WebAction = { type: "navigate", url: "https://a.com" };
      const decision = engine.evaluate(action);
      expect(decision.risk).toBe("low");
      expect(decision.needsConfirmation).toBe(false);
      expect(decision.actionDigest).toMatch(/^[a-f0-9]{64}$/);
    });

    it("high-risk requires confirmation", () => {
      const action: WebAction = { type: "submit" };
      const decision = engine.evaluate(action);
      expect(decision.risk).toBe("high");
      expect(decision.needsConfirmation).toBe(true);
    });
  });

  describe("assertAllowed", () => {
    it("low-risk passes without token", () => {
      const action: WebAction = { type: "navigate", url: "https://a.com" };
      const result = engine.assertAllowed(action, "session-1");
      expect(result.risk).toBe("low");
    });

    it("high-risk without token throws CONFIRMATION_REQUIRED", () => {
      const action: WebAction = { type: "submit" };
      expect(() => engine.assertAllowed(action, "session-1")).toThrowError(
        /CONFIRMATION_REQUIRED/,
      );
    });

    it("high-risk with valid token passes", () => {
      const action: WebAction = { type: "submit" };
      const digest = engine.evaluate(action).actionDigest;
      const token = signApprovalToken("session-1", digest);
      const result = engine.assertAllowed(action, "session-1", token);
      expect(result.risk).toBe("high");
    });
  });
});

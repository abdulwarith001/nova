import type { RiskLevel, WebAction } from "./contracts.js";
import { computeActionDigest, verifyApprovalToken } from "./approval.js";

export interface PolicyDecision {
  risk: RiskLevel;
  needsConfirmation: boolean;
  reason: string;
  actionDigest: string;
}

const HIGH_RISK_KEYWORDS = [
  "buy",
  "purchase",
  "order",
  "confirm",
  "delete",
  "remove",
  "send",
  "publish",
  "transfer",
  "save",
  "submit",
];

export class PolicyEngine {
  classifyRisk(action: WebAction): RiskLevel {
    if (action.type === "submit") return "high";

    if (action.type === "click") {
      const targetText = `${action.target?.text || ""} ${action.target?.css || ""}`
        .toLowerCase()
        .trim();
      if (HIGH_RISK_KEYWORDS.some((word) => targetText.includes(word))) {
        return "high";
      }
      return "medium";
    }

    if (action.type === "fill") return "medium";
    if (action.type === "navigate" || action.type === "search") return "low";
    if (action.type === "extract" || action.type === "scroll" || action.type === "wait") {
      return "low";
    }

    return "medium";
  }

  evaluate(action: WebAction): PolicyDecision {
    const risk = this.classifyRisk(action);
    const actionDigest = computeActionDigest(action);
    const needsConfirmation = risk === "high";

    return {
      risk,
      needsConfirmation,
      reason: needsConfirmation
        ? "High-risk action requires human confirmation token"
        : "Action allowed",
      actionDigest,
    };
  }

  assertAllowed(action: WebAction, sessionId: string, token?: string): PolicyDecision {
    const decision = this.evaluate(action);
    if (!decision.needsConfirmation) return decision;

    if (!token || !verifyApprovalToken(sessionId, decision.actionDigest, token)) {
      throw new Error(
        `CONFIRMATION_REQUIRED:${JSON.stringify({
          sessionId,
          actionDigest: decision.actionDigest,
          commandHint: `nova web approve ${sessionId} ${decision.actionDigest}`,
        })}`,
      );
    }

    return decision;
  }
}

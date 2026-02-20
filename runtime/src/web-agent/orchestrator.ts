import type {
  ActionDecision,
  ObservationMode,
  WebAction,
  WebObservation,
} from "./contracts.js";
import { extractExplicitUrls } from "./url-utils.js";
import { PolicyEngine } from "./policy-engine.js";
import { WebWorldModel } from "./world-model.js";

export class WebAgentOrchestrator {
  constructor(private readonly policyEngine = new PolicyEngine()) {}

  decideNext(params: {
    goal: string;
    observation?: WebObservation;
    worldModel: WebWorldModel;
    mode?: ObservationMode;
  }): ActionDecision {
    const goal = String(params.goal || "").trim();
    params.worldModel.setGoal(goal);

    const explicitUrls = extractExplicitUrls(goal);
    let action: WebAction;
    let reason = "";

    if (!params.observation) {
      if (explicitUrls.length > 0) {
        action = { type: "navigate", url: explicitUrls[0] };
        reason = "Goal contains an explicit URL; open it first.";
      } else {
        action = { type: "search", value: goal, options: { limit: 8 } };
        reason = "No URL provided; search the web first.";
      }
      return this.withPolicy(action, reason);
    }

    const lowerGoal = goal.toLowerCase();
    if (
      lowerGoal.includes("click") ||
      lowerGoal.includes("press") ||
      lowerGoal.includes("tap")
    ) {
      const targetText = this.extractQuotedTarget(goal) || "continue";
      action = {
        type: "click",
        target: { text: targetText },
      };
      reason = "User requested interaction; click inferred target.";
      return this.withPolicy(action, reason);
    }

    if (lowerGoal.includes("fill") || lowerGoal.includes("type")) {
      action = {
        type: "fill",
        target: { role: "textbox" },
        value: this.extractQuotedTarget(goal) || "",
      };
      reason = "User requested form input; fill likely textbox.";
      return this.withPolicy(action, reason);
    }

    if (lowerGoal.includes("scroll") && params.observation.visibleText.length < 4000) {
      action = { type: "scroll", options: { deltaY: 1200 } };
      reason = "Need more visible content; scrolling the page.";
      return this.withPolicy(action, reason);
    }

    action = { type: "extract", options: { mode: params.mode || "dom+vision" } };
    reason = "Default to extracting structured and visible content for answer synthesis.";
    return this.withPolicy(action, reason);
  }

  private withPolicy(action: WebAction, reason: string): ActionDecision {
    const policy = this.policyEngine.evaluate(action);
    return {
      action,
      reason,
      risk: policy.risk,
      needsConfirmation: policy.needsConfirmation,
    };
  }

  private extractQuotedTarget(goal: string): string | null {
    const match = goal.match(/["']([^"']+)["']/);
    if (!match?.[1]) return null;
    return match[1].trim();
  }
}

import type {
  ActionDecision,
  ObservationMode,
  WebAction,
  WebObservation,
} from "./contracts.js";
import { extractExplicitUrls } from "./url-utils.js";
import { PolicyEngine } from "./policy-engine.js";
import { WebWorldModel } from "./world-model.js";
import type { ReasoningEngine } from "../../../agent/src/reasoning/index.js";

export class WebAgentOrchestrator {
  constructor(
    private readonly reasoningEngine?: ReasoningEngine,
    private readonly policyEngine = new PolicyEngine(),
  ) {}

  async decideNext(params: {
    goal: string;
    observation?: WebObservation;
    worldModel: WebWorldModel;
    mode?: ObservationMode;
    history?: string[];
    identity?: string;
    rules?: string[];
  }): Promise<ActionDecision> {
    const goal = String(params.goal || "").trim();
    params.worldModel.setGoal(goal);

    const explicitUrls = extractExplicitUrls(goal);

    // 1. Initial State: No observation yet
    if (!params.observation) {
      let action: WebAction;
      let reason = "";
      if (explicitUrls.length > 0) {
        action = { type: "navigate", url: explicitUrls[0] };
        reason = "Goal contains an explicit URL; open it first.";
      } else {
        action = { type: "search", value: goal, options: { limit: 8 } };
        reason = "No URL provided; search the web first.";
      }
      return this.withPolicy(action, reason);
    }

    // 2. Agentic Reasoning (Primary)
    if (this.reasoningEngine) {
      try {
        const oodaResult = await this.reasoningEngine.runWebOODA({
          goal,
          observationSnippet:
            params.observation.domSummary ||
            params.observation.visibleText.slice(0, 5000),
          history: params.history,
          identity: params.identity,
          rules: params.rules,
        });

        if (oodaResult.decision.confidence > 0.4) {
          return this.withPolicy(
            oodaResult.decision.action as WebAction,
            oodaResult.decision.rationale,
          );
        }
      } catch (error) {
        console.warn(
          `⚠️ Web Agent reasoning failed, falling back to heuristics: ${error}`,
        );
      }
    }

    // 3. Heuristic Fallback (Legacy)
    const lowerGoal = goal.toLowerCase();
    let action: WebAction;
    let reason = "";

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
    } else if (lowerGoal.includes("fill") || lowerGoal.includes("type")) {
      action = {
        type: "fill",
        target: { role: "textbox" },
        value: this.extractQuotedTarget(goal) || "",
      };
      reason = "User requested form input; fill likely textbox.";
    } else if (
      lowerGoal.includes("scroll") &&
      params.observation.visibleText.length < 4000
    ) {
      action = { type: "scroll", options: { deltaY: 1200 } };
      reason = "Need more visible content; scrolling the page.";
    } else {
      action = {
        type: "extract",
        options: { mode: params.mode || "dom+vision" },
      };
      reason = "Defaulting to extraction for goal synthesis.";
    }

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

import type { ExecutionPlan } from "./executor";

export interface SecurityConfig {
  allowedTools: string[];
  deniedTools: string[];
  protectedKeywords?: string[]; // Keywords that trigger HitL confirmation
}

/**
 * Security manager with capability-based permissions and HitL confirmation.
 */
export class SecurityManager {
  private config: SecurityConfig;

  constructor(config: SecurityConfig) {
    this.config = {
      protectedKeywords: [
        "delete",
        "buy",
        "purchase",
        "submit",
        "order",
        "remove",
        "kill",
        "cancel",
      ],
      ...config,
    };
  }

  /**
   * Authorize an execution plan
   */
  authorize(plan: ExecutionPlan): void {
    const allowAll = this.config.allowedTools.includes("*");
    for (const step of plan.steps) {
      // Check if tool is allowed
      if (
        this.config.allowedTools.length > 0 &&
        !allowAll &&
        !this.config.allowedTools.includes(step.toolName)
      ) {
        throw new Error(`Tool '${step.toolName}' is not in allowlist`);
      }

      // Check if tool is denied
      if (this.config.deniedTools.includes(step.toolName)) {
        throw new Error(`Tool '${step.toolName}' is denied`);
      }
    }
  }

  /**
   * Check if an execution step requires explicit user confirmation (HitL).
   */
  requiresConfirmation(step: {
    toolName: string;
    parameters: Record<string, any>;
  }): { required: boolean; reason?: string } {
    // 1. High-risk system tools always require confirmation
    const highRiskTools = ["skill_create", "process_kill", "file_write"];
    if (highRiskTools.includes(step.toolName)) {
      return {
        required: true,
        reason: `High-risk tool '${step.toolName}' requires authorization.`,
      };
    }

    // 2. Sensitive keywords in parameters (especially for web_act or shell_exec)
    const paramsString = JSON.stringify(step.parameters).toLowerCase();
    const hit = this.config.protectedKeywords?.find((kw) =>
      paramsString.includes(kw),
    );

    if (hit) {
      return {
        required: true,
        reason: `Potential high-risk action detected: contains keyword '${hit}'.`,
      };
    }

    return { required: false };
  }

  /**
   * Get default security config
   */
  static default(): SecurityConfig {
    return {
      allowedTools: ["shell_exec", "file_read", "file_write"],
      deniedTools: [],
    };
  }
}

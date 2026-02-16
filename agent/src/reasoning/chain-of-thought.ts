import {
  LLMClient,
  ReasoningToolDefinition,
  ThoughtChain,
  ThoughtChainContext,
  ThoughtStep,
  ThinkingResult,
  PlanStep,
  ToolDecision,
  ValidationResult,
} from "./types.js";
import { REASONING_PROMPTS } from "./prompts.js";

const DEFAULT_FALLBACK_DECISION: ToolDecision = {
  toolNames: [],
  rationale: "No tools required.",
  fallback: "Respond directly without tools.",
};

export class ChainOfThought {
  private llm: LLMClient;

  constructor(llm: LLMClient) {
    this.llm = llm;
  }

  // === General-Purpose Thinking ===

  /**
   * Think through a task step by step, producing structured reasoning.
   */
  async think(task: string, context?: string): Promise<ThinkingResult> {
    const prompt = [
      REASONING_PROMPTS.system,
      REASONING_PROMPTS.thinking,
      `Task: ${task}`,
      context ? `Context: ${context}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const raw = await this.llm.chat(prompt, []);
    const parsed = this.parseJson(raw);

    if (!parsed || typeof parsed !== "object") {
      return this.buildFallbackThinking(task);
    }

    const obj = parsed as any;
    const steps: ThoughtStep[] = Array.isArray(obj.steps)
      ? obj.steps.map((s: any) => ({
          type: s.type || "reasoning",
          content: String(s.content || ""),
          confidence: this.clamp(s.confidence ?? 0.5),
          evidence: s.evidence,
          timestamp: Date.now(),
        }))
      : [
          {
            type: "reasoning" as const,
            content: task,
            confidence: 0.5,
            timestamp: Date.now(),
          },
        ];

    return {
      thinking: steps.map((s) => `[${s.type}] ${s.content}`).join("\n"),
      response: String(obj.response || ""),
      toolCalls: Array.isArray(obj.toolsNeeded)
        ? obj.toolsNeeded.map((name: string) => ({ name, parameters: {} }))
        : undefined,
      steps,
      confidence: this.clamp(obj.confidence ?? 0.5),
    };
  }

  /**
   * Break a task into actionable sub-steps.
   */
  async planSteps(
    task: string,
    availableTools: ReasoningToolDefinition[],
    context?: string,
  ): Promise<PlanStep[]> {
    const toolList = availableTools
      .map((t) => `${t.name}: ${t.description}`)
      .join("\n");

    const prompt = [
      REASONING_PROMPTS.system,
      REASONING_PROMPTS.planSteps,
      `Task: ${task}`,
      `Available Tools:\n${toolList}`,
      context ? `Context: ${context}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const raw = await this.llm.chat(prompt, []);
    const parsed = this.parseJson(raw);

    if (!parsed || typeof parsed !== "object") {
      return [{ id: 1, description: task, status: "pending" }];
    }

    const obj = parsed as any;
    if (!Array.isArray(obj.steps)) {
      return [{ id: 1, description: task, status: "pending" }];
    }

    return obj.steps.map((s: any, i: number) => ({
      id: s.id ?? i + 1,
      description: String(s.description || ""),
      toolsNeeded: Array.isArray(s.toolsNeeded) ? s.toolsNeeded : undefined,
      status: "pending" as const,
    }));
  }

  // === Tool Selection Chain (existing, enhanced) ===

  async buildChain(
    task: string,
    context: ThoughtChainContext,
  ): Promise<ThoughtChain> {
    const toolList = context.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      keywords: tool.keywords,
      examples: tool.examples,
    }));

    const prompt = [
      REASONING_PROMPTS.system,
      REASONING_PROMPTS.chain,
      `Task: ${task}`,
      context.memoryContext ? `Memory Context: ${context.memoryContext}` : "",
      `Intent: ${context.orientation.intent}`,
      `Candidate Tools: ${JSON.stringify(toolList)}`,
      `Risks: ${JSON.stringify(context.orientation.risks)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const raw = await this.llm.chat(prompt, []);
    const parsed = this.parseJson(raw);

    if (!parsed || typeof parsed !== "object") {
      return this.buildFallbackChain(task);
    }

    const chain = this.normalizeChain(parsed as ThoughtChain);
    const validation = this.validate(chain);
    if (!validation.ok) {
      return this.buildFallbackChain(task, validation.errors);
    }

    return chain;
  }

  validate(chain: ThoughtChain): ValidationResult {
    const errors: string[] = [];

    if (!Array.isArray(chain.steps) || chain.steps.length === 0) {
      errors.push("Missing steps");
    }

    if (!chain.decision || !Array.isArray(chain.decision.toolNames)) {
      errors.push("Missing decision.toolNames");
    }

    if (typeof chain.confidence !== "number") {
      errors.push("Missing confidence");
    } else if (chain.confidence < 0 || chain.confidence > 1) {
      errors.push("Confidence must be between 0 and 1");
    }

    return { ok: errors.length === 0, errors };
  }

  extractDecision(
    chain: ThoughtChain,
    tools: ReasoningToolDefinition[],
  ): ToolDecision {
    const toolNames = new Set(tools.map((tool) => tool.name));
    const filtered = chain.decision.toolNames.filter((name) =>
      toolNames.has(name),
    );

    if (filtered.length === 0) {
      return {
        ...DEFAULT_FALLBACK_DECISION,
        rationale:
          chain.decision.rationale || DEFAULT_FALLBACK_DECISION.rationale,
        fallback: chain.decision.fallback || DEFAULT_FALLBACK_DECISION.fallback,
      };
    }

    return {
      toolNames: filtered,
      rationale:
        chain.decision.rationale || "Selected tools based on reasoning.",
      fallback:
        chain.decision.fallback || "Fall back to keyword-based selection.",
    };
  }

  // === Utilities ===

  parseJson(text: string): unknown | null {
    const trimmed = text.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }

  private normalizeChain(chain: ThoughtChain): ThoughtChain {
    const steps: ThoughtStep[] = Array.isArray(chain.steps)
      ? chain.steps.map((step) => ({
          type: step.type,
          content: step.content,
          confidence: this.clamp(step.confidence),
          evidence: step.evidence,
          timestamp: Date.now(),
        }))
      : [];

    return {
      steps,
      decision: chain.decision || DEFAULT_FALLBACK_DECISION,
      confidence: this.clamp(chain.confidence ?? 0.5),
      risks: chain.risks || [],
      createdAt: chain.createdAt || Date.now(),
    };
  }

  private buildFallbackChain(
    task: string,
    errors: string[] = [],
  ): ThoughtChain {
    const steps: ThoughtStep[] = [
      {
        type: "observation",
        content: `Task received: ${task}`,
        confidence: 0.5,
        timestamp: Date.now(),
      },
      {
        type: "conclusion",
        content: "Falling back to simple tool selection.",
        confidence: 0.5,
        evidence: errors.length > 0 ? errors : undefined,
        timestamp: Date.now(),
      },
    ];

    return {
      steps,
      decision: {
        toolNames: [],
        rationale: "Fallback to heuristic selection.",
        fallback: "Select tools using keyword matching.",
      },
      confidence: 0.4,
      risks: errors.length > 0 ? errors : ["Model output invalid"],
      createdAt: Date.now(),
    };
  }

  private buildFallbackThinking(task: string): ThinkingResult {
    return {
      thinking: `Analyzing task: ${task}`,
      response: "",
      steps: [
        {
          type: "observation",
          content: `Task received: ${task}`,
          confidence: 0.5,
          timestamp: Date.now(),
        },
      ],
      confidence: 0.4,
    };
  }

  private clamp(value: number): number {
    if (Number.isNaN(value)) return 0.5;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }
}

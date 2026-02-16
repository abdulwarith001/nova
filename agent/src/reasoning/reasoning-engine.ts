import { ToolSelector } from "../../../runtime/src/tool-selector";
import { Agent } from "../index.js";
import { ChainOfThought } from "./chain-of-thought.js";
import { ReasoningLogger } from "./logger.js";
import { REASONING_PROMPTS } from "./prompts.js";
import { observe, orient } from "./ooda-loop.js";
import {
  ActionResult,
  AgentEvent,
  AgentEventHandler,
  DecisionResult,
  OODAState,
  ObservationResult,
  OrientationResult,
  ReasoningContext,
  ReasoningEngineConfig,
  ReasoningToolDefinition,
  ReflectionResult,
  ThinkingResult,
  ThoughtChainContext,
  PlanStep,
} from "./types.js";

export class ReasoningEngine {
  private toolSelector: ToolSelector;
  private chainOfThought?: ChainOfThought;
  private llmChat?: (
    prompt: string,
    history?: Array<{ role: string; content: string }>,
  ) => Promise<string>;
  private config: ReasoningEngineConfig;
  private logger: ReasoningLogger;
  private eventHandlers: AgentEventHandler[] = [];

  constructor(
    agent?: Agent,
    config: ReasoningEngineConfig = {},
    logDir?: string,
  ) {
    this.toolSelector = new ToolSelector();
    this.config = {
      mode: config.mode ?? "full",
      verbosity: config.verbosity ?? "summary",
      fallbackToSimple: config.fallbackToSimple ?? true,
      maxTools: config.maxTools ?? 20,
    };
    this.logger = new ReasoningLogger(logDir);

    if (agent && this.config.mode === "full") {
      this.llmChat = (prompt, history) => agent.chat(prompt, history as any);
      this.chainOfThought = new ChainOfThought({
        chat: (prompt, history) => agent.chat(prompt, history as any),
      });
    }
  }

  /**
   * Register an event handler for reasoning events.
   */
  onEvent(handler: AgentEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: AgentEvent): void {
    this.logger.logEvent(event);
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Event handlers should not crash the engine
      }
    }
  }

  // === General-Purpose Thinking ===

  /**
   * Think through a task using chain-of-thought reasoning.
   */
  async think(
    task: string,
    context?: string,
    iteration = 1,
  ): Promise<ThinkingResult> {
    this.emit({ type: "thinking_start", task, iteration });

    if (!this.chainOfThought || this.config.mode !== "full") {
      const fallback: ThinkingResult = {
        thinking: `Processing: ${task}`,
        response: "",
        steps: [
          {
            type: "observation",
            content: task,
            confidence: 0.5,
            timestamp: Date.now(),
          },
        ],
        confidence: 0.5,
      };
      this.emit({ type: "thinking_complete", result: fallback, iteration });
      return fallback;
    }

    const result = await this.chainOfThought.think(task, context);

    // Emit each step
    for (const step of result.steps) {
      this.emit({ type: "thinking_step", step, iteration });
    }

    this.emit({ type: "thinking_complete", result, iteration });
    this.logger.logThinking(task, result);

    return result;
  }

  /**
   * Decompose a task into sub-steps.
   */
  async planSteps(
    task: string,
    tools: ReasoningToolDefinition[],
    context?: string,
  ): Promise<PlanStep[]> {
    if (!this.chainOfThought || this.config.mode !== "full") {
      return [{ id: 1, description: task, status: "pending" }];
    }

    const steps = await this.chainOfThought.planSteps(task, tools, context);
    this.emit({ type: "plan_created", steps });
    return steps;
  }

  // === OODA Loop ===

  async reason(context: ReasoningContext): Promise<OODAState> {
    const observation = await this.observe(context);
    const orientation = await this.orient(observation);
    const decision = await this.decide(orientation, observation);

    return {
      observe: observation,
      orient: orientation,
      decide: decision,
      act: {
        toolCalls: [],
        toolResults: [],
      },
    };
  }

  /**
   * Backward-compatible helper used by the gateway chat loop.
   * Selects relevant tools for a task and returns the full OODA state.
   */
  async selectTools(
    task: string,
    tools: ReasoningToolDefinition[],
    options?: {
      history?: Array<{ role: string; content: string }>;
      memoryContext?: string;
      maxTools?: number;
    },
  ): Promise<OODAState> {
    return this.reason({
      task,
      tools,
      history: options?.history ?? [],
      memoryContext: options?.memoryContext,
      maxTools: options?.maxTools ?? this.config.maxTools,
    });
  }

  async observe(context: ReasoningContext): Promise<ObservationResult> {
    return observe({
      ...context,
      maxTools: context.maxTools ?? this.config.maxTools,
    });
  }

  async orient(observation: ObservationResult): Promise<OrientationResult> {
    return orient(observation, this.toolSelector);
  }

  async decide(
    orientation: OrientationResult,
    observation?: ObservationResult,
  ): Promise<DecisionResult> {
    const maxTools = this.config.maxTools ?? 20;
    const orderedCandidates = orientation.candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, maxTools);
    const candidateTools = orderedCandidates.map((candidate) => candidate.tool);

    if (this.config.mode === "full" && this.chainOfThought) {
      const thoughtContext: ThoughtChainContext = {
        task: orientation.intent,
        memoryContext: observation?.memoryContext,
        observation: observation ?? {
          task: orientation.intent,
          availableTools: candidateTools,
          constraints: { maxTools },
          notes: [],
        },
        orientation,
        tools: candidateTools,
      };

      const chain = await this.chainOfThought.buildChain(
        orientation.intent,
        thoughtContext,
      );
      const decision = this.chainOfThought.extractDecision(
        chain,
        candidateTools,
      );

      const isFallbackSignal =
        chain.risks?.some((risk) =>
          risk.toLowerCase().includes("model output invalid"),
        ) || decision.rationale.toLowerCase().includes("fallback");

      const selected = decision.toolNames.length
        ? candidateTools.filter((tool) =>
            decision.toolNames.includes(tool.name),
          )
        : this.config.fallbackToSimple && isFallbackSignal
          ? candidateTools
          : [];

      return {
        selectedTools: selected,
        rationale: decision.rationale,
        fallback: decision.fallback,
        confidence: chain.confidence,
        thoughtChain: chain,
      };
    }

    return {
      selectedTools: candidateTools,
      rationale: "Selected top tools based on keyword matching.",
      fallback: "Provide all tools if selection is too narrow.",
      confidence: orientation.confidence,
    };
  }

  async act(decision: DecisionResult): Promise<ActionResult> {
    return {
      toolCalls: decision.selectedTools.map((tool) => ({
        name: tool.name,
        parameters: {},
      })),
      toolResults: [],
    };
  }

  async reflect(action: ActionResult): Promise<ReflectionResult> {
    if (this.config.mode !== "full" || !this.llmChat) {
      const success = action.toolResults.every((r) => !r.error);
      const result: ReflectionResult = {
        success,
        summary: success
          ? "All tools executed successfully."
          : "Some tools failed during execution.",
        adjustments: success ? [] : ["Consider alternative tools or inputs."],
        shouldContinue: !success,
      };
      this.emit({ type: "reflection", result });
      return result;
    }

    const prompt = [
      REASONING_PROMPTS.system,
      REASONING_PROMPTS.reflection,
      `Tool Calls: ${JSON.stringify(action.toolCalls)}`,
      `Tool Results: ${JSON.stringify(action.toolResults)}`,
    ].join("\n\n");

    const raw = await this.llmChat(prompt, []);
    const parsed = this.chainOfThought?.parseJson(raw);
    if (!parsed || typeof parsed !== "object") {
      const fallback: ReflectionResult = {
        success: false,
        summary: "Reflection failed to parse.",
        adjustments: ["Fallback to heuristic decision."],
        shouldContinue: false,
      };
      this.emit({ type: "reflection", result: fallback });
      return fallback;
    }

    const success = Boolean((parsed as any).success);
    const result: ReflectionResult = {
      success,
      summary: (parsed as any).summary || "Reflection complete.",
      adjustments: Array.isArray((parsed as any).adjustments)
        ? (parsed as any).adjustments
        : [],
      shouldContinue: (parsed as any).shouldContinue ?? !success,
    };
    this.emit({ type: "reflection", result });
    return result;
  }

  formatDecisionSummary(decision: DecisionResult): string {
    const toolNames = decision.selectedTools
      .map((tool) => tool.name)
      .join(", ");
    return `Tools: [${toolNames || "none"}] | Confidence: ${decision.confidence.toFixed(
      2,
    )} | Rationale: ${decision.rationale}`;
  }

  getLogger(): ReasoningLogger {
    return this.logger;
  }
}

export function toReasoningTools(
  tools: Array<{
    name: string;
    description: string;
    parametersSchema?: Record<string, unknown>;
    category?: string;
    keywords?: string[];
    examples?: string[];
  }>,
): ReasoningToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersSchema: tool.parametersSchema,
    category: tool.category,
    keywords: tool.keywords,
    examples: tool.examples,
  }));
}

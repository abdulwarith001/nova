import { Agent } from "../index.js";
import { ChainOfThought } from "./chain-of-thought.js";
import { ReasoningLogger } from "./logger.js";
import { REASONING_PROMPTS } from "./prompts.js";
import { runOODALoop } from "./ooda-loop.js";
import {
  ActionResult,
  AgentEvent,
  AgentEventHandler,
  DecisionResult,
  OODAState,
  OODAThought,
  OODARunResult,
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
    return {
      task: context.task,
      memoryContext: context.memoryContext,
      availableTools: context.tools,
      constraints: { maxTools: context.maxTools ?? this.config.maxTools ?? 20 },
      notes: [
        context.memoryContext
          ? "Memory context available"
          : "No memory context",
        `Available tools: ${context.tools.length}`,
      ],
    };
  }

  async orient(observation: ObservationResult): Promise<OrientationResult> {
    // Inline tool scoring (keyword match)
    const queryWords = observation.task.toLowerCase().split(/\s+/);
    const scored = (observation.availableTools as any[])
      .map((tool: any) => {
        const haystack =
          `${tool.name} ${tool.description || ""} ${(tool.keywords || []).join(" ")}`.toLowerCase();
        const score = queryWords.reduce(
          (s, w) => s + (haystack.includes(w) ? 1 : 0),
          0,
        );
        return { tool, score };
      })
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score);
    const candidates = scored.map((entry: any) => ({
      tool: entry.tool as any,
      score: entry.score,
      rationale: entry.score > 0 ? "keyword match" : "low match",
    }));
    const confidence =
      candidates.length > 0 ? Math.min(1, candidates[0].score / 10) : 0.2;
    return {
      intent: observation.task,
      candidates,
      confidence,
      risks: candidates.length === 0 ? ["No obvious tool matches found"] : [],
    };
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

  /**
   * Run the full OODA loop for a chat message.
   * Each phase (observe → orient → decide) produces a thought that is
   * passed to the next phase. Returns all thoughts and assembled thinking.
   */
  async runOODA(input: {
    message: string;
    memoryContext?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
  }): Promise<OODARunResult> {
    if (!this.llmChat) {
      // No LLM available — return a minimal fallback
      const fallbackThought: OODAThought = {
        phase: "observe",
        content: `Message received: ${input.message.slice(0, 100)}`,
        confidence: 0.5,
        timestamp: Date.now(),
      };
      return {
        thoughts: [fallbackThought],
        decision: {
          selectedTools: [],
          rationale: "No reasoning LLM available.",
          fallback: "Respond directly.",
          confidence: 0.5,
        },
        assembledThinking: `[OBSERVE] ${fallbackThought.content}`,
      };
    }

    this.emit({ type: "thinking_start", task: input.message, iteration: 1 });

    const result = await runOODALoop({
      message: input.message,
      memoryContext: input.memoryContext,
      conversationHistory: input.conversationHistory,
      llmChat: this.llmChat,
    });

    // Emit each thought as a thinking step event
    for (const thought of result.thoughts) {
      this.emit({
        type: "thinking_step",
        step: {
          type:
            thought.phase === "observe"
              ? "observation"
              : thought.phase === "orient"
                ? "hypothesis"
                : "conclusion",
          content: `[${thought.phase.toUpperCase()}] ${thought.content}`,
          confidence: thought.confidence,
          timestamp: thought.timestamp,
        },
        iteration: 1,
      });
    }

    // Log the full OODA trace
    this.logger.logThinking(input.message, {
      thinking: result.assembledThinking,
      response: "",
      steps: result.thoughts.map((t) => ({
        type:
          t.phase === "observe"
            ? ("observation" as const)
            : t.phase === "orient"
              ? ("hypothesis" as const)
              : ("conclusion" as const),
        content: t.content,
        confidence: t.confidence,
        timestamp: t.timestamp,
      })),
      confidence:
        result.thoughts.length > 0
          ? result.thoughts.reduce((sum, t) => sum + t.confidence, 0) /
            result.thoughts.length
          : 0.5,
    });

    this.emit({
      type: "thinking_complete",
      result: {
        thinking: result.assembledThinking,
        response: "",
        steps: result.thoughts.map((t) => ({
          type:
            t.phase === "observe"
              ? ("observation" as const)
              : t.phase === "orient"
                ? ("hypothesis" as const)
                : ("conclusion" as const),
          content: t.content,
          confidence: t.confidence,
          timestamp: t.timestamp,
        })),
        confidence:
          result.thoughts.length > 0
            ? result.thoughts.reduce((sum, t) => sum + t.confidence, 0) /
              result.thoughts.length
            : 0.5,
      },
      iteration: 1,
    });

    return {
      thoughts: result.thoughts,
      decision: {
        selectedTools: [],
        rationale: result.assembledThinking,
        fallback: "Respond directly.",
        confidence:
          result.thoughts.length > 0
            ? result.thoughts.reduce((sum, t) => sum + t.confidence, 0) /
              result.thoughts.length
            : 0.5,
      },
      assembledThinking: result.assembledThinking,
    };
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

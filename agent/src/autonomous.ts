import { Agent, AgentConfig } from "./index.js";
import {
  OODAState,
  ReasoningEngine,
  ReasoningLogger,
  toReasoningTools,
} from "./reasoning/index.js";
import type {
  AgentEvent,
  AgentEventHandler,
  ReasoningIteration,
  ReasoningTrace,
} from "./reasoning/types.js";
import type { Runtime, Task } from "../../runtime/src/index.js";

export interface AutonomousAgentConfig extends AgentConfig {
  maxIterations?: number;
  systemPrompt?: string;
  retryFailedTools?: boolean;
  maxToolRetries?: number;
  enableMemoryContext?: boolean;
  allowedTools?: string[];
  toolLimits?: Record<string, number>;
  reasoningMode?: "off" | "fast" | "full";
  reasoningVerbosity?: "none" | "summary";
  reasoningFallbackToSimple?: boolean;
  reasoningMaxTools?: number;
}

/**
 * Autonomous agent with chain-of-thought reasoning and contextual memory.
 *
 * Execution pipeline: plan → think → act → reflect → learn
 */
export class AutonomousAgent {
  private agent: Agent;
  private runtime: Runtime;
  private config: AutonomousAgentConfig;
  private conversationHistory: Array<{ role: string; content: string }> = [];
  private sessionId: string;
  private reasoningEngine: ReasoningEngine;
  private logger: ReasoningLogger;
  private eventHandlers: AgentEventHandler[] = [];

  constructor(runtime: Runtime, config: AutonomousAgentConfig) {
    this.runtime = runtime;
    this.config = config;
    this.sessionId = `session-${Date.now()}`;

    const systemPrompt = this.buildSystemPrompt(config.systemPrompt);
    this.agent = new Agent(config, systemPrompt);

    this.reasoningEngine = new ReasoningEngine(
      config.reasoningMode !== "off" ? this.agent : undefined,
      {
        mode: config.reasoningMode ?? "full",
        verbosity: config.reasoningVerbosity ?? "summary",
        fallbackToSimple: config.reasoningFallbackToSimple ?? true,
        maxTools: config.reasoningMaxTools ?? 20,
      },
    );
    this.logger = this.reasoningEngine.getLogger();
  }

  /**
   * Register an event handler for agent reasoning events.
   */
  onEvent(handler: AgentEventHandler): void {
    this.eventHandlers.push(handler);
    this.reasoningEngine.onEvent(handler);
  }

  private emit(event: AgentEvent): void {
    this.logger.logEvent(event);
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Events should not crash the agent
      }
    }
  }

  /**
   * Build system prompt with memory context
   */
  private buildSystemPrompt(customPrompt?: string): string {
    if (customPrompt) return customPrompt;

    return `You are Nova, an AI super agent with access to powerful tools and contextual memory.

You can execute commands, read/write files, browse the web, and perform complex tasks autonomously.

IMPORTANT CAPABILITIES:
- You remember past conversations and tasks
- You build up knowledge and context over time
- You adapt to user preferences

When given a task:
1. Think through the problem step by step
2. Check if you have relevant context from past interactions
3. Break down the task into manageable steps
4. Use appropriate tools to accomplish each step
5. Reflect on results and learn from the experience

Always explain your reasoning before using a tool.
If a tool fails, analyze the error and try an alternative approach.`;
  }

  /**
   * Execute a task using the plan → think → act → reflect → learn pipeline.
   */
  async execute(userTask: string): Promise<string> {
    const maxIterations = this.config.maxIterations || 10;
    const enableMemory = this.config.enableMemoryContext !== false;

    // Initialize reasoning trace
    const trace: ReasoningTrace = {
      taskId: `task-${Date.now()}`,
      task: userTask,
      startedAt: Date.now(),
      iterations: [],
    };

    // ── Phase 1: Context Building ──
    let contextPrompt = userTask;
    let memoryContext: string | undefined;
    if (enableMemory) {
      const context = await this.runtime.getMemory().buildContext(userTask);
      if (context) {
        memoryContext = context;
        contextPrompt = `${context}\n\n---\n\nUser Task: ${userTask}`;
      }
    }

    this.conversationHistory.push({ role: "user", content: contextPrompt });

    // ── Phase 2: Plan (optional, for complex tasks) ──
    if (this.config.reasoningMode === "full") {
      const allTools = this.getFilteredTools();
      const plan = await this.reasoningEngine.planSteps(
        userTask,
        toReasoningTools(allTools),
        memoryContext,
      );
      this.emit({ type: "plan_created", steps: plan });
    }

    // ── Phase 3: Iterative Think → Act → Reflect Loop ──
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      try {
        // ── Think ──
        const thinking = await this.reasoningEngine.think(
          userTask,
          memoryContext,
          iteration,
        );

        // ── Reason about tool selection ──
        let selectedToolNames: string[] | undefined;
        if (this.config.reasoningMode !== "off") {
          const allTools = this.getFilteredTools();
          const observation = await this.reasoningEngine.observe({
            task: userTask,
            history: this.conversationHistory,
            memoryContext,
            tools: toReasoningTools(allTools),
            maxTools: this.config.reasoningMaxTools,
          });
          const orientation = await this.reasoningEngine.orient(observation);
          const decision = await this.reasoningEngine.decide(
            orientation,
            observation,
          );
          selectedToolNames = decision.selectedTools.map((t) => t.name);
        }

        // ── Act: Get LLM response with tools ──
        const response = await this.agent.chatWithTools(
          this.conversationHistory,
          this.getToolDefinitions(selectedToolNames),
        );

        this.conversationHistory.push({
          role: "assistant",
          content: response.content,
        });

        // If no tool calls, task is complete
        if (!response.toolCalls || response.toolCalls.length === 0) {
          // ── Learn: Store conversation in memory ──
          if (enableMemory) {
            await this.extractLearnings(response.content);
            await this.storeConversation(userTask, response.content);
          }

          trace.completedAt = Date.now();
          trace.finalResult = response.content;
          trace.iterations.push({
            iteration,
            thinking,
            timestamp: Date.now(),
          });

          this.emit({ type: "task_complete", result: response.content, trace });
          this.logger.logTrace(trace);

          return response.content;
        }

        // ── Execute tool calls ──
        const toolResults = await this.executeToolsWithRetry(
          response.toolCalls,
        );

        // ── Reflect ──
        const actionResult = { toolCalls: response.toolCalls, toolResults };
        const reflection = await this.reasoningEngine.reflect(actionResult);

        // Record iteration in trace
        const iterationRecord: ReasoningIteration = {
          iteration,
          thinking,
          toolCalls: response.toolCalls,
          toolResults,
          reflection,
          timestamp: Date.now(),
        };
        trace.iterations.push(iterationRecord);

        this.emit({
          type: "iteration_complete",
          iteration,
          maxIterations,
        });

        // Add tool results to conversation
        for (const result of toolResults) {
          const resultContent = result.error
            ? `Tool ${result.toolName} failed: ${result.error}`
            : `Tool result for ${result.toolName}: ${JSON.stringify(result.result)}`;

          this.conversationHistory.push({
            role: "user",
            content: resultContent,
          });
        }
      } catch (error) {
        this.conversationHistory.push({
          role: "user",
          content: `An error occurred: ${error instanceof Error ? error.message : "Unknown error"}. Please try a different approach.`,
        });
      }
    }

    // Log incomplete trace
    trace.completedAt = Date.now();
    this.logger.logTrace(trace);

    throw new Error("Max iterations reached without completing task");
  }

  /**
   * Extract learnings from agent response
   */
  private async extractLearnings(content: string): Promise<void> {
    const memory = this.runtime.getMemory();

    const nameMatch = content.match(
      /(?:user(?:'s)? name is|call (?:you|them)) ([A-Z][a-z]+)/i,
    );
    if (nameMatch) {
      await memory.updateUserProfile({ name: nameMatch[1] });
    }

    const goalMatch = content.match(
      /(?:goal|objective|aim) (?:is|:) (.+?)(?:\.|$)/i,
    );
    if (goalMatch) {
      const currentProfile = memory.getUserProfile();
      const goals = [...currentProfile.goals, goalMatch[1]];
      await memory.updateUserProfile({ goals });
    }

    const prefMatch = content.match(/(?:prefer|like)s? (.+?)(?:\.|$)/i);
    if (prefMatch) {
      const currentProfile = memory.getUserProfile();
      const preferences = {
        ...currentProfile.preferences,
        [Date.now()]: prefMatch[1],
      };
      await memory.updateUserProfile({ preferences });
    }
  }

  /**
   * Store conversation in memory
   */
  private async storeConversation(task: string, result: string): Promise<void> {
    const memory = this.runtime.getMemory();

    await memory.store({
      id: `conv-${this.sessionId}-${Date.now()}`,
      content: `Task: ${task}\nResult: ${result}`,
      timestamp: Date.now(),
      importance: 0.8,
      decayRate: 0.05,
      tags: ["conversation", "task"],
      source: "agent",
      sessionId: this.sessionId,
      category: "conversation",
      metadata: { task, result },
    });
  }

  /**
   * Execute tool calls with retry logic
   */
  private async executeToolsWithRetry(
    toolCalls: Array<{ name: string; parameters: Record<string, unknown> }>,
  ): Promise<Array<{ toolName: string; result?: unknown; error?: string }>> {
    const results = [];
    const maxRetries = this.config.maxToolRetries || 2;
    const retryEnabled = this.config.retryFailedTools !== false;
    const toolLimits = this.config.toolLimits || {};
    const toolCounts: Record<string, number> = {};

    for (const toolCall of toolCalls) {
      const currentCount = toolCounts[toolCall.name] || 0;
      const limit = toolLimits[toolCall.name];
      if (typeof limit === "number" && currentCount >= limit) {
        results.push({
          toolName: toolCall.name,
          error: `Tool call limit exceeded for ${toolCall.name}`,
        });
        continue;
      }

      this.emit({
        type: "tool_start",
        toolName: toolCall.name,
        parameters: toolCall.parameters,
      });

      let lastError: Error | null = null;
      let attempts = 0;

      while (attempts < (retryEnabled ? maxRetries : 1)) {
        attempts++;

        try {
          const task: Task = {
            id: `tool-${Date.now()}-${attempts}`,
            description: `Execute ${toolCall.name}`,
            toolCalls: [
              {
                toolName: toolCall.name,
                parameters: toolCall.parameters,
              },
            ],
          };

          const result = await this.runtime.execute(task);

          toolCounts[toolCall.name] = currentCount + 1;
          results.push({
            toolName: toolCall.name,
            result: result.outputs[0],
          });

          this.emit({
            type: "tool_complete",
            toolName: toolCall.name,
            result: result.outputs[0],
          });

          break;
        } catch (error) {
          lastError = error as Error;

          if (attempts < maxRetries && retryEnabled) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }

      if (lastError) {
        results.push({
          toolName: toolCall.name,
          error: lastError.message,
        });
        this.emit({
          type: "tool_complete",
          toolName: toolCall.name,
          error: lastError.message,
        });
      }
    }

    return results;
  }

  /**
   * Get filtered tools based on allowlist config
   */
  private getFilteredTools() {
    const tools = this.runtime.getTools().list();
    const allowlist = this.config.allowedTools;
    return Array.isArray(allowlist) && allowlist.length > 0
      ? tools.filter((tool) => allowlist.includes(tool.name))
      : tools;
  }

  /**
   * Get tool definitions for the LLM
   */
  private getToolDefinitions(selectedToolNames?: string[]) {
    const filtered = this.getFilteredTools();
    const hasSelection = Array.isArray(selectedToolNames);
    const selectedSet = hasSelection ? new Set(selectedToolNames) : null;

    const finalTools = hasSelection
      ? filtered.filter((tool) => selectedSet?.has(tool.name))
      : filtered;

    return finalTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSchema,
    }));
  }

  /**
   * Get current session context
   */
  async getContext(): Promise<string> {
    return await this.runtime.getMemory().buildContext();
  }

  /**
   * Reset conversation history
   */
  reset(): void {
    this.conversationHistory = [];
    this.sessionId = `session-${Date.now()}`;
  }
}

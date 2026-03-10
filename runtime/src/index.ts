import { Executor, ExecutorConfig } from "./executor";
import { MarkdownMemory, type ChannelType } from "./markdown-memory/index";
import { SecurityManager, SecurityConfig } from "./security";
import { ToolExecutionContext, ToolRegistry } from "./tools";
import { Planner } from "./planner";
import { ensureEnvLoaded } from "./config";
import { join } from "path";
import { homedir } from "os";

ensureEnvLoaded();

export interface RuntimeConfig {
  novaDir?: string;
  security: SecurityConfig;
  executor: ExecutorConfig;
  planner?: {
    llmChat?: (prompt: string) => Promise<string>;
  };
}

export interface Task {
  id: string;
  description: string;
  toolCalls: ToolCall[];
}

export interface ToolCall {
  toolName: string;
  parameters: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  outputs: unknown[];
  durationMs: number;
}

/**
 * Nova Runtime - Core execution engine
 */
export class Runtime {
  private executor: Executor;
  private security: SecurityManager;
  private tools: ToolRegistry;
  private planner: Planner;
  private markdownMemory: MarkdownMemory;

  private constructor(
    executor: Executor,
    security: SecurityManager,
    tools: ToolRegistry,
    planner: Planner,
    markdownMemory: MarkdownMemory,
  ) {
    this.executor = executor;
    this.security = security;
    this.tools = tools;
    this.planner = planner;
    this.markdownMemory = markdownMemory;
  }

  /**
   * Create a new runtime instance
   */
  static async create(config: RuntimeConfig): Promise<Runtime> {
    const novaDir = config.novaDir || join(homedir(), ".nova");
    const markdownMemory = MarkdownMemory.create(join(novaDir, "memory"));
    const security = new SecurityManager(config.security);
    const tools = new ToolRegistry();
    const executor = new Executor(config.executor);
    const planner = new Planner(config.planner?.llmChat);

    const runtimeInstance = new Runtime(
      executor,
      security,
      tools,
      planner,
      markdownMemory,
    );

    return runtimeInstance;
  }

  /**
   * Execute a task
   */
  async execute(
    task: Task,
    confirm?: import("./executor").ConfirmationCallback,
  ): Promise<TaskResult> {
    const startTime = Date.now();

    // 1. Plan the execution
    const plan = await this.planner.plan(task);

    // 2. Check security permissions
    this.security.authorize(plan);

    // 3. Execute the plan
    const result = await this.executor.execute(
      plan,
      this.tools,
      this.security,
      confirm,
    );

    const durationMs = Date.now() - startTime;

    return {
      taskId: task.id,
      success: result.success,
      outputs: result.outputs,
      durationMs,
    };
  }

  /**
   * Get the Markdown-based memory system.
   */
  getMarkdownMemory(): MarkdownMemory {
    return this.markdownMemory;
  }

  /**
   * Get tool registry
   */
  getTools(): ToolRegistry {
    return this.tools;
  }

  /**
   * Check if a tool call requires HitL confirmation
   */
  public requiresConfirmation(
    name: string,
    params: Record<string, unknown>,
  ): { required: boolean; reason?: string } {
    return this.security.requiresConfirmation({
      toolName: name,
      parameters: params,
    });
  }

  /**
   * Execute a tool by name (for gateway/chat integration)
   */
  async executeTool(
    name: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    // 1. Check for HitL confirmation
    const hitl = this.security.requiresConfirmation({
      toolName: name,
      parameters: params,
    });

    if (hitl.required) {
      if (!context?.confirm) {
        console.error(
          `🛡️ [Security] Blocked "${name}" - HitL required but no handler provided.`,
        );
        throw new Error(
          `Security Error: action "${name}" requires user confirmation, but the current channel does not support interactive approval.`,
        );
      }

      console.log(`🛡️ [Runtime] HitL Required for "${name}": ${hitl.reason}`);
      const approved = await context.confirm(
        {
          id: context.stepId || "direct-call",
          toolName: name,
          parameters: params,
          dependencies: [],
        },
        hitl.reason || "Action requires confirmation",
      );

      if (!approved) {
        console.log(`🛡️ [Runtime] HitL Confirmation: ❌ DENIED for "${name}"`);
        throw new Error(
          `Action cancelled: ${hitl.reason || "User denied permission"}`,
        );
      }
      console.log(`🛡️ [Runtime] HitL Confirmation: ✅ APPROVED for "${name}"`);
    }

    return await this.tools.execute(name, params, context);
  }

  /**
   * Get tools in Agent-compatible format
   */
  getToolsForAgent(): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    return this.tools.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSchema,
    }));
  }
  /**
   * Shutdown runtime
   */
  async shutdown(): Promise<void> {
    await this.executor.shutdown();
    await this.tools.shutdown();
    this.markdownMemory.close();
  }
}

// Re-export types
export * from "./executor";
export * from "./markdown-memory/index";
export * from "./security";
export * from "./tools";
export * from "./planner";

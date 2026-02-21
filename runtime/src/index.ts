import { Executor, ExecutorConfig } from "./executor";
import { MemoryStore } from "./memory";
import {
  MarkdownMemory,
  type ChannelType,
  type LearningJob,
  type MemoryJobType,
} from "./markdown-memory/index";
import { SecurityManager, SecurityConfig } from "./security";
import { ToolExecutionContext, ToolRegistry } from "./tools";
import { Planner } from "./planner";
import { ensureEnvLoaded } from "./config";
import { join } from "path";
import { homedir } from "os";

ensureEnvLoaded();

export interface RuntimeConfig {
  memoryPath: string;
  novaDir?: string;
  security: SecurityConfig;
  executor: ExecutorConfig;
  agent: {
    provider: "openai" | "anthropic";
    model: string;
    apiKey?: string;
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
  private memory: MemoryStore;
  private security: SecurityManager;
  private tools: ToolRegistry;
  private planner: Planner;
  private markdownMemory: MarkdownMemory;

  private constructor(
    executor: Executor,
    memory: MemoryStore,
    security: SecurityManager,
    tools: ToolRegistry,
    planner: Planner,
    markdownMemory: MarkdownMemory,
  ) {
    this.executor = executor;
    this.memory = memory;
    this.security = security;
    this.tools = tools;
    this.planner = planner;
    this.markdownMemory = markdownMemory;
  }

  /**
   * Create a new runtime instance
   */
  static async create(config: RuntimeConfig): Promise<Runtime> {
    const memory = await MemoryStore.create(config.memoryPath);
    const novaDir = config.novaDir || join(homedir(), ".nova");
    const markdownMemory = MarkdownMemory.create(join(novaDir, "memory"));
    const security = new SecurityManager(config.security);
    const tools = new ToolRegistry();
    const executor = new Executor(config.executor);
    const planner = new Planner();

    tools.register({
      name: "memory_search",
      description: "Search Nova memory for prior conversations and facts",
      parametersSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for memory recall",
          },
          limit: {
            type: "number",
            description: "Maximum number of entries to return (default: 5)",
          },
          category: {
            type: "string",
            description:
              "Optional category filter (self|user|task|fact|conversation)",
          },
          minImportance: {
            type: "number",
            description: "Optional minimum importance threshold",
          },
        },
      },
      permissions: [],
      execute: async (params: any) => {
        const query = String(params.query || "").trim();
        const limit = Math.max(
          1,
          Math.min(
            20,
            Number.isFinite(Number(params.limit)) ? Number(params.limit) : 5,
          ),
        );
        const category = String(params.category || "").trim();
        const minImportance = Number.isFinite(Number(params.minImportance))
          ? Number(params.minImportance)
          : undefined;
        const allowedCategories = new Set([
          "self",
          "user",
          "task",
          "fact",
          "conversation",
        ]);

        const results = await memory.search(query, {
          limit,
          category: allowedCategories.has(category as any)
            ? (category as any)
            : undefined,
          minImportance,
        });

        return {
          count: results.length,
          memories: results.map((entry) => ({
            id: entry.id,
            content: entry.content,
            timestamp: entry.timestamp,
            importance: entry.importance,
            category: entry.category,
            tags: entry.tags,
          })),
        };
      },
    });

    const runtimeInstance = new Runtime(
      executor,
      memory,
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
  async execute(task: Task): Promise<TaskResult> {
    const startTime = Date.now();

    // 1. Plan the execution
    const plan = await this.planner.plan(task);

    // 2. Check security permissions
    this.security.authorize(plan);

    // 3. Execute the plan
    const result = await this.executor.execute(plan, this.tools);

    // 4. Store in memory
    await this.memory.storeExecution(task, result);

    const durationMs = Date.now() - startTime;

    return {
      taskId: task.id,
      success: result.success,
      outputs: result.outputs,
      durationMs,
    };
  }

  getMemory(): MemoryStore {
    return this.memory;
  }

  /**
   * Get the Markdown-based memory system.
   */
  getMarkdownMemory(): MarkdownMemory {
    return this.markdownMemory;
  }

  /**
   * Enqueue a learning job.
   */
  enqueueLearningJob(input: {
    userId: string;
    conversationId: string;
    type: MemoryJobType;
    payload?: Record<string, unknown>;
    maxAttempts?: number;
    runAfter?: number;
  }): string {
    return this.markdownMemory.enqueueLearningJob(input);
  }

  /**
   * Process pending learning jobs.
   */
  async processPendingLearningJobs(input: {
    limit?: number;
    handler: (job: LearningJob) => Promise<void>;
  }): Promise<{ processed: number; failed: number }> {
    return await this.markdownMemory.processPendingLearningJobs(input);
  }

  /**
   * Get tool registry
   */
  getTools(): ToolRegistry {
    return this.tools;
  }

  /**
   * Execute a tool by name (for gateway/chat integration)
   */
  async executeTool(
    name: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
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
   * Execute a task with the agent (simplified API for gateway)
   */
  async executeTask(
    task: string,
    config?: { sessionId?: string; maxIterations?: number },
  ) {
    const executionPlan = {
      taskId: config?.sessionId || `task-${Date.now()}`,
      steps: [],
    };
    return await this.executor.execute(executionPlan, this.tools);
  }

  /**
   * Shutdown runtime
   */
  async shutdown(): Promise<void> {
    await this.executor.shutdown();
    await this.tools.shutdown();
    this.markdownMemory.close();
    this.memory.close();
  }
}

// Re-export types
export * from "./executor";
export * from "./memory";
export * from "./markdown-memory/index";
export * from "./security";
export * from "./tools";
export * from "./planner";

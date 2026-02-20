import { Executor, ExecutorConfig } from "./executor";
import { MemoryStore } from "./memory";
import {
  type ApprovalRequest,
  MemoryV2,
  type AutonomyEvaluationResult,
  type ChannelType,
  type LearningJob,
  type ProactiveEvent,
} from "./memory-v2";
import { SecurityManager, SecurityConfig } from "./security";
import { ToolExecutionContext, ToolRegistry } from "./tools";
import { Planner } from "./planner";

import { config } from "dotenv";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

// Load environment variables
config({ path: join(homedir(), ".nova", ".env") });

// Default to Lagos time if not explicitly set
if (!process.env.TZ) {
  process.env.TZ = "Africa/Lagos";
}

function loadRuntimeConfig(): { notificationEmail?: string } {
  const configPath = join(homedir(), ".nova", "config.json");
  if (!existsSync(configPath)) return {};

  try {
    const configJson = JSON.parse(readFileSync(configPath, "utf-8"));
    return { notificationEmail: configJson.notificationEmail };
  } catch {
    return {};
  }
}

export interface RuntimeConfig {
  memoryPath: string;
  memoryV2Path?: string;
  enableMemoryV2?: boolean;
  security: SecurityConfig;
  executor: ExecutorConfig;
  agent: {
    provider: "openai" | "anthropic" | "google";
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
  private memoryV2: MemoryV2 | null;

  private constructor(
    executor: Executor,
    memory: MemoryStore,
    security: SecurityManager,
    tools: ToolRegistry,
    planner: Planner,
    memoryV2: MemoryV2 | null,
  ) {
    this.executor = executor;
    this.memory = memory;
    this.security = security;
    this.tools = tools;
    this.planner = planner;
    this.memoryV2 = memoryV2;
  }

  /**
   * Create a new runtime instance
   */
  static async create(config: RuntimeConfig): Promise<Runtime> {
    const memory = await MemoryStore.create(config.memoryPath);
    const memoryV2 =
      config.enableMemoryV2 === true
        ? await MemoryV2.create(
            config.memoryV2Path ||
              (config.memoryPath === ":memory:"
                ? ":memory:"
                : config.memoryPath.replace(/memory(\.db)?$/, "memory-v2.db")),
          )
        : null;
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
      memoryV2,
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

  /**
   * Get memory store
   */
  getMemory(): MemoryStore {
    return this.memory;
  }

  /**
   * Get memory v2 store (nullable when disabled)
   */
  getMemoryV2(): MemoryV2 | null {
    return this.memoryV2;
  }

  /**
   * Enqueue a memory-v2 learning job.
   */
  enqueueLearningJob(input: {
    userId: string;
    conversationId: string;
    type:
      | "post_turn_extract"
      | "post_turn_reflect"
      | "hourly_sweep"
      | "self_audit"
      | "conversation_analysis"
      | "self_discovery";
    payload?: Record<string, unknown>;
    maxAttempts?: number;
    runAfter?: number;
  }): string {
    if (!this.memoryV2) {
      throw new Error("Memory V2 is disabled");
    }
    return this.memoryV2.enqueueLearningJob(input);
  }

  /**
   * Process pending memory-v2 learning jobs.
   */
  async processPendingLearningJobs(input: {
    limit?: number;
    handler: (job: LearningJob) => Promise<void>;
  }): Promise<{ processed: number; failed: number }> {
    if (!this.memoryV2) {
      return { processed: 0, failed: 0 };
    }
    return await this.memoryV2.processPendingLearningJobs(input);
  }

  /**
   * Evaluate autonomous actions/check-ins for a user.
   */
  evaluateAutonomousActions(input: {
    userId: string;
    channels?: ChannelType[];
  }): AutonomyEvaluationResult {
    if (!this.memoryV2) {
      return {
        userId: input.userId,
        checkedAt: Date.now(),
        shouldSendProactive: false,
        reason: "memory_v2_disabled",
        createdEventIds: [],
      };
    }
    return this.memoryV2.evaluateAutonomousActions(input);
  }

  listApprovalRequests(input: {
    userId?: string;
    status?: ApprovalRequest["status"];
    limit?: number;
  }): ApprovalRequest[] {
    if (!this.memoryV2) return [];
    return this.memoryV2.listApprovalRequests(input);
  }

  approveApprovalRequest(input: {
    requestId: string;
    userId?: string;
  }): { id: string; token: string; expiresAt: number } | null {
    if (!this.memoryV2) return null;
    return this.memoryV2.approveApprovalRequest(input);
  }

  rejectApprovalRequest(input: {
    requestId: string;
    userId?: string;
    reason?: string;
  }): boolean {
    if (!this.memoryV2) return false;
    return this.memoryV2.rejectApprovalRequest(input);
  }

  /**
   * List pending proactive events queued by autonomy engine.
   */
  listPendingProactiveEvents(limit = 20): ProactiveEvent[] {
    if (!this.memoryV2) return [];
    return this.memoryV2.listPendingProactiveEvents(limit);
  }

  markProactiveSent(eventId: string): void {
    if (!this.memoryV2) return;
    this.memoryV2.markProactiveSent(eventId);
  }

  markProactiveDropped(eventId: string, reason: string): void {
    if (!this.memoryV2) return;
    this.memoryV2.markProactiveDropped(eventId, reason);
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
    this.enforceAutonomousApproval(name, params, context);
    return await this.tools.execute(name, params, context);
  }

  private enforceAutonomousApproval(
    name: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): void {
    if (!this.memoryV2) return;
    if (context?.autonomousExecution !== true) return;
    if (!this.memoryV2.requiresApproval(name)) return;

    const userId = String(context.userId || "owner").trim() || "owner";
    const approvalToken = String(context.approvalToken || "").trim();
    const requestId = String(context.approvalRequestId || "").trim();

    if (approvalToken) {
      const consumed = this.memoryV2.consumeApprovalToken({
        userId,
        actionType: name,
        token: approvalToken,
        requestId: requestId || undefined,
      });
      if (consumed.approved) {
        return;
      }
    }

    const created = this.memoryV2.createApprovalRequest({
      userId,
      actionType: name,
      actionPayload: params,
      reason: `Autonomous execution requested approval for tool '${name}'.`,
    });

    const detail = {
      requestId: created.id,
      actionType: name,
      reason: "high_impact_action_requires_approval",
      expiresAt: created.expiresAt,
      approvalCommand: `/memory approval approve ${created.id}`,
    };
    throw new Error(`APPROVAL_REQUIRED:${JSON.stringify(detail)}`);
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
    this.memoryV2?.close();
    this.memory.close();
  }
}

// Re-export types
export * from "./executor";
export * from "./memory";
export * from "./memory-v2";
export * from "./security";
export * from "./tools";
export * from "./planner";

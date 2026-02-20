import { ExecutorConfig } from "./executor";
import { MemoryStore } from "./memory";
import { type ApprovalRequest, MemoryV2, type AutonomyEvaluationResult, type ChannelType, type LearningJob, type ProactiveEvent } from "./memory-v2";
import { SecurityConfig } from "./security";
import { ToolExecutionContext, ToolRegistry } from "./tools";
import { GmailClient } from "./email/gmail-client.js";
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
export declare class Runtime {
    private executor;
    private memory;
    private security;
    private tools;
    private planner;
    private memoryV2;
    private gmailClient;
    private constructor();
    /**
     * Create a new runtime instance
     */
    static create(config: RuntimeConfig): Promise<Runtime>;
    /**
     * Execute a task
     */
    execute(task: Task): Promise<TaskResult>;
    /**
     * Get memory store
     */
    getMemory(): MemoryStore;
    /**
     * Get memory v2 store (nullable when disabled)
     */
    getMemoryV2(): MemoryV2 | null;
    /**
     * Enqueue a memory-v2 learning job.
     */
    enqueueLearningJob(input: {
        userId: string;
        conversationId: string;
        type: "post_turn_extract" | "post_turn_reflect" | "hourly_sweep" | "self_audit" | "conversation_analysis" | "self_discovery";
        payload?: Record<string, unknown>;
        maxAttempts?: number;
        runAfter?: number;
    }): string;
    /**
     * Process pending memory-v2 learning jobs.
     */
    processPendingLearningJobs(input: {
        limit?: number;
        handler: (job: LearningJob) => Promise<void>;
    }): Promise<{
        processed: number;
        failed: number;
    }>;
    /**
     * Evaluate autonomous actions/check-ins for a user.
     */
    evaluateAutonomousActions(input: {
        userId: string;
        channels?: ChannelType[];
    }): AutonomyEvaluationResult;
    listApprovalRequests(input: {
        userId?: string;
        status?: ApprovalRequest["status"];
        limit?: number;
    }): ApprovalRequest[];
    approveApprovalRequest(input: {
        requestId: string;
        userId?: string;
    }): {
        id: string;
        token: string;
        expiresAt: number;
    } | null;
    rejectApprovalRequest(input: {
        requestId: string;
        userId?: string;
        reason?: string;
    }): boolean;
    /**
     * List pending proactive events queued by autonomy engine.
     */
    listPendingProactiveEvents(limit?: number): ProactiveEvent[];
    markProactiveSent(eventId: string): void;
    markProactiveDropped(eventId: string, reason: string): void;
    /**
     * Get tool registry
     */
    getTools(): ToolRegistry;
    /**
     * Get Gmail client
     */
    getGmailClient(): GmailClient | null;
    /**
     * Execute a tool by name (for gateway/chat integration)
     */
    executeTool(name: string, params: Record<string, unknown>, context?: ToolExecutionContext): Promise<unknown>;
    private enforceAutonomousApproval;
    /**
     * Get tools in Agent-compatible format
     */
    getToolsForAgent(): Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    }>;
    /**
     * Execute a task with the agent (simplified API for gateway)
     */
    executeTask(task: string, config?: {
        sessionId?: string;
        maxIterations?: number;
    }): Promise<import("./executor").ExecutionResult>;
    /**
     * Shutdown runtime
     */
    shutdown(): Promise<void>;
}
export * from "./executor";
export * from "./memory";
export * from "./memory-v2";
export * from "./security";
export * from "./tools";
export * from "./planner";

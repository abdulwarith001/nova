import type { ToolRegistry } from "./tools";
export interface ExecutorConfig {
    maxParallel: number;
    defaultTimeoutMs: number;
}
export interface ExecutionPlan {
    taskId: string;
    steps: ExecutionStep[];
}
export interface ExecutionStep {
    id: string;
    toolName: string;
    parameters: Record<string, unknown>;
    dependencies: string[];
}
export interface ExecutionResult {
    success: boolean;
    outputs: unknown[];
}
/**
 * Parallel task executor with dependency resolution
 */
export declare class Executor {
    private pool;
    private config;
    constructor(config: ExecutorConfig);
    /**
     * Execute a plan with intelligent parallel/serial execution
     */
    execute(plan: ExecutionPlan, tools: ToolRegistry): Promise<ExecutionResult>;
    /**
     * Execute a single step
     */
    private executeStep;
    /**
     * Build dependency graph from execution plan
     */
    private buildDependencyGraph;
    /**
     * Shutdown executor
     */
    shutdown(): Promise<void>;
}

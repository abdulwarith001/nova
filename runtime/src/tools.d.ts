export interface ToolExecutionContext {
    sessionId?: string;
    userId?: string;
    autonomousExecution?: boolean;
    approvalToken?: string;
    approvalRequestId?: string;
}
export interface ToolDefinition {
    name: string;
    description: string;
    parametersSchema: Record<string, unknown>;
    permissions: string[];
    execute?: (params: Record<string, unknown>, context?: ToolExecutionContext) => Promise<unknown>;
    category?: "filesystem" | "browser" | "communication" | "system" | "data" | "google" | "other";
    keywords?: string[];
    examples?: string[];
    metadata?: {
        freshnessStrength?: "low" | "medium" | "high";
        structuredOutput?: boolean;
        latencyClass?: "low" | "medium" | "high";
        domainTags?: string[];
    };
}
export declare class ToolRegistry {
    private readonly tools;
    private readonly workerPath;
    private readonly generalPool;
    private readonly browserPool;
    constructor();
    private registerBuiltinTools;
    private resolveWorkerPath;
    private createPool;
    register(tool: ToolDefinition): void;
    get(name: string): ToolDefinition | undefined;
    list(): ToolDefinition[];
    execute(name: string, params: Record<string, unknown>, context?: ToolExecutionContext): Promise<unknown>;
    shutdown(): Promise<void>;
}

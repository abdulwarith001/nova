import type { ExecutionPlan } from "./executor";
export type SandboxMode = "none" | "process" | "container" | "vm";
export interface SecurityConfig {
    sandboxMode: SandboxMode;
    allowedTools: string[];
    deniedTools: string[];
}
/**
 * Security manager with capability-based permissions
 */
export declare class SecurityManager {
    private config;
    constructor(config: SecurityConfig);
    /**
     * Authorize an execution plan
     */
    authorize(plan: ExecutionPlan): void;
    /**
     * Get default security config
     */
    static default(): SecurityConfig;
}

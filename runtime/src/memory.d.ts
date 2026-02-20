import Database from "better-sqlite3";
export interface Memory {
    id: string;
    content: string;
    embedding?: number[];
    timestamp: number;
    importance: number;
    decayRate: number;
    tags: string[];
    source: string;
    sessionId?: string;
    metadata: Record<string, unknown>;
    category: "self" | "user" | "task" | "fact" | "conversation";
}
export interface UserProfile {
    name?: string;
    preferences: Record<string, unknown>;
    workStyle?: string;
    goals: string[];
    context: string[];
}
export interface AgentProfile {
    capabilities: string[];
    limitations: string[];
    preferences: Record<string, unknown>;
    version: string;
}
/**
 * Enhanced memory store with contextual awareness
 */
export declare class MemoryStore {
    private db;
    private userProfile;
    private agentProfile;
    private constructor();
    /**
     * Create a new memory store
     */
    static create(path: string): Promise<MemoryStore>;
    /**
     * Initialize database schema
     */
    private initializeSchema;
    /**
     * Load user and agent profiles
     */
    private loadProfiles;
    /**
     * Store a new memory
     */
    store(memory: Memory): Promise<void>;
    /**
     * Search memories with category filter
     */
    search(query: string, options?: {
        limit?: number;
        category?: Memory["category"];
        minImportance?: number;
    }): Promise<Memory[]>;
    /**
     * Get recent memories by category
     */
    getRecent(category: Memory["category"], limit?: number): Promise<Memory[]>;
    /**
     * Update user profile
     */
    updateUserProfile(updates: Partial<UserProfile>): Promise<void>;
    /**
     * Update agent profile
     */
    updateAgentProfile(updates: Partial<AgentProfile>): Promise<void>;
    /**
     * Get user profile
     */
    getUserProfile(): UserProfile;
    /**
     * Get agent profile
     */
    getAgentProfile(): AgentProfile;
    /**
     * Build context for agent
     */
    buildContext(query?: string): Promise<string>;
    /**
     * Store task execution in memory
     */
    storeExecution(task: any, result: any): Promise<void>;
    /**
     * Get the underlying database instance
     */
    getDatabase(): Database.Database;
    /**
     * Close database connection
     */
    close(): void;
}

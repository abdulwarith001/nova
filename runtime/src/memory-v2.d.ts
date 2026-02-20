import Database from "better-sqlite3";
export type ChannelType = "ws" | "telegram" | "whatsapp";
export type MessageRole = "system" | "user" | "assistant";
export type MemoryJobType = "post_turn_extract" | "post_turn_reflect" | "hourly_sweep" | "self_audit" | "conversation_analysis" | "self_discovery";
export interface StoredMessage {
    id: string;
    userId: string;
    conversationId: string;
    role: MessageRole;
    content: string;
    channel: ChannelType;
    createdAt: number;
    metadata: Record<string, unknown>;
}
export interface MemoryContextPackage {
    userId: string;
    conversationId: string;
    recentMessages: StoredMessage[];
    memoryItems: Array<{
        id: string;
        type: string;
        content: string;
        importance: number;
        confidence: number;
        createdAt: number;
    }>;
    userTraits: Array<{
        id: string;
        key: string;
        value: string;
        confidence: number;
        contradictionGroup?: string;
        createdAt: number;
    }>;
    agentTraits: Array<{
        id: string;
        key: string;
        value: string;
        confidence: number;
        createdAt: number;
    }>;
    relationships: Array<{
        id: string;
        subject: string;
        relation: string;
        object: string;
        confidence: number;
        createdAt: number;
    }>;
    assembledSystemPrompt: string;
}
export interface LearningJob {
    id: string;
    userId: string;
    conversationId: string;
    type: MemoryJobType;
    payload: Record<string, unknown>;
    status: "pending" | "processing" | "completed" | "failed" | "dead_letter";
    attempts: number;
    maxAttempts: number;
    runAfter: number;
    createdAt: number;
    updatedAt: number;
}
export interface AutonomyEvaluationResult {
    userId: string;
    checkedAt: number;
    shouldSendProactive: boolean;
    reason: string;
    draftedMessage?: string;
    createdEventIds: string[];
}
export interface ProactiveEvent {
    id: string;
    userId: string;
    channel: ChannelType;
    eventType: "check_in" | "suggestion" | "follow_up";
    message: string;
    status: "pending" | "sent" | "dropped";
    reason?: string;
    createdAt: number;
}
export interface QueueProactiveEventInput {
    userId: string;
    channel: ChannelType;
    message: string;
    eventType?: ProactiveEvent["eventType"];
    reason?: string;
    metadata?: Record<string, unknown>;
}
export interface ApprovalRequest {
    id: string;
    userId: string;
    actionType: string;
    actionPayload: Record<string, unknown>;
    status: "pending" | "approved" | "rejected" | "consumed" | "expired";
    reason: string;
    token: string;
    expiresAt: number;
    createdAt: number;
    approvedAt?: number;
    rejectedAt?: number;
}
export declare class ConversationStore {
    private readonly db;
    constructor(db: Database.Database);
    ensureUser(userId: string): void;
    ensureConversation(input: {
        userId: string;
        conversationId: string;
        channel: ChannelType;
        status?: "active" | "archived";
    }): void;
    appendMessage(input: {
        userId: string;
        conversationId: string;
        role: MessageRole;
        content: string;
        channel: ChannelType;
        metadata?: Record<string, unknown>;
    }): StoredMessage;
    getRecentMessages(input: {
        userId: string;
        conversationId?: string;
        limit?: number;
    }): StoredMessage[];
    getLastUserActivity(userId: string): number | null;
}
export declare class KnowledgeStore {
    private readonly db;
    constructor(db: Database.Database);
    addMemoryItem(input: {
        userId: string;
        type: string;
        content: string;
        importance?: number;
        confidence?: number;
        metadata?: Record<string, unknown>;
    }): string;
    addEvidence(input: {
        userId: string;
        memoryItemId: string;
        messageId?: string;
        confidence?: number;
        excerpt?: string;
        metadata?: Record<string, unknown>;
    }): string;
    upsertUserTrait(input: {
        userId: string;
        key: string;
        value: string;
        confidence?: number;
        contradictionGroup?: string;
        metadata?: Record<string, unknown>;
    }): string;
    upsertAgentTrait(input: {
        key: string;
        value: string;
        confidence?: number;
        metadata?: Record<string, unknown>;
    }): string;
    upsertRelationship(input: {
        userId: string;
        subject: string;
        relation: string;
        object: string;
        confidence?: number;
        metadata?: Record<string, unknown>;
    }): string;
    getTopMemoryItems(userId: string, limit?: number): Array<{
        id: string;
        type: string;
        content: string;
        importance: number;
        confidence: number;
        createdAt: number;
    }>;
    getUserTraits(userId: string, limit?: number): Array<{
        id: string;
        key: string;
        value: string;
        confidence: number;
        contradictionGroup?: string;
        createdAt: number;
    }>;
    getAgentTraits(limit?: number): Array<{
        id: string;
        key: string;
        value: string;
        confidence: number;
        createdAt: number;
    }>;
    getRelationships(userId: string, limit?: number): Array<{
        id: string;
        subject: string;
        relation: string;
        object: string;
        confidence: number;
        createdAt: number;
    }>;
    getStatus(userId: string): Record<string, number>;
    exportUserData(userId: string): Record<string, unknown>;
    forgetScope(userId: string, scope: "all" | "traits" | "relationships" | "memories"): {
        deletedRows: number;
    };
    addAuditLog(input: {
        userId: string;
        action: string;
        scope: string;
        detail: string;
        metadata?: Record<string, unknown>;
    }): string;
}
export declare class ContextAssembler {
    private readonly conversationStore;
    private readonly knowledgeStore;
    constructor(conversationStore: ConversationStore, knowledgeStore: KnowledgeStore);
    buildContext(input: {
        userId: string;
        conversationId: string;
        messageLimit?: number;
        memoryLimit?: number;
        traitLimit?: number;
    }): MemoryContextPackage;
}
export declare class LearningEngine {
    private readonly db;
    constructor(db: Database.Database);
    enqueueJob(input: {
        userId: string;
        conversationId: string;
        type: MemoryJobType;
        payload?: Record<string, unknown>;
        maxAttempts?: number;
        runAfter?: number;
    }): string;
    listPendingJobs(limit?: number, now?: number): LearningJob[];
    markProcessing(id: string): void;
    markCompleted(id: string): void;
    markFailed(id: string, attempts: number, maxAttempts: number, error: string): void;
}
export declare class AutonomyEngine {
    private readonly db;
    private readonly conversationStore;
    private readonly knowledgeStore;
    constructor(db: Database.Database, conversationStore: ConversationStore, knowledgeStore: KnowledgeStore);
    evaluateAndQueue(input: {
        userId: string;
        channels?: ChannelType[];
        now?: number;
        dailyCap?: number;
        cooldownMs?: number;
        idleThresholdMs?: number;
    }): AutonomyEvaluationResult;
    queueProactiveEvent(input: QueueProactiveEventInput): string;
    listPendingProactiveEvents(limit?: number): ProactiveEvent[];
    markProactiveSent(id: string): void;
    markProactiveDropped(id: string, reason: string): void;
    createApprovalRequest(input: {
        userId: string;
        actionType: string;
        actionPayload: Record<string, unknown>;
        reason: string;
        ttlMs?: number;
    }): {
        id: string;
        token: string;
        expiresAt: number;
    };
    listApprovalRequests(input: {
        userId?: string;
        status?: ApprovalRequest["status"];
        limit?: number;
    }): ApprovalRequest[];
    approveRequest(input: {
        requestId: string;
        userId?: string;
    }): {
        id: string;
        token: string;
        expiresAt: number;
    } | null;
    rejectRequest(input: {
        requestId: string;
        userId?: string;
        reason?: string;
    }): boolean;
    consumeApprovalToken(input: {
        userId: string;
        actionType: string;
        token: string;
        requestId?: string;
    }): {
        approved: boolean;
        requestId?: string;
        reason?: string;
    };
    requiresApproval(toolName: string): boolean;
    private expireStaleApprovals;
    private rowToApprovalRequest;
}
export declare class MemoryV2 {
    private readonly db;
    private readonly conversationStore;
    private readonly knowledgeStore;
    private readonly contextAssembler;
    private readonly learningEngine;
    private readonly autonomyEngine;
    private constructor();
    static create(path: string): Promise<MemoryV2>;
    getConversationStore(): ConversationStore;
    getKnowledgeStore(): KnowledgeStore;
    getContextAssembler(): ContextAssembler;
    getLearningEngine(): LearningEngine;
    getAutonomyEngine(): AutonomyEngine;
    enqueueLearningJob(input: {
        userId: string;
        conversationId: string;
        type: MemoryJobType;
        payload?: Record<string, unknown>;
        maxAttempts?: number;
        runAfter?: number;
    }): string;
    processPendingLearningJobs(input: {
        limit?: number;
        handler: (job: LearningJob) => Promise<void>;
    }): Promise<{
        processed: number;
        failed: number;
    }>;
    evaluateAutonomousActions(input: {
        userId: string;
        channels?: ChannelType[];
    }): AutonomyEvaluationResult;
    listPendingProactiveEvents(limit?: number): ProactiveEvent[];
    queueProactiveEvent(input: QueueProactiveEventInput): string;
    markProactiveSent(id: string): void;
    markProactiveDropped(id: string, reason: string): void;
    createApprovalRequest(input: {
        userId: string;
        actionType: string;
        actionPayload: Record<string, unknown>;
        reason: string;
        ttlMs?: number;
    }): {
        id: string;
        token: string;
        expiresAt: number;
    };
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
    consumeApprovalToken(input: {
        userId: string;
        actionType: string;
        token: string;
        requestId?: string;
    }): {
        approved: boolean;
        requestId?: string;
        reason?: string;
    };
    requiresApproval(toolName: string): boolean;
    close(): void;
    private bootstrapAgentIdentity;
    private initializeSchema;
}

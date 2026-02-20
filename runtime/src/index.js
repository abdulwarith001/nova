import { Executor } from "./executor";
import { MemoryStore } from "./memory";
import { MemoryV2, } from "./memory-v2";
import { SecurityManager } from "./security";
import { ToolRegistry } from "./tools";
import { Planner } from "./planner";
import { GmailClient } from "./email/gmail-client.js";
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
function loadRuntimeConfig() {
    const configPath = join(homedir(), ".nova", "config.json");
    if (!existsSync(configPath))
        return {};
    try {
        const configJson = JSON.parse(readFileSync(configPath, "utf-8"));
        return { notificationEmail: configJson.notificationEmail };
    }
    catch {
        return {};
    }
}
/**
 * Nova Runtime - Core execution engine
 */
export class Runtime {
    executor;
    memory;
    security;
    tools;
    planner;
    memoryV2;
    gmailClient;
    constructor(executor, memory, security, tools, planner, memoryV2, gmailClient) {
        this.executor = executor;
        this.memory = memory;
        this.security = security;
        this.tools = tools;
        this.planner = planner;
        this.memoryV2 = memoryV2;
        this.gmailClient = gmailClient;
    }
    /**
     * Create a new runtime instance
     */
    static async create(config) {
        const memory = await MemoryStore.create(config.memoryPath);
        const memoryV2 = config.enableMemoryV2 === true
            ? await MemoryV2.create(config.memoryV2Path ||
                (config.memoryPath === ":memory:"
                    ? ":memory:"
                    : config.memoryPath.replace(/memory(\.db)?$/, "memory-v2.db")))
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
                        description: "Optional category filter (self|user|task|fact|conversation)",
                    },
                    minImportance: {
                        type: "number",
                        description: "Optional minimum importance threshold",
                    },
                },
            },
            permissions: [],
            execute: async (params) => {
                const query = String(params.query || "").trim();
                const limit = Math.max(1, Math.min(20, Number.isFinite(Number(params.limit)) ? Number(params.limit) : 5));
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
                    category: allowedCategories.has(category)
                        ? category
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
        const runtimeConfig = loadRuntimeConfig();
        const defaultNotificationEmail = process.env.NOTIFICATION_EMAIL || runtimeConfig.notificationEmail;
        // Initialize Gmail client if configured (decrypt credentials)
        let gmailClient = null;
        if (GmailClient.isConfigured()) {
            try {
                // Import decrypt function
                const { decrypt } = await import("./utils/encryption.js");
                gmailClient = new GmailClient({
                    clientId: decrypt(process.env.GMAIL_CLIENT_ID),
                    clientSecret: decrypt(process.env.GMAIL_CLIENT_SECRET),
                    refreshToken: decrypt(process.env.GMAIL_REFRESH_TOKEN),
                });
                console.log("📧 Gmail client initialized");
            }
            catch (error) {
                console.log("⚠️  Gmail not configured properly:", error);
            }
        }
        // Register Gmail email tools if configured
        if (gmailClient) {
            // email_read - Read recent emails
            tools.register({
                name: "email_read",
                description: "Read recent emails from Gmail inbox. Can filter with Gmail query syntax.",
                parametersSchema: {
                    type: "object",
                    properties: {
                        maxResults: {
                            type: "number",
                            description: "Number of emails to retrieve (default: 10, max: 50)",
                        },
                        query: {
                            type: "string",
                            description: "Gmail search query (e.g., 'is:unread', 'from:boss@company.com', 'subject:urgent')",
                        },
                    },
                },
                permissions: [],
                execute: async (params) => {
                    const messages = await gmailClient.listMessages({
                        maxResults: Math.min(params.maxResults || 10, 50),
                        query: params.query,
                    });
                    return {
                        count: messages.length,
                        messages: messages.map((m) => ({
                            id: m.id,
                            from: m.from,
                            subject: m.subject,
                            snippet: m.snippet,
                            date: m.date.toISOString(),
                            isUnread: m.isUnread,
                        })),
                    };
                },
            });
            // email_send - Send new email
            tools.register({
                name: "email_send",
                description: "Send a new email via Gmail",
                parametersSchema: {
                    type: "object",
                    properties: {
                        to: {
                            type: "string",
                            description: "Recipient email(s), comma-separated if multiple",
                        },
                        subject: {
                            type: "string",
                            description: "Email subject line",
                        },
                        body: {
                            type: "string",
                            description: "Email body (plain text)",
                        },
                    },
                    required: ["to", "subject", "body"],
                },
                permissions: [],
                execute: async (params) => {
                    const recipients = params.to.split(",").map((s) => s.trim());
                    const result = await gmailClient.sendEmail({
                        to: recipients,
                        subject: params.subject,
                        body: params.body,
                    });
                    return {
                        success: true,
                        messageId: result.messageId,
                        message: `Email sent to ${recipients.join(", ")}`,
                    };
                },
            });
            // email_reply - Reply to thread
            tools.register({
                name: "email_reply",
                description: "Reply to an email thread",
                parametersSchema: {
                    type: "object",
                    properties: {
                        threadId: {
                            type: "string",
                            description: "Email thread ID to reply to",
                        },
                        body: {
                            type: "string",
                            description: "Reply message body",
                        },
                    },
                    required: ["threadId", "body"],
                },
                permissions: [],
                execute: async (params) => {
                    const result = await gmailClient.replyToEmail({
                        threadId: params.threadId,
                        body: params.body,
                    });
                    return {
                        success: true,
                        messageId: result.messageId,
                        message: `Reply sent to thread ${params.threadId}`,
                    };
                },
            });
            // email_search - Search emails
            tools.register({
                name: "email_search",
                description: "Search Gmail with query syntax (e.g., 'from:john@example.com subject:meeting')",
                parametersSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Gmail search query using Gmail syntax (same as search bar)",
                        },
                    },
                    required: ["query"],
                },
                permissions: [],
                execute: async (params) => {
                    const messages = await gmailClient.search(params.query);
                    return {
                        count: messages.length,
                        messages: messages.map((m) => ({
                            id: m.id,
                            threadId: m.threadId,
                            from: m.from,
                            subject: m.subject,
                            snippet: m.snippet,
                            date: m.date.toISOString(),
                        })),
                    };
                },
            });
            console.log("📧 Registered 4 Gmail email tools");
        }
        // Register external-data email tool
        tools.register({
            name: "external_data_email_send",
            description: "Collect external web data and send summary email",
            category: "communication",
            keywords: ["external-data", "email", "send", "summary", "report"],
            examples: [
                "check latest stock prices and email me",
                "gather trending topics and send to my friend",
            ],
            parametersSchema: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Query to search for",
                    },
                    recipientEmail: {
                        type: "string",
                        description: "Email recipient for the summary",
                    },
                    timeZone: {
                        type: "string",
                        description: "Optional IANA time zone (e.g., America/New_York)",
                    },
                    deliverySubject: {
                        type: "string",
                        description: "Optional email subject override",
                    },
                },
                required: ["query", "recipientEmail"],
            },
            permissions: [],
            execute: async (params) => {
                if (!gmailClient) {
                    return {
                        success: false,
                        error: "Email not configured. Run `nova config email-setup`.",
                    };
                }
                if (!params.recipientEmail && defaultNotificationEmail) {
                    params.recipientEmail = defaultNotificationEmail;
                }
                if (!params.recipientEmail) {
                    return {
                        success: false,
                        error: "recipientEmail is required for scheduled external-data emails",
                    };
                }
                const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(params.recipientEmail));
                if (!isValid) {
                    return {
                        success: false,
                        error: "Invalid recipientEmail format",
                    };
                }
                const results = (await tools.execute("web_search", {
                    query: params.query,
                }));
                const subject = params.deliverySubject || `External data: ${String(params.query)}`;
                const lines = [`External data results for: ${params.query}`, ""];
                for (const result of results.results || []) {
                    lines.push(`- ${result.title}`);
                    lines.push(`  ${result.snippet || result.description || ""}`);
                    lines.push(`  ${result.url}`);
                    lines.push("");
                }
                if (results.results.length === 0) {
                    lines.push("No results found.");
                }
                await gmailClient.sendEmail({
                    to: [String(params.recipientEmail)],
                    subject,
                    body: lines.join("\n"),
                });
                return {
                    success: true,
                    message: `External data email sent to ${params.recipientEmail}`,
                };
            },
        });
        const runtimeInstance = new Runtime(executor, memory, security, tools, planner, memoryV2, gmailClient);
        return runtimeInstance;
    }
    /**
     * Execute a task
     */
    async execute(task) {
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
    getMemory() {
        return this.memory;
    }
    /**
     * Get memory v2 store (nullable when disabled)
     */
    getMemoryV2() {
        return this.memoryV2;
    }
    /**
     * Enqueue a memory-v2 learning job.
     */
    enqueueLearningJob(input) {
        if (!this.memoryV2) {
            throw new Error("Memory V2 is disabled");
        }
        return this.memoryV2.enqueueLearningJob(input);
    }
    /**
     * Process pending memory-v2 learning jobs.
     */
    async processPendingLearningJobs(input) {
        if (!this.memoryV2) {
            return { processed: 0, failed: 0 };
        }
        return await this.memoryV2.processPendingLearningJobs(input);
    }
    /**
     * Evaluate autonomous actions/check-ins for a user.
     */
    evaluateAutonomousActions(input) {
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
    listApprovalRequests(input) {
        if (!this.memoryV2)
            return [];
        return this.memoryV2.listApprovalRequests(input);
    }
    approveApprovalRequest(input) {
        if (!this.memoryV2)
            return null;
        return this.memoryV2.approveApprovalRequest(input);
    }
    rejectApprovalRequest(input) {
        if (!this.memoryV2)
            return false;
        return this.memoryV2.rejectApprovalRequest(input);
    }
    /**
     * List pending proactive events queued by autonomy engine.
     */
    listPendingProactiveEvents(limit = 20) {
        if (!this.memoryV2)
            return [];
        return this.memoryV2.listPendingProactiveEvents(limit);
    }
    markProactiveSent(eventId) {
        if (!this.memoryV2)
            return;
        this.memoryV2.markProactiveSent(eventId);
    }
    markProactiveDropped(eventId, reason) {
        if (!this.memoryV2)
            return;
        this.memoryV2.markProactiveDropped(eventId, reason);
    }
    /**
     * Get tool registry
     */
    getTools() {
        return this.tools;
    }
    /**
     * Get Gmail client
     */
    getGmailClient() {
        return this.gmailClient;
    }
    /**
     * Execute a tool by name (for gateway/chat integration)
     */
    async executeTool(name, params, context) {
        this.enforceAutonomousApproval(name, params, context);
        return await this.tools.execute(name, params, context);
    }
    enforceAutonomousApproval(name, params, context) {
        if (!this.memoryV2)
            return;
        if (context?.autonomousExecution !== true)
            return;
        if (!this.memoryV2.requiresApproval(name))
            return;
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
    getToolsForAgent() {
        return this.tools.list().map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parametersSchema,
        }));
    }
    /**
     * Execute a task with the agent (simplified API for gateway)
     */
    async executeTask(task, config) {
        const executionPlan = {
            taskId: config?.sessionId || `task-${Date.now()}`,
            steps: [],
        };
        return await this.executor.execute(executionPlan, this.tools);
    }
    /**
     * Shutdown runtime
     */
    async shutdown() {
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
//# sourceMappingURL=index.js.map
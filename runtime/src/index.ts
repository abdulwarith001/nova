import { Executor, ExecutorConfig } from "./executor";
import { MemoryStore } from "./memory";
import { SecurityManager, SecurityConfig } from "./security";
import { ToolRegistry } from "./tools";
import { Planner } from "./planner";

import { GmailClient } from "./email/gmail-client.js";
import { AgentConfig } from "../../agent/src/index.ts";
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
  security: SecurityConfig;
  executor: ExecutorConfig;
  agent: AgentConfig;
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

  private gmailClient: GmailClient | null;

  private constructor(
    executor: Executor,
    memory: MemoryStore,
    security: SecurityManager,
    tools: ToolRegistry,
    planner: Planner,
    gmailClient: GmailClient | null,
  ) {
    this.executor = executor;
    this.memory = memory;
    this.security = security;
    this.tools = tools;
    this.planner = planner;
    this.gmailClient = gmailClient;
  }

  /**
   * Create a new runtime instance
   */
  static async create(config: RuntimeConfig): Promise<Runtime> {
    const memory = await MemoryStore.create(config.memoryPath);
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
          Math.min(20, Number.isFinite(Number(params.limit)) ? Number(params.limit) : 5),
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

    const runtimeConfig = loadRuntimeConfig();
    const defaultNotificationEmail =
      process.env.NOTIFICATION_EMAIL || runtimeConfig.notificationEmail;

    // Initialize Gmail client if configured (decrypt credentials)
    let gmailClient: GmailClient | null = null;
    if (GmailClient.isConfigured()) {
      try {
        // Import decrypt function
        const { decrypt } = await import("../../cli/src/utils/encryption");
        gmailClient = new GmailClient({
          clientId: decrypt(process.env.GMAIL_CLIENT_ID!),
          clientSecret: decrypt(process.env.GMAIL_CLIENT_SECRET!),
          refreshToken: decrypt(process.env.GMAIL_REFRESH_TOKEN!),
        });
        console.log("📧 Gmail client initialized");
      } catch (error) {
        console.log("⚠️  Gmail not configured properly:", error);
      }
    }

    // Register Gmail email tools if configured
    if (gmailClient) {
      // email_read - Read recent emails
      tools.register({
        name: "email_read",
        description:
          "Read recent emails from Gmail inbox. Can filter with Gmail query syntax.",
        parametersSchema: {
          type: "object",
          properties: {
            maxResults: {
              type: "number",
              description:
                "Number of emails to retrieve (default: 10, max: 50)",
            },
            query: {
              type: "string",
              description:
                "Gmail search query (e.g., 'is:unread', 'from:boss@company.com', 'subject:urgent')",
            },
          },
        },
        permissions: [],
        execute: async (params: any) => {
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
        execute: async (params: any) => {
          const recipients = params.to.split(",").map((s: string) => s.trim());
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
        execute: async (params: any) => {
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
        description:
          "Search Gmail with query syntax (e.g., 'from:john@example.com subject:meeting')",
        parametersSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Gmail search query using Gmail syntax (same as search bar)",
            },
          },
          required: ["query"],
        },
        permissions: [],
        execute: async (params: any) => {
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

    // Register research email tool
    tools.register({
      name: "research_email_send",
      description: "Run web research and send summary email",
      category: "communication",
      keywords: ["research", "email", "send", "summary", "report"],
      examples: [
        "research latest stock prices and email me",
        "research trending topics and send to my friend",
      ],
      parametersSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Research query to search for",
          },
          recipientEmail: {
            type: "string",
            description: "Email recipient for the research summary",
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
      execute: async (params: any) => {
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
            error: "recipientEmail is required for scheduled research emails",
          };
        }

        const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
          String(params.recipientEmail),
        );
        if (!isValid) {
          return {
            success: false,
            error: "Invalid recipientEmail format",
          };
        }

        const results = (await tools.execute("search_web", {
          query: params.query,
        })) as {
          results: Array<{ title: string; url: string; description: string }>;
        };

        const subject =
          params.deliverySubject || `Research: ${String(params.query)}`;
        const lines = [`Research results for: ${params.query}`, ""];
        for (const result of results.results || []) {
          lines.push(`- ${result.title}`);
          lines.push(`  ${result.description}`);
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
          message: `Research email sent to ${params.recipientEmail}`,
        };
      },
    });

    const runtimeInstance = new Runtime(
      executor,
      memory,
      security,
      tools,
      planner,

      gmailClient,
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
   * Get tool registry
   */
  getTools(): ToolRegistry {
    return this.tools;
  }

  /**
   * Get Gmail client
   */
  getGmailClient(): GmailClient | null {
    return this.gmailClient;
  }

  /**
   * Execute a tool by name (for gateway/chat integration)
   */
  async executeTool(
    name: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return await this.tools.execute(name, params);
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
    return await this.executor.execute(config?.sessionId || "default", {
      task,
      maxIterations: config?.maxIterations || 10,
    });
  }

  /**
   * Shutdown runtime
   */
  async shutdown(): Promise<void> {
    await this.executor.shutdown();
    this.memory.close();
  }
}

// Re-export types
export * from "./executor";
export * from "./memory";
export * from "./security";
export * from "./tools";
export * from "./planner";

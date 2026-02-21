import { existsSync } from "fs";
import { dirname, join } from "path";
import Piscina from "piscina";
import { fileURLToPath } from "url";

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
  execute?: (
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ) => Promise<unknown>;
  category?:
    | "filesystem"
    | "browser"
    | "communication"
    | "system"
    | "data"
    | "google"
    | "other";
  keywords?: string[];
  examples?: string[];
  metadata?: {
    freshnessStrength?: "low" | "medium" | "high";
    structuredOutput?: boolean;
    latencyClass?: "low" | "medium" | "high";
    domainTags?: string[];
  };
}

export class ToolRegistry {
  private readonly tools: Map<string, ToolDefinition> = new Map();
  private readonly workerPath: string;
  private readonly generalPool: Piscina;
  private readonly browserPool: Piscina;

  constructor() {
    this.workerPath = this.resolveWorkerPath();
    this.generalPool = this.createPool(4);
    this.browserPool = this.createPool(1);
    this.registerBuiltinTools();
  }

  private registerBuiltinTools(): void {
    this.register({
      name: "bash",
      description: "Execute shell commands",
      category: "system",
      keywords: ["command", "shell", "execute", "terminal", "run", "script"],
      examples: ["list files", "run a script", "check process status"],
      parametersSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command to execute",
          },
        },
        required: ["command"],
      },
      permissions: ["process"],
    });

    this.register({
      name: "read",
      description: "Read file contents",
      category: "filesystem",
      keywords: ["file", "read", "open", "contents", "view"],
      examples: ["read config file", "open markdown file"],
      parametersSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path to read",
          },
        },
        required: ["path"],
      },
      permissions: ["filesystem:read"],
    });

    this.register({
      name: "write",
      description: "Write file contents",
      category: "filesystem",
      keywords: ["file", "write", "create", "save", "update"],
      examples: ["write config file", "create text file"],
      parametersSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path to write",
          },
          content: {
            type: "string",
            description: "Content to write",
          },
        },
        required: ["path", "content"],
      },
      permissions: ["filesystem:write"],
    });

    // === Internal tools (used by external data orchestrator, hidden from direct chat LLM) ===
    this.register({
      name: "curl",
      description: "Make raw HTTP requests",
      category: "communication",
      parametersSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to request" },
          method: { type: "string", description: "HTTP method" },
          headers: { type: "object", description: "Request headers" },
          body: { type: "string", description: "Request body" },
          json: { description: "JSON payload" },
          timeoutMs: { type: "number" },
          followRedirects: { type: "boolean" },
          maxChars: { type: "number" },
        },
        required: ["url"],
      },
      permissions: ["network"],
    });
  }

  private resolveWorkerPath(): string {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const tsWorker = join(__dirname, "worker.ts");
    const jsWorkerDist = join(dirname(__dirname), "dist", "worker.js");
    const jsWorkerSrc = join(__dirname, "worker.js");

    if (existsSync(tsWorker)) return tsWorker;
    if (existsSync(jsWorkerDist)) return jsWorkerDist;
    return jsWorkerSrc;
  }

  private createPool(maxThreads: number): Piscina {
    const execArgv = this.workerPath.endsWith(".ts")
      ? (["--import", "tsx"] as string[])
      : undefined;

    return new Piscina({
      filename: this.workerPath,
      maxThreads,
      idleTimeout: 60_000,
      execArgv,
    });
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async execute(
    name: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    if (tool.execute) {
      return await tool.execute(params, context);
    }

    const pool = name.startsWith("web_") ? this.browserPool : this.generalPool;
    return await pool.run({ toolName: name, parameters: params, context });
  }

  async shutdown(): Promise<void> {
    await this.generalPool.destroy();
    await this.browserPool.destroy();
  }
}

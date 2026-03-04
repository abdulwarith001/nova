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
      name: "update_profile",
      description:
        "Update the user profile or agent identity file. Use this whenever you learn something new about the user (name, preferences, projects, etc.) or about yourself (learned behaviors, communication adjustments). The profile content is always available to you in context.",
      category: "data",
      keywords: [
        "update",
        "profile",
        "memory",
        "remember",
        "learn",
        "user",
        "identity",
      ],
      examples: [
        "update user profile with their name",
        "remember their timezone",
        "update my identity with learned behavior",
      ],
      parametersSchema: {
        type: "object",
        properties: {
          file: {
            type: "string",
            enum: ["user", "identity"],
            description:
              "Which profile to update: 'user' for user info, 'identity' for agent self-knowledge",
          },
          content: {
            type: "string",
            description:
              "The full updated Markdown content for the profile. You must include ALL existing sections — this replaces the entire file. Read the current profile first, then modify the relevant section.",
          },
        },
        required: ["file", "content"],
      },
      permissions: [],
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

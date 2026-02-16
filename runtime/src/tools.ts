export interface ToolDefinition {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  permissions: string[];
  execute?: (params: Record<string, unknown>) => Promise<unknown>;

  // Tool selection metadata
  category?:
    | "filesystem"
    | "browser"
    | "communication"
    | "system"
    | "data"
    | "other";
  keywords?: string[];
  examples?: string[];
}

/**
 * Tool registry for managing available tools
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor() {
    this.registerBuiltinTools();
  }

  /**
   * Register built-in tools
   */
  private registerBuiltinTools(): void {
    // Bash tool
    this.register({
      name: "bash",
      description: "Execute shell commands",
      category: "system",
      keywords: ["command", "shell", "execute", "terminal", "run", "script"],
      examples: [
        "list files in current directory",
        "check disk usage",
        "run a shell script",
      ],
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

    // Read tool
    this.register({
      name: "read",
      description: "Read file contents",
      category: "filesystem",
      keywords: ["file", "read", "open", "contents", "view"],
      examples: [
        "read a configuration file",
        "view file contents",
        "check what's in a file",
      ],
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

    // Write tool
    this.register({
      name: "write",
      description: "Write file contents",
      category: "filesystem",
      keywords: ["file", "write", "create", "save", "update"],
      examples: [
        "create a new file",
        "save text to a file",
        "write configuration",
      ],
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

    // Web search tool
    this.register({
      name: "search_web",
      description:
        "Search the web for current information, news, and real-time data. Use this for queries about current events, news, or when you need up-to-date information.",
      category: "communication",
      keywords: [
        "search",
        "google",
        "web",
        "internet",
        "news",
        "online",
        "find",
        "lookup",
        "query",
      ],
      examples: [
        "search for latest news",
        "find information online",
        "google something",
        "lookup current events",
      ],
      parametersSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
        },
        required: ["query"],
      },
      permissions: ["network"],
    });

    this.register({
      name: "fetch_url",
      description:
        "Fetch a URL and return its status, title, HTML, plain text, and publish date metadata when available.",
      category: "communication",
      keywords: ["fetch", "url", "http", "webpage", "article", "source"],
      examples: [
        "fetch a news article URL",
        "retrieve webpage text",
        "inspect source page content",
      ],
      parametersSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "HTTP/HTTPS URL to fetch",
          },
          timeoutMs: {
            type: "number",
            description: "Optional request timeout in milliseconds",
          },
        },
        required: ["url"],
      },
      permissions: ["network"],
    });

    this.register({
      name: "extract_main_content",
      description:
        "Extract main article/content text from HTML or by fetching a URL. Returns text quality score and word count.",
      category: "data",
      keywords: ["extract", "content", "article", "main text", "summarize"],
      examples: [
        "extract main content from a webpage",
        "clean article body from HTML",
      ],
      parametersSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Optional URL to fetch and extract from",
          },
          html: {
            type: "string",
            description: "Optional raw HTML to extract main content from",
          },
          timeoutMs: {
            type: "number",
            description: "Optional timeout when url is provided",
          },
        },
      },
      permissions: ["network"],
    });

    this.register({
      name: "memory_search",
      description:
        "Search Nova memory for prior conversations, facts, and context.",
      category: "data",
      keywords: ["memory", "history", "context", "recall", "past"],
      examples: [
        "search memory for previous discussion",
        "recall past conversation context",
      ],
      parametersSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for memory recall",
          },
          limit: {
            type: "number",
            description: "Maximum number of memory entries to return",
          },
          category: {
            type: "string",
            description:
              "Optional memory category (self|user|task|fact|conversation)",
          },
          minImportance: {
            type: "number",
            description: "Optional minimum importance threshold",
          },
        },
      },
      permissions: [],
    });

    this.register({
      name: "browser_navigate",
      description: "Navigate to a URL in a headless browser",
      category: "browser",
      keywords: ["browse", "visit", "navigate", "open", "website"],
      examples: ["visit a website", "open a URL in browser"],
      parametersSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to navigate to",
          },
          maxRetries: {
            type: "number",
            description: "Optional retry attempts for navigation",
          },
        },
        required: ["url"],
      },
      permissions: ["browser", "network"],
    });

    this.register({
      name: "browser_extract",
      description: "Extract page text from browser state",
      category: "browser",
      keywords: ["extract", "text", "page", "content"],
      examples: ["extract article text", "get content from current page"],
      parametersSchema: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "Optional CSS selector to target extraction",
          },
        },
      },
      permissions: ["browser"],
    });

    this.register({
      name: "browser_html",
      description: "Get current page HTML from browser state",
      category: "browser",
      keywords: ["html", "dom", "page source"],
      examples: ["get page html", "inspect current dom"],
      parametersSchema: {
        type: "object",
        properties: {},
      },
      permissions: ["browser"],
    });

    this.register({
      name: "browser_close",
      description: "Close active headless browser session",
      category: "browser",
      keywords: ["browser", "close", "cleanup"],
      examples: ["close browser session"],
      parametersSchema: {
        type: "object",
        properties: {},
      },
      permissions: ["browser"],
    });
  }

  /**
   * Register a tool
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * List all tools
   */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool by name
   */
  async execute(
    name: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    // If tool has custom execute function, use it
    if (tool.execute) {
      return await tool.execute(params);
    }

    // Otherwise, fall back to worker-based execution with tsx support
    const Piscina = (await import("piscina")).default;
    const { fileURLToPath } = await import("url");
    const { dirname, join } = await import("path");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const pool = new Piscina({
      filename: join(__dirname, "worker.ts"),
      execArgv: ["--import", "tsx"],
    });

    return await pool.run({ toolName: name, parameters: params });
  }
}

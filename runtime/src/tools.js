import { existsSync } from "fs";
import { dirname, join } from "path";
import Piscina from "piscina";
import { fileURLToPath } from "url";
export class ToolRegistry {
    tools = new Map();
    workerPath;
    generalPool;
    browserPool;
    constructor() {
        this.workerPath = this.resolveWorkerPath();
        this.generalPool = this.createPool(4);
        this.browserPool = this.createPool(1);
        this.registerBuiltinTools();
    }
    registerBuiltinTools() {
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
        this.register({
            name: "web_search",
            description: "Search the web for information. Returns a list of results with titles, URLs, and snippets. Use this when you need to find current information, facts, news, or answers to questions.",
            category: "browser",
            keywords: ["search", "web", "query", "latest", "news", "find", "look up"],
            examples: [
                "search latest AI news",
                "find product pricing",
                "look up current events",
            ],
            parametersSchema: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Search query — be specific for best results",
                    },
                    limit: {
                        type: "number",
                        description: "Maximum number of results (default 8)",
                    },
                },
                required: ["query"],
            },
            permissions: ["browser", "network"],
            metadata: {
                freshnessStrength: "high",
                structuredOutput: true,
                latencyClass: "medium",
                domainTags: ["web", "search", "discovery"],
            },
        });
        this.register({
            name: "browse",
            description: "Open a URL in a real browser, take a screenshot, and analyze the page visually. Use this for JavaScript-heavy sites, web apps, pages with dynamic content, or when you need to see what a page actually looks like. Returns title, text content, and a visual analysis of the page.",
            category: "browser",
            keywords: [
                "browse",
                "visit",
                "website",
                "page",
                "check",
                "look at",
                "open",
                "navigate",
            ],
            examples: [
                "check out noteiq.live",
                "visit the pricing page",
                "look at the homepage",
            ],
            parametersSchema: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "URL to browse (will add https:// if missing)",
                    },
                },
                required: ["url"],
            },
            permissions: ["browser", "network"],
            metadata: {
                freshnessStrength: "high",
                structuredOutput: true,
                latencyClass: "high",
                domainTags: ["web", "browse", "vision"],
            },
        });
        this.register({
            name: "scrape",
            description: "Extract readable content from a URL. Best for articles, blog posts, documentation, and text-heavy pages. Faster than browse — use this when you just need the text content, not the visual layout.",
            category: "data",
            keywords: [
                "scrape",
                "extract",
                "article",
                "read",
                "content",
                "text",
                "summarize",
            ],
            examples: [
                "read this article",
                "extract content from blog post",
                "get the text from this page",
            ],
            parametersSchema: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "URL to scrape (will add https:// if missing)",
                    },
                },
                required: ["url"],
            },
            permissions: ["network"],
            metadata: {
                freshnessStrength: "medium",
                structuredOutput: true,
                latencyClass: "medium",
                domainTags: ["web", "extraction", "content"],
            },
        });
        // === Google Workspace tools ===
        this.register({
            name: "gmail_list",
            description: "List recent emails from Gmail inbox. Returns subject, sender, date, and read status.",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    maxResults: {
                        type: "number",
                        description: "Max emails to return (default 10)",
                    },
                    query: {
                        type: "string",
                        description: "Optional Gmail search query (e.g. 'is:unread', 'from:boss@company.com')",
                    },
                },
            },
            permissions: ["google"],
        });
        this.register({
            name: "gmail_read",
            description: "Read the full content of a specific email by its message ID.",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    messageId: {
                        type: "string",
                        description: "The email message ID to read",
                    },
                },
                required: ["messageId"],
            },
            permissions: ["google"],
        });
        this.register({
            name: "gmail_send",
            description: "Send a new email. Composes and sends immediately.",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    to: {
                        type: "array",
                        items: { type: "string" },
                        description: "Recipient email addresses",
                    },
                    subject: { type: "string", description: "Email subject line" },
                    body: { type: "string", description: "Email body text" },
                },
                required: ["to", "subject", "body"],
            },
            permissions: ["google"],
        });
        this.register({
            name: "gmail_reply",
            description: "Reply to an existing email thread.",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    threadId: {
                        type: "string",
                        description: "The thread ID to reply to",
                    },
                    body: { type: "string", description: "Reply body text" },
                },
                required: ["threadId", "body"],
            },
            permissions: ["google"],
        });
        this.register({
            name: "gmail_search",
            description: "Search emails using Gmail query syntax (e.g. 'from:john subject:meeting', 'has:attachment', 'newer_than:7d').",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Gmail search query" },
                },
                required: ["query"],
            },
            permissions: ["google"],
        });
        this.register({
            name: "gmail_draft",
            description: "Create an email draft without sending it.",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    to: {
                        type: "array",
                        items: { type: "string" },
                        description: "Recipient email addresses",
                    },
                    subject: { type: "string", description: "Email subject line" },
                    body: { type: "string", description: "Draft body text" },
                },
                required: ["to", "subject", "body"],
            },
            permissions: ["google"],
        });
        this.register({
            name: "calendar_list",
            description: "List upcoming calendar events. Defaults to the next 7 days.",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    timeMin: {
                        type: "string",
                        description: "Start time ISO string (default: now)",
                    },
                    timeMax: {
                        type: "string",
                        description: "End time ISO string (default: 7 days from now)",
                    },
                    maxResults: {
                        type: "number",
                        description: "Max events (default 15)",
                    },
                },
            },
            permissions: ["google"],
        });
        this.register({
            name: "calendar_create",
            description: "Create a new calendar event.",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    summary: { type: "string", description: "Event title" },
                    start: { type: "string", description: "Start datetime ISO string" },
                    end: { type: "string", description: "End datetime ISO string" },
                    description: {
                        type: "string",
                        description: "Optional event description",
                    },
                    location: { type: "string", description: "Optional location" },
                    attendees: {
                        type: "array",
                        items: { type: "string" },
                        description: "Optional attendee emails",
                    },
                },
                required: ["summary", "start", "end"],
            },
            permissions: ["google"],
        });
        this.register({
            name: "calendar_search",
            description: "Search calendar events by text (searches past 6 months and next 6 months).",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search text" },
                },
                required: ["query"],
            },
            permissions: ["google"],
        });
        this.register({
            name: "drive_list",
            description: "List recent files from Google Drive, sorted by last modified.",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    maxResults: { type: "number", description: "Max files (default 15)" },
                },
            },
            permissions: ["google"],
        });
        this.register({
            name: "drive_search",
            description: "Search Google Drive files by name or content.",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Search query (matches file name and content)",
                    },
                },
                required: ["query"],
            },
            permissions: ["google"],
        });
        this.register({
            name: "drive_read",
            description: "Read the text content of a Google Drive file. Exports Google Docs as plain text, Sheets as CSV.",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    fileId: { type: "string", description: "The Drive file ID to read" },
                },
                required: ["fileId"],
            },
            permissions: ["google"],
        });
        this.register({
            name: "drive_upload",
            description: "Upload a text file to Google Drive.",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    name: { type: "string", description: "File name (e.g. 'notes.txt')" },
                    content: { type: "string", description: "Text content of the file" },
                    mimeType: {
                        type: "string",
                        description: "MIME type (default: text/plain)",
                    },
                    folderId: { type: "string", description: "Optional Drive folder ID" },
                },
                required: ["name", "content"],
            },
            permissions: ["google"],
        });
        this.register({
            name: "drive_create_pdf",
            description: "Create a PDF document and save it to Google Drive. Supports markdown-like headings (# and ##).",
            category: "google",
            parametersSchema: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "PDF title (also used as filename)",
                    },
                    content: {
                        type: "string",
                        description: "PDF body content. Use # for headings, ## for subheadings.",
                    },
                    folderId: { type: "string", description: "Optional Drive folder ID" },
                },
                required: ["title", "content"],
            },
            permissions: ["google"],
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
        this.register({
            name: "web_session_start",
            description: "Start a persistent web-agent session (internal)",
            category: "browser",
            parametersSchema: {
                type: "object",
                properties: {
                    profileId: { type: "string" },
                    headless: { type: "boolean" },
                    backend: { type: "string" },
                    fallbackOnError: { type: "boolean" },
                    viewport: { type: "object" },
                    locale: { type: "string" },
                    timezone: { type: "string" },
                    startUrl: { type: "string" },
                },
            },
            permissions: ["browser", "network"],
        });
        this.register({
            name: "web_observe",
            description: "Capture browser state (internal)",
            category: "browser",
            parametersSchema: {
                type: "object",
                properties: {
                    mode: { type: "string" },
                    includeScreenshot: { type: "boolean" },
                },
            },
            permissions: ["browser"],
        });
        this.register({
            name: "web_decide_next",
            description: "Decide next web action (internal)",
            category: "browser",
            parametersSchema: {
                type: "object",
                properties: {
                    goal: { type: "string" },
                    mode: { type: "string" },
                },
                required: ["goal"],
            },
            permissions: ["browser"],
        });
        this.register({
            name: "web_act",
            description: "Execute a web action (internal)",
            category: "browser",
            parametersSchema: {
                type: "object",
                properties: {
                    action: { type: "object" },
                    confirmationToken: { type: "string" },
                    mode: { type: "string" },
                },
                required: ["action"],
            },
            permissions: ["browser", "network"],
        });
        this.register({
            name: "web_extract_structured",
            description: "Extract structured content from page (internal)",
            category: "data",
            parametersSchema: {
                type: "object",
                properties: {
                    url: { type: "string" },
                },
            },
            permissions: ["browser", "network"],
        });
        this.register({
            name: "web_session_end",
            description: "End a web-agent session (internal)",
            category: "browser",
            parametersSchema: { type: "object", properties: {} },
            permissions: ["browser"],
        });
    }
    resolveWorkerPath() {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const tsWorker = join(__dirname, "worker.ts");
        const jsWorkerDist = join(dirname(__dirname), "dist", "worker.js");
        const jsWorkerSrc = join(__dirname, "worker.js");
        if (existsSync(tsWorker))
            return tsWorker;
        if (existsSync(jsWorkerDist))
            return jsWorkerDist;
        return jsWorkerSrc;
    }
    createPool(maxThreads) {
        const execArgv = this.workerPath.endsWith(".ts")
            ? ["--import", "tsx"]
            : undefined;
        return new Piscina({
            filename: this.workerPath,
            maxThreads,
            idleTimeout: 60_000,
            execArgv,
        });
    }
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    get(name) {
        return this.tools.get(name);
    }
    list() {
        return Array.from(this.tools.values());
    }
    async execute(name, params, context) {
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
    async shutdown() {
        await this.generalPool.destroy();
        await this.browserPool.destroy();
    }
}
//# sourceMappingURL=tools.js.map
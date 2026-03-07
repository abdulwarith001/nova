/**
 * Web Browsing skill — tool definitions with execute handlers.
 *
 * Exports a wireTools() function that registers all tools with their
 * execute handlers directly, instead of requiring separate wiring.
 */

import type { Agent } from "../../../agent/src/index.js";
import type { Runtime } from "../../../runtime/src/index.js";
import type { ToolDefinition } from "../../../runtime/src/tools.js";

/**
 * Register all web-browsing tools with execute handlers.
 */
export async function wireTools(runtime: Runtime, agent: Agent): Promise<void> {
  const { browse } =
    await import("../../../runtime/src/web-agent/browse-tool.js");
  const { scrape } =
    await import("../../../runtime/src/web-agent/scrape-tool.js");
  const { SearchService } =
    await import("../../../runtime/src/web-agent/search-service.js");
  const { WebSessionManager } =
    await import("../../../runtime/src/web-agent/session-manager.js");
  const { ActionExecutor } =
    await import("../../../runtime/src/web-agent/action-executor.js");
  const { WebAgentOrchestrator } =
    await import("../../../runtime/src/web-agent/orchestrator.js");
  const { WebWorldModelStore } =
    await import("../../../runtime/src/web-agent/world-model.js");

  const registry = runtime.getTools();
  const searchService = new SearchService();
  const sessionManager = new WebSessionManager();
  const actionExecutor = new ActionExecutor(sessionManager);
  const orchestrator = new WebAgentOrchestrator();
  const worldModels = new WebWorldModelStore();

  // ── Public tools ──

  registry.register({
    name: "web_search",
    description:
      "Search the web for information. Returns a list of results with titles, URLs, and snippets. Use this when you need to find current information, facts, news, or answers to questions. For in-depth multi-source research or evidence-backed analysis, use deep_research instead.",
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
    execute: async (params) => {
      const query = String(params.query || "").trim();
      if (!query) throw new Error("Missing query parameter");
      const results = await searchService.search(query, {
        limit: Number(params.limit) || 8,
      });
      return { count: results.length, results };
    },
  });

  registry.register({
    name: "browse",
    description:
      "Open a URL in a real browser, take a screenshot, and analyze the page visually. This is READ-ONLY — it cannot click buttons, fill forms, or interact with the page. Use this when you just need to see what a page looks like. For clicking, filling forms, or submitting, use web_session_start + web_act instead. For research across multiple sources, use deep_research instead.",
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
        sendScreenshot: {
          type: "boolean",
          description:
            "Set to true to send the screenshot to the user. Only use when the user explicitly asks for a screenshot.",
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
    execute: async (params) => {
      const url = String(params.url || "").trim();
      if (!url) throw new Error("Missing url parameter");
      return await browse(url, agent, params.sendScreenshot === true);
    },
  });

  registry.register({
    name: "scrape",
    description:
      "Extract readable content from a URL. Best for articles, blog posts, documentation, and text-heavy pages. Faster than browse — use this when you just need the text content, not the visual layout. For comprehensive research across multiple sources, use deep_research instead.",
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
    execute: async (params) => {
      const url = String(params.url || "").trim();
      if (!url) throw new Error("Missing url parameter");
      return await scrape(url);
    },
  });

  // ── Session-based web-agent tools ──

  registry.register({
    name: "web_session_start",
    description:
      "Start a persistent browser session for multi-step web interaction. Use this when you need to fill forms, click buttons, submit data, log in, or perform any interactive task on a website. After starting, use web_observe to see the page, web_act to interact, and web_session_end when done.",
    category: "browser",
    parametersSchema: {
      type: "object",
      properties: {
        profileId: {
          type: "string",
          description: "Browser profile ID (optional)",
        },
        headless: {
          type: "boolean",
          description: "Run headless (default true)",
        },
        backend: {
          type: "string",
          description: "Backend: auto, local, browserbase, steel",
        },
        fallbackOnError: {
          type: "boolean",
          description: "Fall back to local on remote error",
        },
        viewport: {
          type: "object",
          description: "Viewport size { width, height }",
        },
        locale: { type: "string", description: "Browser locale (e.g. en-US)" },
        timezone: {
          type: "string",
          description: "Timezone (e.g. America/New_York)",
        },
        startUrl: { type: "string", description: "Initial URL to navigate to" },
      },
    },
    permissions: ["browser", "network"],
    execute: async (params, context) => {
      const sessionId = context?.sessionId || `web-${Date.now()}`;
      const config = {
        profileId: String(params.profileId || sessionId),
        headless: params.headless !== false,
        viewport: (params.viewport as any) || { width: 1280, height: 900 },
        locale: String(params.locale || "en-US"),
        timezone: String(params.timezone || "UTC"),
        startUrl: params.startUrl ? String(params.startUrl) : undefined,
        backendPreference: params.backend
          ? (String(params.backend) as any)
          : "local",
        fallbackOnError: params.fallbackOnError as boolean | undefined,
      };
      const snapshot = await sessionManager.startSession(sessionId, config);
      worldModels.forSession(sessionId);
      return snapshot;
    },
  });

  registry.register({
    name: "web_observe",
    description:
      "Capture the current state of the browser page: URL, title, visible text, and all interactive elements (buttons, inputs, links). Use after web_session_start to see what's on the page before deciding what to do.",
    category: "browser",
    parametersSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "Observation mode: dom or dom+vision",
        },
        includeScreenshot: {
          type: "boolean",
          description: "Save a screenshot",
        },
      },
    },
    permissions: ["browser"],
    execute: async (params, context) => {
      const sessionId = context?.sessionId || "";
      if (!sessionId)
        throw new Error("No active session. Call web_session_start first.");
      const mode = String(params.mode || "dom") as "dom" | "dom+vision";
      const observation = await actionExecutor.observe(
        sessionId,
        mode,
        params.includeScreenshot === true,
      );
      const wm = worldModels.forSession(sessionId);
      wm.addObservation(observation);
      return observation;
    },
  });

  registry.register({
    name: "web_decide_next",
    description:
      "Analyze the current page state and recommend the best next action to accomplish a goal. Returns a suggested action with risk assessment.",
    category: "browser",
    parametersSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What you want to accomplish" },
        mode: {
          type: "string",
          description: "Observation mode: dom or dom+vision",
        },
      },
      required: ["goal"],
    },
    permissions: ["browser"],
    execute: async (params, context) => {
      const sessionId = context?.sessionId || "";
      const wm = worldModels.forSession(sessionId);
      const decision = orchestrator.decideNext({
        goal: String(params.goal || ""),
        observation: wm.getLatestObservation(),
        worldModel: wm,
        mode: params.mode as any,
      });
      return decision;
    },
  });

  registry.register({
    name: "web_act",
    description:
      "Execute a browser action: click a button, fill an input field, submit a form, scroll the page, or navigate to a URL. This is how you interact with web pages.",
    category: "browser",
    parametersSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Action type: click, fill, submit, scroll, navigate",
        },
        target: {
          type: "object",
          description:
            "Element target: { text?: string, css?: string, role?: string }",
        },
        value: {
          type: "string",
          description: "Value for fill actions (the text to type)",
        },
        url: {
          type: "string",
          description: "URL for navigate actions",
        },
        confirmationToken: {
          type: "string",
          description: "Token for high-risk actions",
        },
        mode: { type: "string", description: "Observation mode after action" },
      },
      required: ["type"],
    },
    permissions: ["browser", "network"],
    execute: async (params, context) => {
      const sessionId = context?.sessionId || "";
      if (!sessionId)
        throw new Error("No active session. Call web_session_start first.");

      // Accept both flat params {type, target, value} and nested {action: {type, target, value}}
      const action = (params.action as any) || {
        type: params.type,
        target: params.target,
        value: params.value,
        url: params.url,
      };

      if (!action.type) {
        throw new Error(
          'Missing action type. Provide { type: "click"|"fill"|"submit"|"scroll"|"navigate", target?: {...}, value?: "..." }',
        );
      }

      // Auto-observe and smart-target when no target is specified for fill/click
      if (
        !action.target &&
        (action.type === "fill" ||
          action.type === "click" ||
          action.type === "submit")
      ) {
        const obs = await actionExecutor.observe(sessionId, "dom", false);
        worldModels.forSession(sessionId).addObservation(obs);

        if (action.type === "fill" && action.value) {
          // Smart-match: find input by value type
          const val = String(action.value);
          const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
          const isPassword = /[^a-zA-Z0-9\s]/.test(val) && val.length >= 4;

          const inputs = obs.elements.filter(
            (el: any) => el.tagName === "input" || el.tagName === "textarea",
          );

          let match = inputs.find((el: any) =>
            isEmail
              ? el.type === "email" ||
                el.name === "email" ||
                el.placeholder?.toLowerCase().includes("email")
              : isPassword
                ? el.type === "password" ||
                  el.name === "password" ||
                  el.placeholder?.toLowerCase().includes("password")
                : el.type === "text" ||
                  el.type === undefined ||
                  el.tagName === "textarea",
          );

          if (!match && inputs.length > 0) match = inputs[0];

          if (match) {
            action.target = {
              name: (match as any).name,
              placeholder: (match as any).placeholder,
              ariaLabel: (match as any).ariaLabel,
              bbox: (match as any).bbox,
            };
          }
        } else if (action.type === "click" || action.type === "submit") {
          // Find button matching text if value hints at it
          const hint = String(action.value || "submit").toLowerCase();
          const buttons = obs.elements.filter(
            (el: any) =>
              el.role === "button" ||
              el.tagName === "button" ||
              el.type === "submit",
          );
          const match =
            buttons.find((el: any) =>
              String(el.text || "")
                .toLowerCase()
                .includes(hint),
            ) || buttons[0];

          if (match) {
            action.target = {
              text: (match as any).text,
              role: "button",
              bbox: (match as any).bbox,
            };
          }
        }
      }

      const result = await actionExecutor.execute(sessionId, action, {
        confirmationToken: params.confirmationToken
          ? String(params.confirmationToken)
          : undefined,
        mode: params.mode as any,
        currentObservation: worldModels
          .forSession(sessionId)
          .getLatestObservation(),
      });
      const wm = worldModels.forSession(sessionId);
      wm.addAction(action, result.success);
      return result;
    },
  });

  registry.register({
    name: "web_extract_structured",
    description:
      "Extract structured content from the current page: title, headings, links, and main text. Useful for reading page content during a session.",
    category: "data",
    parametersSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional URL override" },
      },
    },
    permissions: ["browser", "network"],
    execute: async (params, context) => {
      const sessionId = context?.sessionId || "";
      if (!sessionId)
        throw new Error("No active session. Call web_session_start first.");
      return await actionExecutor.extractStructured(
        sessionId,
        params.url ? String(params.url) : undefined,
      );
    },
  });

  registry.register({
    name: "web_session_end",
    description:
      "End the browser session and close the browser. Always call this when you're done with web interaction.",
    category: "browser",
    parametersSchema: { type: "object", properties: {} },
    permissions: ["browser"],
    execute: async (_params, context) => {
      const sessionId = context?.sessionId || "";
      if (!sessionId) return { success: true };
      worldModels.delete(sessionId);
      return await sessionManager.endSession(sessionId);
    },
  });

  console.log("🌐 Loaded web-browsing skill (9 tools, all wired)");
}

// Keep the default export for backward-compatible schema-only loading
const tools: ToolDefinition[] = [
  {
    name: "web_search",
    description: "Search the web for information.",
    category: "browser",
    parametersSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results" },
      },
      required: ["query"],
    },
    permissions: ["browser", "network"],
  },
  {
    name: "browse",
    description: "Open a URL in a real browser.",
    category: "browser",
    parametersSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to browse" },
      },
      required: ["url"],
    },
    permissions: ["browser", "network"],
  },
  {
    name: "scrape",
    description: "Extract readable content from a URL.",
    category: "data",
    parametersSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to scrape" },
      },
      required: ["url"],
    },
    permissions: ["network"],
  },
];

export default tools;

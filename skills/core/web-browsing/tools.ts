/**
 * Web Browsing skill — tool definitions.
 *
 * These are the schema-only registrations. The actual wiring of execute()
 * handlers happens in gateway/src/tool-wiring.ts at startup.
 */

import type { ToolDefinition } from "../../../runtime/src/tools.js";

const tools: ToolDefinition[] = [
  {
    name: "web_search",
    description:
      "Search the web for information. Returns a list of results with titles, URLs, and snippets. Use this when you need to find current information, facts, news, or answers to questions.",
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
  },
  {
    name: "browse",
    description:
      "Open a URL in a real browser, take a screenshot, and analyze the page visually. Use this for JavaScript-heavy sites, web apps, pages with dynamic content, or when you need to see what a page actually looks like. Returns title, text content, and a visual analysis of the page.",
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
  },
  {
    name: "scrape",
    description:
      "Extract readable content from a URL. Best for articles, blog posts, documentation, and text-heavy pages. Faster than browse — use this when you just need the text content, not the visual layout.",
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
    name: "web_session_end",
    description: "End a web-agent session (internal)",
    category: "browser",
    parametersSchema: { type: "object", properties: {} },
    permissions: ["browser"],
  },
];

export default tools;

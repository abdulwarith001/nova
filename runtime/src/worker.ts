// Worker thread for executing tools in isolation
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { executeBrowserTool } from "./browser-tools.js";
import { config } from "dotenv";
import { homedir } from "os";
import { join } from "path";

// Load environment variables from ~/.nova/.env
config({ path: join(homedir(), ".nova", ".env") });

interface ToolExecution {
  toolName: string;
  parameters: Record<string, unknown>;
}

/**
 * Main worker handler - this is called by Piscina
 */
export default async function (execution: ToolExecution): Promise<unknown> {
  const { toolName, parameters } = execution;

  // Browser tools
  if (toolName.startsWith("browser_")) {
    return await executeBrowserTool(execution);
  }

  // File system and other tools
  switch (toolName) {
    case "bash":
      return executeBash(parameters);
    case "read":
      return executeRead(parameters);
    case "write":
      return executeWrite(parameters);
    case "search_web":
      return await executeSearchWeb(parameters);
    case "fetch_url":
      return await executeFetchUrl(parameters);
    case "extract_main_content":
      return await executeExtractMainContent(parameters);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Execute bash command
 */
function executeBash(params: Record<string, unknown>): {
  stdout: string;
  stderr: string;
} {
  const command = params.command as string;
  if (!command) {
    throw new Error("Missing command parameter");
  }

  try {
    const stdout = execSync(command, {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 1024 * 1024, // 1MB
    });

    return { stdout, stderr: "" };
  } catch (error: any) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
    };
  }
}

/**
 * Read file contents
 */
function executeRead(params: Record<string, unknown>): { content: string } {
  const path = params.path as string;
  if (!path) {
    throw new Error("Missing path parameter");
  }

  try {
    const content = readFileSync(path, "utf-8");
    return { content };
  } catch (error) {
    throw new Error(
      `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Write file contents
 */
function executeWrite(params: Record<string, unknown>): { success: boolean } {
  const path = params.path as string;
  const content = params.content as string;

  if (!path) {
    throw new Error("Missing path parameter");
  }
  if (content === undefined) {
    throw new Error("Missing content parameter");
  }

  try {
    writeFileSync(path, content, "utf-8");
    return { success: true };
  } catch (error) {
    throw new Error(
      `Failed to write file: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Search the web using Serper API (Google Search)
 */
async function executeSearchWeb(params: Record<string, unknown>): Promise<{
  results: Array<{ title: string; url: string; description: string }>;
}> {
  const query = params.query as string;
  if (!query) {
    throw new Error("Missing query parameter");
  }

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Serper API key not configured. Set SERPER_API_KEY in .env file.",
    );
  }

  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: 5,
      }),
    });

    if (!response.ok) {
      throw new Error(`Serper API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      organic?: Array<{ title: string; link: string; snippet: string }>;
    };
    const results = (data.organic || []).slice(0, 5).map((r) => ({
      title: r.title,
      url: r.link,
      description: r.snippet,
    }));

    return { results };
  } catch (error) {
    throw new Error(
      `Web search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function executeFetchUrl(params: Record<string, unknown>): Promise<{
  status: number;
  finalUrl: string;
  title: string;
  html: string;
  text: string;
  publishedAt?: string;
}> {
  const url = String(params.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Invalid url parameter. Expected http/https URL.");
  }

  const timeoutMs = Math.max(
    1000,
    Number.isFinite(Number(params.timeoutMs))
      ? Number(params.timeoutMs)
      : Number(process.env.NOVA_RESEARCH_TOOL_TIMEOUT_MS || 45000),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "NovaResearchAgent/2.0 (+https://nova.local; autonomous-research)",
      },
    });

    const html = await response.text();
    const finalUrl = response.url || url;
    const title = extractTitle(html);
    const text = stripHtmlToText(html);
    const publishedAt = extractPublishedAt(html);

    return {
      status: response.status,
      finalUrl,
      title,
      html: html.slice(0, 240000),
      text: text.slice(0, 80000),
      publishedAt,
    };
  } catch (error) {
    throw new Error(
      `URL fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function executeExtractMainContent(
  params: Record<string, unknown>,
): Promise<{
  title: string;
  url?: string;
  mainText: string;
  wordCount: number;
  contentQualityScore: number;
}> {
  const htmlParam = typeof params.html === "string" ? params.html : "";
  const urlParam = typeof params.url === "string" ? params.url : "";

  let html = htmlParam;
  let title = "";
  let url: string | undefined;

  if (!html) {
    if (!urlParam) {
      throw new Error("Provide either html or url parameter.");
    }
    const fetched = await executeFetchUrl(params);
    html = fetched.html;
    title = fetched.title;
    url = fetched.finalUrl;
  } else {
    title = extractTitle(html);
    if (urlParam) url = urlParam;
  }

  const mainText = extractMainText(html);
  const wordCount = mainText.split(/\s+/).filter(Boolean).length;
  const score = computeContentQuality(mainText, wordCount);

  return {
    title,
    url,
    mainText: mainText.slice(0, 60000),
    wordCount,
    contentQualityScore: score,
  };
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim();
}

function extractPublishedAt(html: string): string | undefined {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']publishdate["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return undefined;
}

function extractMainText(html: string): string {
  const candidatePatterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<section[^>]+id=["']content["'][^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]+id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<body[^>]*>([\s\S]*?)<\/body>/i,
  ];

  for (const pattern of candidatePatterns) {
    const match = html.match(pattern);
    if (!match || !match[1]) continue;
    const text = stripHtmlToText(match[1]);
    if (text.length >= 200) return text;
  }

  return stripHtmlToText(html);
}

function computeContentQuality(text: string, wordCount: number): number {
  const sentenceCount = text.split(/[.!?]+/).filter((s) => s.trim().length > 0)
    .length;
  const avgSentenceLength = sentenceCount > 0 ? wordCount / sentenceCount : 0;
  const score =
    Math.min(wordCount, 2000) / 2000 +
    Math.min(sentenceCount, 80) / 80 +
    Math.min(avgSentenceLength, 24) / 24;
  return Number((Math.max(0, Math.min(1, score / 3))).toFixed(3));
}

function stripHtmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

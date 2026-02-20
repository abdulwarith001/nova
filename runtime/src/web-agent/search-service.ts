import { chromium } from "playwright";
import type { WebSearchResult } from "./contracts.js";
import {
  canonicalizeUrl,
  dedupeCanonicalUrls,
  isHttpUrl,
} from "./url-utils.js";

interface SearchOptions {
  limit?: number;
  timeoutMs?: number;
}

interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: string;
}

export class SearchService {
  async search(
    query: string,
    options?: SearchOptions,
  ): Promise<WebSearchResult[]> {
    const q = String(query || "").trim();
    if (!q) throw new Error("search query is required");

    const limit = Math.min(20, Math.max(1, Number(options?.limit || 8)));
    const timeoutMs = Math.max(1000, Number(options?.timeoutMs || 45_000));

    const providers: Array<Promise<RawSearchResult[]>> = [];

    // Brave Search API — primary (most reliable)
    const braveApiKey = String(process.env.BRAVE_SEARCH_API_KEY || "").trim();
    if (braveApiKey) {
      providers.push(this.searchBraveApi(q, braveApiKey, timeoutMs));
    }

    // Fallback HTML scrapers
    providers.push(
      this.searchDuckDuckGoHtml(q, timeoutMs),
      this.searchDuckDuckGoLite(q, timeoutMs),
      this.searchBingHtml(q, timeoutMs),
    );

    const managedApiUrl = String(
      process.env.NOVA_WEB_SEARCH_API_URL || "",
    ).trim();
    if (managedApiUrl) {
      providers.push(this.searchManagedApi(managedApiUrl, q, timeoutMs));
    }

    const settled = await Promise.allSettled(providers);
    let aggregated: RawSearchResult[] = [];

    for (const result of settled) {
      if (result.status === "fulfilled") {
        aggregated = aggregated.concat(result.value);
      }
    }

    if (aggregated.length === 0) {
      try {
        aggregated = await this.searchViaBrowserFallback(q, timeoutMs);
      } catch {
        aggregated = [];
      }
    }

    return this.rerankAndNormalize(q, aggregated).slice(0, limit);
  }

  private async searchBraveApi(
    query: string,
    apiKey: string,
    timeoutMs: number,
  ): Promise<RawSearchResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "accept-encoding": "gzip",
          "x-subscription-token": apiKey,
        },
      });
      if (!res.ok) return [];

      const data = (await res.json()) as {
        web?: {
          results?: Array<{
            title?: string;
            url?: string;
            description?: string;
          }>;
        };
      };

      return (data.web?.results || []).map((item) => ({
        title: String(item.title || ""),
        url: String(item.url || ""),
        snippet: String(item.description || ""),
        engine: "brave_api",
      }));
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  private async searchManagedApi(
    apiUrl: string,
    query: string,
    timeoutMs: number,
  ): Promise<RawSearchResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.NOVA_WEB_SEARCH_API_KEY
            ? { authorization: `Bearer ${process.env.NOVA_WEB_SEARCH_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({ query, limit: 10 }),
        signal: controller.signal,
      });
      if (!res.ok) return [];

      const data = (await res.json()) as {
        results?: Array<{ title?: string; url?: string; snippet?: string }>;
      };

      return (data.results || []).map((item) => ({
        title: String(item.title || ""),
        url: String(item.url || ""),
        snippet: String(item.snippet || ""),
        engine: "managed_api",
      }));
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  private async searchDuckDuckGoHtml(
    query: string,
    timeoutMs: number,
  ): Promise<RawSearchResult[]> {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await this.fetchText(url, timeoutMs);
    if (!html) return [];

    const blocks = html.split(/<div class=\"result\"/i).slice(1);
    const out: RawSearchResult[] = [];

    for (const block of blocks) {
      const href = this.capture(block, /href=\"([^\"]+)\"/i);
      const title = this.stripHtml(
        this.capture(block, /result__a[^>]*>([\s\S]*?)<\/a>/i),
      );
      const snippet = this.stripHtml(
        this.capture(block, /result__snippet[^>]*>([\s\S]*?)<\/a>/i) ||
          this.capture(block, /result__snippet[^>]*>([\s\S]*?)<\/div>/i),
      );
      out.push({
        title,
        url: this.normalizeSearchUrl(href),
        snippet,
        engine: "duckduckgo",
      });
    }

    return out;
  }

  private async searchDuckDuckGoLite(
    query: string,
    timeoutMs: number,
  ): Promise<RawSearchResult[]> {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const html = await this.fetchText(url, timeoutMs);
    if (!html) return [];

    const blocks = html.split(/<a rel=\"nofollow\"/i).slice(1);
    const out: RawSearchResult[] = [];

    for (const block of blocks) {
      const href = this.capture(block, /href=\"([^\"]+)\"/i);
      const title = this.stripHtml(this.capture(block, />([\s\S]*?)<\/a>/i));
      if (!href || !title) continue;
      out.push({
        title,
        url: this.normalizeSearchUrl(href),
        snippet: "",
        engine: "duckduckgo_lite",
      });
    }

    return out;
  }

  private async searchBingHtml(
    query: string,
    timeoutMs: number,
  ): Promise<RawSearchResult[]> {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-us`;
    const html = await this.fetchText(url, timeoutMs);
    if (!html) return [];

    const blocks = html.split(/<li class=\"b_algo\"/i).slice(1);
    const out: RawSearchResult[] = [];

    for (const block of blocks) {
      const href = this.capture(block, /<h2><a href=\"([^\"]+)\"/i);
      const title = this.stripHtml(
        this.capture(block, /<h2><a[^>]*>([\s\S]*?)<\/a>/i),
      );
      const snippet = this.stripHtml(
        this.capture(block, /<p>([\s\S]*?)<\/p>/i) ||
          this.capture(block, /b_caption[\s\S]*?<p>([\s\S]*?)<\/p>/i),
      );
      out.push({
        title,
        url: this.normalizeSearchUrl(href),
        snippet,
        engine: "bing",
      });
    }

    return out;
  }

  private async searchViaBrowserFallback(
    query: string,
    timeoutMs: number,
  ): Promise<RawSearchResult[]> {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(timeoutMs);
      await page.goto(
        `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        {
          waitUntil: "domcontentloaded",
        },
      );
      await page.waitForTimeout(250);

      return await page.$$eval(".result", (nodes) =>
        nodes
          .map((node) => {
            const anchor = node.querySelector("a.result__a, h2 a") as any;
            const href = anchor?.href || anchor?.getAttribute("href") || "";
            const title = String(anchor?.textContent || "")
              .replace(/\s+/g, " ")
              .trim();
            const snippetNode = node.querySelector(
              ".result__snippet, .snippet",
            );
            const snippet = String(snippetNode?.textContent || "")
              .replace(/\s+/g, " ")
              .trim();
            return {
              title,
              url: href,
              snippet,
              engine: "browser_fallback",
            };
          })
          .filter((item) => item.url),
      );
    } finally {
      await browser.close();
    }
  }

  private rerankAndNormalize(
    query: string,
    input: RawSearchResult[],
  ): WebSearchResult[] {
    const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);

    const normalized = input
      .map((item) => {
        const url = canonicalizeUrl(item.url);
        if (!isHttpUrl(url)) return null;

        const haystack = `${item.title} ${item.snippet}`.toLowerCase();
        const tokenMatches = queryTokens.reduce(
          (acc, token) => (haystack.includes(token) ? acc + 1 : acc),
          0,
        );
        const freshnessBoost = this.freshnessScore(url);
        const engineBoost =
          item.engine === "brave_api"
            ? 0.3
            : item.engine === "managed_api"
              ? 0.2
              : item.engine === "browser_fallback"
                ? 0.05
                : 0.1;

        const score = tokenMatches * 1.1 + freshnessBoost + engineBoost;

        return {
          title: item.title || url,
          url,
          snippet: item.snippet,
          engine: item.engine,
          retrievedAt: new Date().toISOString(),
          score,
        };
      })
      .filter((entry): entry is Omit<WebSearchResult, "rank"> =>
        Boolean(entry),
      );

    const dedupedUrls = dedupeCanonicalUrls(
      normalized.map((entry) => entry.url),
    );
    const deduped = dedupedUrls
      .map((url) => normalized.find((entry) => entry.url === url))
      .filter((entry): entry is Omit<WebSearchResult, "rank"> =>
        Boolean(entry),
      );

    deduped.sort((a, b) => b.score - a.score);

    return deduped.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
  }

  private freshnessScore(url: string): number {
    const nowYear = new Date().getUTCFullYear();
    const yearMatch = url.match(/\b(20\d{2})\b/);
    if (!yearMatch) return 0;

    const year = Number(yearMatch[1]);
    if (!Number.isFinite(year)) return 0;

    if (year >= nowYear) return 0.45;
    if (year === nowYear - 1) return 0.25;
    return 0.05;
  }

  private async fetchText(url: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        },
      });
      if (!response.ok) return "";
      return await response.text();
    } catch {
      return "";
    } finally {
      clearTimeout(timer);
    }
  }

  private capture(text: string, pattern: RegExp): string {
    const match = text.match(pattern);
    return match?.[1] ? this.decode(match[1]) : "";
  }

  private stripHtml(input: string): string {
    return this.decode(String(input || "").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  }

  private decode(input: string): string {
    return String(input || "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  }

  private normalizeSearchUrl(input: string): string {
    const raw = String(input || "").trim();
    if (!raw) return "";

    const maybeDecoded = this.decode(raw);
    try {
      const url = new URL(maybeDecoded);
      const uddg = url.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
      return maybeDecoded;
    } catch {
      const match = maybeDecoded.match(/[?&]uddg=([^&]+)/i);
      if (match?.[1]) {
        try {
          return decodeURIComponent(match[1]);
        } catch {
          return match[1];
        }
      }
      return maybeDecoded;
    }
  }
}

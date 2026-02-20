import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface ScrapeResult {
  url: string;
  title: string;
  author: string | null;
  content: string;
  excerpt: string | null;
  word_count: number;
}

/**
 * Scrape a URL and extract readable content.
 * Uses Mozilla Readability for article extraction.
 * Falls back to raw text stripping for non-article pages.
 */
export async function scrape(url: string): Promise<ScrapeResult> {
  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  let html: string;
  try {
    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    html = await response.text();
  } finally {
    clearTimeout(timer);
  }

  // Parse with JSDOM + Readability
  const dom = new JSDOM(html, { url: normalizedUrl });
  const doc = dom.window.document;
  const reader = new Readability(doc);
  const article = reader.parse();

  if (article && article.textContent) {
    const content = article.textContent
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 30_000);

    return {
      url: normalizedUrl,
      title: article.title || doc.title || "",
      author: article.byline || null,
      content,
      excerpt: article.excerpt || null,
      word_count: content.split(/\s+/).length,
    };
  }

  // Fallback: raw text extraction
  const bodyText = (doc.body?.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30_000);

  return {
    url: normalizedUrl,
    title: doc.title || "",
    author: null,
    content: bodyText,
    excerpt: null,
    word_count: bodyText.split(/\s+/).length,
  };
}

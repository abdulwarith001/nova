import { join } from "path";
import { mkdirSync } from "fs";
import { homedir } from "os";
import type { Page } from "playwright";
import type {
  ObservationMode,
  StructuredExtraction,
  WebObservation,
} from "./contracts.js";

interface ObserveOptions {
  mode: ObservationMode;
  includeScreenshot?: boolean;
  sessionId: string;
}

const DEFAULT_SCREENSHOT_DIR = join(homedir(), ".nova", "web-agent", "screenshots");

export class PerceptionEngine {
  async observe(page: Page, options: ObserveOptions): Promise<WebObservation> {
    const timestamp = new Date().toISOString();
    const observation = await page.evaluate(() => {
      const doc = (globalThis as any).document as any;
      const loc = (globalThis as any).location as any;

      const rawText = String(doc?.body?.innerText || "")
        .replace(/\s+/g, " ")
        .trim();
      const visibleText = rawText.slice(0, 12_000);

      const candidates = Array.from(
        doc.querySelectorAll(
          "button, a, input, textarea, select, [role='button'], [role='link']",
        ) as any,
      );

      const elements = candidates
        .map((el: any, index: number) => {
          const role =
            el.getAttribute?.("role") ||
            (String(el.tagName || "").toLowerCase() === "a"
              ? "link"
              : String(el.tagName || "").toLowerCase());
          const text = String(el.innerText || el.getAttribute?.("aria-label") || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 160);
          const id = String(el.id || `${role}-${index + 1}`);
          return {
            id,
            role,
            text,
            cssPath: (() => {
              const parts: string[] = [];
              let current: any = el;
              while (current && current.nodeType === 1) {
                const elementId = current.id ? `#${current.id}` : "";
                const tag = String(current.tagName || "div").toLowerCase();
                if (elementId) {
                  parts.unshift(`${tag}${elementId}`);
                  break;
                }
                const className = String(current.getAttribute?.("class") || "")
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(".");
                const withClass = className ? `${tag}.${className}` : tag;
                parts.unshift(withClass);
                current = current.parentElement;
              }
              return parts.join(" > ").slice(0, 240);
            })(),
          };
        })
        .filter((entry: any) => entry.text || entry.role)
        .slice(0, 160);

      const headings = Array.from(doc.querySelectorAll("h1, h2, h3") as any)
        .map((el: any) => String(el.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 10);

      const domSummary = `headings=${headings.length}, interactive_elements=${elements.length}, text_chars=${visibleText.length}`;

      return {
        url: String(loc?.href || ""),
        title: String(doc?.title || ""),
        domSummary,
        visibleText,
        elements,
      };
    });

    let screenshotPath: string | undefined;
    if (options.includeScreenshot) {
      mkdirSync(DEFAULT_SCREENSHOT_DIR, { recursive: true });
      const safeSession = String(options.sessionId).replace(/[^a-zA-Z0-9._-]/g, "-");
      screenshotPath = join(
        DEFAULT_SCREENSHOT_DIR,
        `${safeSession}-${Date.now()}.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }

    return {
      ...observation,
      screenshotPath,
      timestamp,
    };
  }

  async extractStructured(
    page: Page,
    options?: { urlOverride?: string },
  ): Promise<StructuredExtraction> {
    return await page.evaluate((urlOverride) => {
      const doc = (globalThis as any).document as any;
      const loc = (globalThis as any).location as any;

      const normalizedText = String(doc?.body?.innerText || "")
        .replace(/\s+/g, " ")
        .trim();

      const headings = Array.from(doc.querySelectorAll("h1, h2, h3") as any)
        .map((el: any) => String(el.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 20);

      const links = Array.from(doc.querySelectorAll("a[href]") as any)
        .map((el: any) => {
          const href = String(el.href || "");
          const text = String(el.textContent || "").replace(/\s+/g, " ").trim();
          return { text: text.slice(0, 120), url: href };
        })
        .filter((entry: any) => /^https?:\/\//i.test(entry.url))
        .slice(0, 100);

      const byline =
        doc.querySelector("[rel='author']")?.textContent ||
        doc.querySelector("[itemprop='author']")?.textContent ||
        undefined;

      const publishedAt =
        doc.querySelector("meta[property='article:published_time']")?.content ||
        doc.querySelector("time[datetime]")?.dateTime ||
        undefined;

      return {
        url: urlOverride || String(loc?.href || ""),
        title: String(doc?.title || ""),
        byline: byline ? String(byline).trim() : undefined,
        publishedAt,
        mainText: normalizedText.slice(0, 40_000),
        headings,
        links,
      };
    }, options?.urlOverride);
  }
}

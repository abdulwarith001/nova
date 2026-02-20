import { chromium } from "playwright";
import type { Agent } from "../../../agent/src/index.ts";

export interface BrowseResult {
  url: string;
  title: string;
  visible_text: string;
  vision_analysis: string;
  headings: string[];
  links: Array<{ text: string; url: string }>;
}

const VISION_PROMPT = [
  "Analyze this screenshot of a web page.",
  "Describe what you see concisely:",
  "- Page purpose and main content",
  "- Key information: pricing, features, data, or facts visible",
  "- Navigation structure and important links",
  "- Any forms, buttons, or interactive elements",
  "Be specific about numbers, prices, and data you can read.",
  "Do NOT describe the visual design — focus on information content.",
].join("\n");

/**
 * Browse a URL using a real browser.
 * Takes a screenshot and analyzes it via a vision sub-agent.
 * Returns text-only results — the main agent never sees raw images.
 */
export async function browse(url: string, agent: Agent): Promise<BrowseResult> {
  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.goto(normalizedUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    // Wait for JS-rendered content
    await page.waitForTimeout(2000);

    // Take screenshot as base64
    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const screenshotBase64 = screenshotBuffer.toString("base64");

    // Extract DOM content
    const domData = await page.evaluate(() => {
      const doc = (globalThis as any).document as any;
      const loc = (globalThis as any).location as any;

      const visibleText = String(doc?.body?.innerText || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 15_000);

      const headings = Array.from(doc.querySelectorAll("h1, h2, h3") as any)
        .map((el: any) =>
          String(el.textContent || "")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(Boolean)
        .slice(0, 15);

      const links = Array.from(doc.querySelectorAll("a[href]") as any)
        .map((el: any) => ({
          text: String(el.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80),
          url: String(el.href || ""),
        }))
        .filter(
          (entry: any) =>
            /^https?:\/\//i.test(entry.url) && entry.text.length > 0,
        )
        .slice(0, 30);

      return {
        url: String(loc?.href || ""),
        title: String(doc?.title || ""),
        visibleText,
        headings,
        links,
      };
    });

    // Vision sub-agent: analyze the screenshot
    let visionAnalysis = "";
    try {
      visionAnalysis = await agent.chatWithVision(
        screenshotBase64,
        VISION_PROMPT,
      );
    } catch (visionError) {
      console.warn("Vision sub-agent failed:", visionError);
      visionAnalysis =
        "Vision analysis unavailable. Use the visible text and headings below.";
    }

    return {
      url: domData.url || normalizedUrl,
      title: domData.title,
      visible_text: domData.visibleText,
      vision_analysis: visionAnalysis,
      headings: domData.headings,
      links: domData.links,
    };
  } finally {
    await browser.close();
  }
}

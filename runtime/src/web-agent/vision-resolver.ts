import type { Page } from "playwright";
import type { WebActionTarget, WebObservation } from "./contracts.js";

export interface VisionResolution {
  css?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  confidence: number;
  strategy: "text-match" | "role-text-match" | "bbox" | "none";
}

export class VisionResolver {
  async resolve(
    page: Page,
    target: WebActionTarget,
    observation: WebObservation,
  ): Promise<VisionResolution> {
    if (target.bbox) {
      return {
        bbox: target.bbox,
        confidence: 0.95,
        strategy: "bbox",
      };
    }

    const text = String(target.text || "").trim().toLowerCase();
    const role = String(target.role || "").trim().toLowerCase();

    if (!text) {
      return { confidence: 0, strategy: "none" };
    }

    const quick = observation.elements.find((entry) => {
      const itemText = String(entry.text || "").toLowerCase();
      const roleMatch = role ? String(entry.role || "").toLowerCase() === role : true;
      return roleMatch && itemText.includes(text);
    });

    if (quick?.cssPath) {
      return {
        css: quick.cssPath,
        confidence: 0.55,
        strategy: role ? "role-text-match" : "text-match",
      };
    }

    const resolved = (await page.evaluate((input) => {
      const doc = (globalThis as any).document as any;
      const normalized = String(input.text || "").toLowerCase();
      const roleHint = String(input.role || "").toLowerCase();
      if (!normalized) return null;

      const candidates = Array.from(
        doc.querySelectorAll(
          "button, a, input[type='button'], input[type='submit'], [role='button'], [role='link']",
        ) as any,
      );

      const ranked = candidates
        .map((el: any, index: number) => {
          const role =
            el.getAttribute?.("role") ||
            (String(el.tagName || "").toLowerCase() === "a"
              ? "link"
              : String(el.tagName || "").toLowerCase());
          const text = String(el.innerText || el.getAttribute?.("aria-label") || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
          if (!text) return null;
          const rolePenalty = roleHint && role !== roleHint ? 0.2 : 0;
          const score = text.includes(normalized) ? 1 - rolePenalty : 0;
          if (score <= 0) return null;

          const rect = el.getBoundingClientRect();
          const css = (() => {
            if (el.id) return `#${el.id}`;
            const tag = String(el.tagName || "div").toLowerCase();
            const className = String(el.className || "")
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .join(".");
            if (className) return `${tag}.${className}`;
            return `${tag}:nth-of-type(${index + 1})`;
          })();

          return {
            score,
            css,
            bbox: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          };
        })
        .filter(Boolean) as Array<{
        score: number;
        css: string;
        bbox: { x: number; y: number; w: number; h: number };
      }>;

      ranked.sort((a, b) => b.score - a.score);
      return ranked[0] || null;
    }, { text, role })) as
      | {
          score: number;
          css: string;
          bbox: { x: number; y: number; w: number; h: number };
        }
      | null;

    if (!resolved) {
      return { confidence: 0, strategy: "none" };
    }

    return {
      css: resolved.css,
      bbox: resolved.bbox,
      confidence: Math.max(0.5, Math.min(0.8, resolved.score)),
      strategy: role ? "role-text-match" : "text-match",
    };
  }
}

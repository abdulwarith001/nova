import type { Locator, Page } from "playwright";
import type {
  ObservationMode,
  WebAction,
  WebActionExecutionResult,
  WebObservation,
} from "./contracts.js";
import { PerceptionEngine } from "./perception.js";
import { PolicyEngine } from "./policy-engine.js";
import { SearchService } from "./search-service.js";
import { WebSessionManager } from "./session-manager.js";
import { WebTelemetry } from "./telemetry.js";
import { VisionResolver } from "./vision-resolver.js";
import { canonicalizeUrl, isHttpUrl } from "./url-utils.js";

export class ActionExecutor {
  constructor(
    private readonly sessionManager: WebSessionManager,
    private readonly perception = new PerceptionEngine(),
    private readonly vision = new VisionResolver(),
    private readonly searchService = new SearchService(),
    private readonly policyEngine = new PolicyEngine(),
    private readonly telemetry = new WebTelemetry(),
  ) {}

  async execute(
    sessionId: string,
    action: WebAction,
    options?: {
      confirmationToken?: string;
      mode?: ObservationMode;
      currentObservation?: WebObservation;
    },
  ): Promise<WebActionExecutionResult> {
    const policy = this.policyEngine.assertAllowed(
      action,
      sessionId,
      options?.confirmationToken,
    );

    let data: Record<string, unknown> = {};
    const page = this.sessionManager.getPage(sessionId);

    switch (action.type) {
      case "navigate": {
        const targetUrl = canonicalizeUrl(String(action.url || ""));
        if (!isHttpUrl(targetUrl)) {
          throw new Error("navigate action requires a valid http/https url");
        }
        const timeoutMs = Math.max(
          5_000,
          Math.min(120_000, Number(action.options?.timeoutMs || 30_000)),
        );
        const waitUntilInput = String(
          action.options?.waitUntil || "load",
        ).toLowerCase();
        const waitUntil: "domcontentloaded" | "load" | "networkidle" | "commit" =
          waitUntilInput === "load" ||
          waitUntilInput === "networkidle" ||
          waitUntilInput === "commit"
            ? (waitUntilInput as "load" | "networkidle" | "commit")
            : "domcontentloaded";
        const settleMs = Math.max(
          0,
          Math.min(
            5_000,
            Number(action.options?.settleMs || process.env.NOVA_WEB_NAV_SETTLE_MS || 1200),
          ),
        );
        await page.goto(targetUrl, { waitUntil, timeout: timeoutMs });
        await this.waitForNavigationSettled(page, timeoutMs, settleMs);
        data = {
          url: page.url(),
          title: await page.title(),
        };
        break;
      }
      case "click": {
        const clicked = await this.click(page, action, options?.currentObservation);
        data = { clicked };
        break;
      }
      case "fill": {
        const filled = await this.fill(page, action, options?.currentObservation);
        data = { filled, value: action.value || "" };
        break;
      }
      case "submit": {
        const submitted = await this.submit(page, action, options?.currentObservation);
        data = { submitted };
        break;
      }
      case "scroll": {
        const deltaY = Number(action.options?.deltaY || 1000);
        await page.mouse.wheel(0, deltaY);
        data = { deltaY };
        break;
      }
      case "wait": {
        const waitMs = Math.max(0, Number(action.options?.waitMs || 750));
        await page.waitForTimeout(waitMs);
        data = { waitMs };
        break;
      }
      case "extract": {
        const observation = await this.perception.observe(page, {
          mode: options?.mode || "dom+vision",
          includeScreenshot: action.options?.screenshot === true,
          sessionId,
        });
        const structured = await this.perception.extractStructured(page);
        data = {
          observation,
          structured,
        };
        break;
      }
      case "search": {
        const query = String(action.value || action.options?.query || "").trim();
        const results = await this.searchService.search(query, {
          limit: Number(action.options?.limit || 8),
          timeoutMs: Number(action.options?.timeoutMs || 45_000),
        });
        data = { query, results };
        break;
      }
      default:
        throw new Error(`Unsupported web action type: ${(action as { type?: string }).type}`);
    }

    this.telemetry.record(sessionId, "action", {
      action,
      risk: policy.risk,
      data,
    });

    return {
      success: true,
      action,
      risk: policy.risk,
      needsConfirmation: policy.needsConfirmation,
      data,
    };
  }

  async observe(
    sessionId: string,
    mode: ObservationMode,
    includeScreenshot: boolean,
  ): Promise<WebObservation> {
    const page = this.sessionManager.getPage(sessionId);
    const observation = await this.perception.observe(page, {
      mode,
      includeScreenshot,
      sessionId,
    });
    this.telemetry.record(sessionId, "observe", {
      url: observation.url,
      title: observation.title,
      screenshotPath: observation.screenshotPath,
    });
    return observation;
  }

  async extractStructured(
    sessionId: string,
    url?: string,
  ): Promise<Record<string, unknown>> {
    const page = this.sessionManager.getPage(sessionId);
    if (url && isHttpUrl(url)) {
      await page.goto(canonicalizeUrl(url), { waitUntil: "load" });
      await this.waitForNavigationSettled(page, 30_000, 800);
    }
    const extracted = await this.perception.extractStructured(page, {
      urlOverride: page.url(),
    });
    this.telemetry.record(sessionId, "extract_structured", {
      url: extracted.url,
      title: extracted.title,
      textChars: extracted.mainText.length,
    });
    return extracted as unknown as Record<string, unknown>;
  }

  async search(
    sessionId: string,
    query: string,
    options?: { limit?: number; timeoutMs?: number },
  ): Promise<Record<string, unknown>> {
    const results = await this.searchService.search(query, options);
    this.telemetry.record(sessionId, "search", {
      query,
      count: results.length,
      top: results[0]?.url,
    });
    return {
      query,
      results,
    };
  }

  private async click(
    page: Page,
    action: WebAction,
    observation?: WebObservation,
  ): Promise<string> {
    const locator = await this.resolveLocator(page, action);
    if (locator) {
      await locator.first().click({ timeout: 10_000 });
      return "dom";
    }

    if (!observation) {
      throw new Error("No matching DOM target found for click action");
    }

    const fallback = await this.vision.resolve(page, action.target || {}, observation);
    if (fallback.css) {
      await page.locator(fallback.css).first().click({ timeout: 10_000 });
      return "vision-css";
    }
    if (fallback.bbox) {
      await page.mouse.click(
        fallback.bbox.x + fallback.bbox.w / 2,
        fallback.bbox.y + fallback.bbox.h / 2,
      );
      return "vision-bbox";
    }

    throw new Error("Unable to resolve click target with DOM or vision fallback");
  }

  private async fill(
    page: Page,
    action: WebAction,
    observation?: WebObservation,
  ): Promise<string> {
    const value = String(action.value || "");
    const locator = await this.resolveLocator(page, action);
    if (locator) {
      await locator.first().fill(value, { timeout: 10_000 });
      return "dom";
    }

    if (!observation) {
      throw new Error("No matching DOM target found for fill action");
    }

    const fallback = await this.vision.resolve(page, action.target || {}, observation);
    if (fallback.css) {
      await page.locator(fallback.css).first().fill(value, { timeout: 10_000 });
      return "vision-css";
    }

    throw new Error("Unable to resolve fill target with DOM or vision fallback");
  }

  private async submit(
    page: Page,
    action: WebAction,
    observation?: WebObservation,
  ): Promise<string> {
    const locator = await this.resolveLocator(page, action);
    if (locator) {
      await locator.first().click({ timeout: 10_000 });
      return "dom";
    }

    if (observation) {
      const fallback = await this.vision.resolve(page, action.target || {}, observation);
      if (fallback.css) {
        await page.locator(fallback.css).first().click({ timeout: 10_000 });
        return "vision-css";
      }
    }

    await page.keyboard.press("Enter");
    return "keyboard-enter";
  }

  private async resolveLocator(page: Page, action: WebAction): Promise<Locator | null> {
    const target = action.target;
    if (!target) return null;

    if (target.css) {
      const locator = page.locator(target.css);
      if ((await locator.count()) > 0) return locator;
    }

    if (target.role && target.text) {
      const role = target.role as Parameters<Page["getByRole"]>[0];
      try {
        const locator = page.getByRole(role, { name: target.text });
        if ((await locator.count()) > 0) return locator;
      } catch {
        // ignore invalid role
      }
    }

    if (target.text) {
      const locator = page.getByText(target.text, { exact: false });
      if ((await locator.count()) > 0) return locator;
    }

    return null;
  }

  private async waitForNavigationSettled(
    page: Page,
    timeoutMs: number,
    settleMs: number,
  ): Promise<void> {
    const loadTimeoutMs = Math.max(1_500, Math.min(12_000, Math.floor(timeoutMs * 0.5)));

    try {
      await page.waitForLoadState("load", { timeout: loadTimeoutMs });
    } catch {
      // Keep moving with best-effort readiness checks for pages that never fully finish loading.
    }

    try {
      await page.waitForFunction("document.readyState !== 'loading'", {
        timeout: Math.min(4_000, loadTimeoutMs),
      });
    } catch {
      // Ignore; document may still be interactive enough for extraction.
    }

    if (settleMs > 0) {
      await page.waitForTimeout(settleMs);
    }

    try {
      await page.waitForLoadState("networkidle", {
        timeout: Math.min(3_500, Math.max(1_000, Math.floor(timeoutMs * 0.2))),
      });
    } catch {
      // Network idle is optional because many pages poll continuously.
    }
  }
}

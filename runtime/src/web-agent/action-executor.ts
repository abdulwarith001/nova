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
  private readonly searchService: SearchService;

  constructor(
    private readonly sessionManager: WebSessionManager,
    private readonly perception = new PerceptionEngine(),
    private readonly vision = new VisionResolver(),
    searchService?: SearchService,
    private readonly policyEngine = new PolicyEngine(),
    private readonly telemetry = new WebTelemetry(),
  ) {
    this.searchService =
      searchService || new SearchService(sessionManager.localProvider);
  }

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
        const waitUntil:
          | "domcontentloaded"
          | "load"
          | "networkidle"
          | "commit" =
          waitUntilInput === "load" ||
          waitUntilInput === "networkidle" ||
          waitUntilInput === "commit"
            ? (waitUntilInput as "load" | "networkidle" | "commit")
            : "domcontentloaded";
        const settleMs = Math.max(
          0,
          Math.min(
            5_000,
            Number(
              action.options?.settleMs ||
                process.env.NOVA_WEB_NAV_SETTLE_MS ||
                1200,
            ),
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
        const clicked = await this.click(
          page,
          action,
          options?.currentObservation,
        );
        data = { clicked };
        break;
      }
      case "fill": {
        const filled = await this.fill(
          page,
          action,
          options?.currentObservation,
        );
        data = { filled, value: action.value || "" };
        break;
      }
      case "submit": {
        const submitted = await this.submit(
          page,
          action,
          options?.currentObservation,
        );
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
        const query = String(
          action.value || action.options?.query || "",
        ).trim();
        const results = await this.searchService.search(query, {
          limit: Number(action.options?.limit || 8),
          timeoutMs: Number(action.options?.timeoutMs || 45_000),
        });
        data = { query, results };
        break;
      }
      default:
        throw new Error(
          `Unsupported web action type: ${(action as { type?: string }).type}`,
        );
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

    const fallback = await this.vision.resolve(
      page,
      action.target || {},
      observation,
    );
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

    // Coordinate fallback using target bbox
    const clickBbox = action.target?.bbox;
    if (clickBbox && clickBbox.w > 0 && clickBbox.h > 0) {
      await page.mouse.click(
        clickBbox.x + clickBbox.w / 2,
        clickBbox.y + clickBbox.h / 2,
      );
      return "coordinate-click";
    }

    throw new Error(
      "Unable to resolve click target with DOM, vision, or coordinate fallback",
    );
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

    const fallback = await this.vision.resolve(
      page,
      action.target || {},
      observation,
    );
    if (fallback.css) {
      await page.locator(fallback.css).first().fill(value, { timeout: 10_000 });
      return "vision-css";
    }

    // Coordinate fallback: click at center, clear, and type
    const bbox = action.target?.bbox;
    if (bbox && bbox.w > 0 && bbox.h > 0) {
      await page.mouse.click(bbox.x + bbox.w / 2, bbox.y + bbox.h / 2);
      // Triple-click to select all existing text, then type over it
      await page.mouse.click(bbox.x + bbox.w / 2, bbox.y + bbox.h / 2, {
        clickCount: 3,
      });
      await page.keyboard.type(value, { delay: 30 });
      return "coordinate-type";
    }

    throw new Error(
      "Unable to resolve fill target with DOM, vision, or coordinate fallback",
    );
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
      const fallback = await this.vision.resolve(
        page,
        action.target || {},
        observation,
      );
      if (fallback.css) {
        await page.locator(fallback.css).first().click({ timeout: 10_000 });
        return "vision-css";
      }
    }

    // Coordinate fallback for submit buttons
    const bbox = action.target?.bbox;
    if (bbox && bbox.w > 0 && bbox.h > 0) {
      await page.mouse.click(bbox.x + bbox.w / 2, bbox.y + bbox.h / 2);
      return "coordinate-click";
    }

    await page.keyboard.press("Enter");
    return "keyboard-enter";
  }

  private async resolveLocator(
    page: Page,
    action: WebAction,
  ): Promise<Locator | null> {
    const target = action.target;
    if (!target) return null;

    // 1. By element name attribute (most stable for forms)
    if (target.name) {
      try {
        const locator = page.locator(`[name="${target.name}"]`);
        if ((await locator.count()) > 0) return locator;
      } catch {
        // continue
      }
    }

    // 2. By element ID
    const targetId = target.id || (target as any).elementId;
    if (targetId && !targetId.includes("-")) {
      // Skip auto-generated IDs like "input-3"
      try {
        const locator = page.locator(`#${targetId}`);
        if ((await locator.count()) > 0) return locator;
      } catch {
        // continue
      }
    }

    // 3. By CSS selector (css, cssPath, selector)
    const cssSelector =
      target.css || (target as any).cssPath || (target as any).selector;
    if (cssSelector) {
      try {
        const locator = page.locator(String(cssSelector));
        if ((await locator.count()) > 0) return locator;
      } catch {
        // invalid selector — continue
      }
    }

    // 4. By role + text
    if (target.role && target.text) {
      const role = target.role as Parameters<Page["getByRole"]>[0];
      try {
        const locator = page.getByRole(role, { name: target.text });
        if ((await locator.count()) > 0) return locator;
      } catch {
        // ignore invalid role
      }
    }

    // 5. By aria-label
    if (target.ariaLabel) {
      try {
        const locator = page.getByLabel(target.ariaLabel, { exact: false });
        if ((await locator.count()) > 0) return locator;
      } catch {
        // ignore
      }
    }

    // 6. By placeholder
    if (target.placeholder) {
      try {
        const locator = page.getByPlaceholder(target.placeholder, {
          exact: false,
        });
        if ((await locator.count()) > 0) return locator;
      } catch {
        // ignore
      }
    }

    if (target.text) {
      // 7. Try getByLabel (for form inputs associated with a <label>)
      try {
        const byLabel = page.getByLabel(target.text, { exact: false });
        if ((await byLabel.count()) > 0) return byLabel;
      } catch {
        // ignore
      }

      // 8. Try getByPlaceholder
      try {
        const byPlaceholder = page.getByPlaceholder(target.text, {
          exact: false,
        });
        if ((await byPlaceholder.count()) > 0) return byPlaceholder;
      } catch {
        // ignore
      }

      // 9. Try getByText
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
    const loadTimeoutMs = Math.max(
      1_500,
      Math.min(12_000, Math.floor(timeoutMs * 0.5)),
    );

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

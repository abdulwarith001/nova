import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import type { WebAgentSessionConfig } from "../contracts.js";
import {
  BrowserProviderError,
  isRecoverableBrowserProviderError,
  type BrowserProvider,
  type SessionSnapshot,
} from "../browser-provider.js";
import { RemoteContextStore } from "../remote-context-store.js";
import { WebTelemetry } from "../telemetry.js";

interface BrowserbaseSessionResponse {
  id?: string;
  contextId?: string;
  connectUrl?: string;
  websocketUrl?: string;
  wsEndpoint?: string;
}

interface ManagedBrowserbaseSession {
  sessionId: string;
  profileId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  remoteSessionId: string;
  remoteContextId?: string;
  liveViewUrl?: string;
  createdAt: number;
  lastUsedAt: number;
}

export class BrowserbaseProvider implements BrowserProvider {
  readonly backend = "browserbase" as const;
  private static readonly START_RETRY_ATTEMPTS = 3;
  private readonly sessions = new Map<string, ManagedBrowserbaseSession>();
  private readonly attachedPages = new WeakSet<Page>();
  private readonly pageIds = new WeakMap<Page, string>();
  private pageCounter = 0;
  private readonly maxConcurrency: number;
  private readonly sessionTimeoutMs: number;
  private readonly enableLiveView: boolean;

  constructor(
    private readonly telemetry = new WebTelemetry(),
    private readonly remoteContextStore = new RemoteContextStore(),
    private readonly apiBaseUrl = String(
      process.env.BROWSERBASE_API_BASE_URL || "https://api.browserbase.com/v1",
    ).replace(/\/+$/, ""),
    private readonly connectBaseUrl = String(
      process.env.BROWSERBASE_CONNECT_BASE_URL || "wss://connect.browserbase.com",
    ).replace(/\/+$/, ""),
  ) {
    this.maxConcurrency = Math.max(
      1,
      Number(process.env.NOVA_WEB_BROWSERBASE_MAX_CONCURRENCY || 1),
    );
    this.sessionTimeoutMs = Math.max(
      60_000,
      Number(process.env.NOVA_WEB_BROWSERBASE_SESSION_TIMEOUT_MS || 600_000),
    );
    this.enableLiveView =
      String(process.env.NOVA_WEB_BROWSERBASE_ENABLE_LIVE_VIEW || "true")
        .trim()
        .toLowerCase() !== "false";
  }

  async startSession(
    sessionId: string,
    config: WebAgentSessionConfig,
  ): Promise<SessionSnapshot> {
    const existing = this.sessions.get(sessionId);
    if (existing && !existing.page.isClosed()) {
      this.touch(sessionId);
      return this.snapshot(existing);
    }

    if (this.sessions.size >= this.maxConcurrency) {
      throw new BrowserProviderError(
        `Browserbase concurrency limit reached (${this.maxConcurrency})`,
        { recoverable: true, backend: this.backend },
      );
    }

    const { apiKey, projectId } = this.credentials();
    const remoteContextId =
      this.remoteContextStore.getProfileContext(config.profileId) || undefined;
    const created = await this.withRetries(
      sessionId,
      () => this.createRemoteSession(apiKey, projectId, remoteContextId),
      "create remote session",
    );
    const remoteSessionId = String(created.id || "").trim();
    if (!remoteSessionId) {
      throw new BrowserProviderError("Browserbase session creation returned no session id", {
        recoverable: true,
        backend: this.backend,
      });
    }
    const contextId = String(created.contextId || remoteContextId || "").trim() || undefined;
    if (contextId) {
      this.remoteContextStore.setProfileContext(config.profileId, contextId);
    }
    this.remoteContextStore.setSessionContext(sessionId, {
      contextId: contextId || "unknown",
      remoteSessionId,
    });

    const connectUrl = this.resolveConnectUrl(apiKey, remoteSessionId, created);
    const browser = await this.withRetries(
      sessionId,
      () =>
        chromium.connectOverCDP(connectUrl, {
          timeout: this.sessionTimeoutMs,
        }),
      "connect CDP",
    );
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(60_000);
    this.attachContextEvents(sessionId, context);
    for (const existingPage of context.pages()) {
      this.attachPageEvents(sessionId, existingPage, true, remoteSessionId);
    }

    if (config.startUrl) {
      await page.goto(config.startUrl, { waitUntil: "load" });
    }
    if (config.viewport?.width && config.viewport?.height) {
      await page
        .setViewportSize({ width: config.viewport.width, height: config.viewport.height })
        .catch(() => {});
    }

    const liveViewUrl = this.enableLiveView
      ? await this.fetchLiveViewUrl(apiKey, remoteSessionId)
      : undefined;

    const managed: ManagedBrowserbaseSession = {
      sessionId,
      profileId: config.profileId,
      browser,
      context,
      page,
      remoteSessionId,
      remoteContextId: contextId,
      liveViewUrl,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    this.sessions.set(sessionId, managed);

    this.telemetry.record(sessionId, "session_start", {
      profileId: managed.profileId,
      backend: this.backend,
      url: page.url(),
      remoteSessionId: managed.remoteSessionId,
      remoteContextId: managed.remoteContextId,
      liveViewUrl: managed.liveViewUrl,
      headless: config.headless,
    });

    return this.snapshot(managed);
  }

  getPage(sessionId: string): Page {
    const session = this.sessions.get(sessionId);
    if (!session || session.page.isClosed()) {
      throw new BrowserProviderError(
        `No active web session for '${sessionId}'. Start one with web_session_start.`,
        {
          recoverable: true,
          backend: this.backend,
        },
      );
    }
    session.lastUsedAt = Date.now();
    return session.page;
  }

  getSession(sessionId: string): SessionSnapshot {
    const session = this.sessions.get(sessionId);
    if (!session || session.page.isClosed()) {
      throw new BrowserProviderError(`No active web session for '${sessionId}'.`, {
        recoverable: true,
        backend: this.backend,
      });
    }
    return this.snapshot(session);
  }

  async endSession(sessionId: string): Promise<{ success: boolean }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: true };

    try {
      await session.context.close().catch(() => {});
      await session.browser.close().catch(() => {});
    } finally {
      this.remoteContextStore.clearSessionContext(sessionId);
      this.sessions.delete(sessionId);
      this.telemetry.record(sessionId, "session_end", {
        profileId: session.profileId,
        backend: this.backend,
        remoteSessionId: session.remoteSessionId,
        remoteContextId: session.remoteContextId,
      });
    }

    return { success: true };
  }

  async closeAll(): Promise<void> {
    for (const sessionId of Array.from(this.sessions.keys())) {
      await this.endSession(sessionId);
    }
  }

  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastUsedAt = Date.now();
  }

  private snapshot(session: ManagedBrowserbaseSession): SessionSnapshot {
    return {
      sessionId: session.sessionId,
      profileId: session.profileId,
      backend: this.backend,
      url: session.page.url(),
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      liveViewUrl: session.liveViewUrl,
      remoteSessionId: session.remoteSessionId,
      remoteContextId: session.remoteContextId,
    };
  }

  private attachContextEvents(sessionId: string, context: BrowserContext): void {
    context.on("page", (page) => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      session.page = page;
      this.attachPageEvents(
        sessionId,
        page,
        true,
        session.remoteSessionId,
        session.liveViewUrl,
      );
    });
  }

  private attachPageEvents(
    sessionId: string,
    page: Page,
    emitTabOpen: boolean,
    remoteSessionId: string,
    liveViewUrl?: string,
  ): void {
    if (this.attachedPages.has(page)) return;
    this.attachedPages.add(page);

    const tabId = this.getPageId(sessionId, page);
    if (emitTabOpen) {
      this.telemetry.record(sessionId, "tab_open", {
        tabId,
        url: page.url(),
        backend: this.backend,
        remoteSessionId,
        liveViewUrl,
      });
    }

    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      this.telemetry.record(sessionId, "tab_navigate", {
        tabId,
        url: frame.url(),
        backend: this.backend,
        remoteSessionId,
        liveViewUrl,
      });
    });

    page.on("close", () => {
      this.telemetry.record(sessionId, "tab_close", {
        tabId,
        backend: this.backend,
        remoteSessionId,
      });
      const session = this.sessions.get(sessionId);
      if (!session || session.page !== page) return;
      const replacement = session.context.pages().find((candidate) => !candidate.isClosed());
      if (replacement) {
        session.page = replacement;
      }
    });
  }

  private getPageId(sessionId: string, page: Page): string {
    const existing = this.pageIds.get(page);
    if (existing) return existing;
    const id = `${sessionId}-tab-${++this.pageCounter}`;
    this.pageIds.set(page, id);
    return id;
  }

  private credentials(): { apiKey: string; projectId: string } {
    const apiKey = String(process.env.BROWSERBASE_API_KEY || "").trim();
    const projectId = String(process.env.BROWSERBASE_PROJECT_ID || "").trim();
    if (!apiKey || !projectId) {
      throw new BrowserProviderError(
        "Browserbase credentials missing. Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID.",
        {
          recoverable: true,
          backend: this.backend,
        },
      );
    }
    return { apiKey, projectId };
  }

  private resolveConnectUrl(
    apiKey: string,
    remoteSessionId: string,
    created: BrowserbaseSessionResponse,
  ): string {
    const explicit =
      String(created.connectUrl || created.websocketUrl || created.wsEndpoint || "").trim();
    if (explicit) return explicit;
    return `${this.connectBaseUrl}?apiKey=${encodeURIComponent(apiKey)}&sessionId=${encodeURIComponent(remoteSessionId)}`;
  }

  private async createRemoteSession(
    apiKey: string,
    projectId: string,
    contextId?: string,
  ): Promise<BrowserbaseSessionResponse> {
    const payload: Record<string, unknown> = {
      projectId,
      keepAlive: true,
    };
    if (contextId) payload.contextId = contextId;

    let response: Response;
    try {
      response = await fetch(`${this.apiBaseUrl}/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bb-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new BrowserProviderError(
        `Browserbase session create request failed: ${String((error as any)?.message || error)}`,
        {
          recoverable: true,
          backend: this.backend,
        },
      );
    }

    const body = await safeReadJson(response);
    if (!response.ok) {
      const message = extractErrorMessage(body) || response.statusText || "unknown error";
      throw new BrowserProviderError(`Browserbase session create failed: ${message}`, {
        recoverable: response.status >= 500 || response.status === 429 || response.status === 408,
        quotaLimited:
          response.status === 429 ||
          /quota|credits|billing|limit exceeded/i.test(message),
        statusCode: response.status,
        backend: this.backend,
      });
    }

    return body as BrowserbaseSessionResponse;
  }

  private async fetchLiveViewUrl(
    apiKey: string,
    remoteSessionId: string,
  ): Promise<string | undefined> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/sessions/${remoteSessionId}/debug`, {
        headers: {
          "x-bb-api-key": apiKey,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return `https://www.browserbase.com/sessions/${encodeURIComponent(remoteSessionId)}`;
      }
      const data = (await safeReadJson(response)) as Record<string, unknown> | null;
      if (!data) {
        return `https://www.browserbase.com/sessions/${encodeURIComponent(remoteSessionId)}`;
      }
      const possible = [
        data.fullscreenUrl,
        data.debuggerFullscreenUrl,
        data.debuggerUrl,
        data.liveViewUrl,
        data.url,
      ];
      for (const value of possible) {
        const asString = String(value || "").trim();
        if (/^https?:\/\//i.test(asString)) return asString;
      }
      return `https://www.browserbase.com/sessions/${encodeURIComponent(remoteSessionId)}`;
    } catch {
      return `https://www.browserbase.com/sessions/${encodeURIComponent(remoteSessionId)}`;
    }
  }

  private async withRetries<T>(
    sessionId: string,
    operation: () => Promise<T>,
    action: string,
  ): Promise<T> {
    let lastError: unknown;
    for (
      let attempt = 1;
      attempt <= BrowserbaseProvider.START_RETRY_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const recoverable = isRecoverableBrowserProviderError(error);
        if (!recoverable || attempt >= BrowserbaseProvider.START_RETRY_ATTEMPTS) {
          throw error;
        }
        await waitMs(this.retryDelayMs(attempt));
        this.telemetry.record(sessionId, "retry", {
          backend: this.backend,
          action,
          attempt,
          reason: String((error as any)?.message || error),
        });
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new BrowserProviderError(`Browserbase ${action} failed`, {
          recoverable: true,
          backend: this.backend,
        });
  }

  private retryDelayMs(attempt: number): number {
    return Math.min(2_000, 250 * 2 ** (attempt - 1));
  }
}

async function safeReadJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractErrorMessage(body: Record<string, unknown> | null): string | undefined {
  if (!body) return undefined;
  const fields = [
    body.error,
    body.message,
    body.description,
    (body as any).details?.message,
  ];
  for (const field of fields) {
    const value = String(field || "").trim();
    if (value) return value;
  }
  return undefined;
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

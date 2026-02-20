import type { BrowserContext, CDPSession, Page } from "playwright";
import { chromium } from "playwright";
import type { WebAgentSessionConfig } from "../contracts.js";
import type { BrowserProvider, SessionSnapshot } from "../browser-provider.js";
import { ProfileStore, type ProfileLease } from "../profile-store.js";
import { WebTelemetry } from "../telemetry.js";

interface ManagedSession {
  sessionId: string;
  profileId: string;
  lease: ProfileLease;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession | null;
  createdAt: number;
  lastUsedAt: number;
}

export class LocalPlaywrightProvider implements BrowserProvider {
  readonly backend = "local" as const;
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly attachedPages = new WeakSet<Page>();
  private readonly pageIds = new WeakMap<Page, string>();
  private pageCounter = 0;

  constructor(
    private readonly profileStore = new ProfileStore(),
    private readonly telemetry = new WebTelemetry(),
  ) {}

  async startSession(
    sessionId: string,
    config: WebAgentSessionConfig,
  ): Promise<SessionSnapshot> {
    const existing = this.sessions.get(sessionId);
    if (existing && !existing.page.isClosed()) {
      this.touch(sessionId);
      return this.snapshot(existing);
    }

    const lease = this.profileStore.acquire(config.profileId || sessionId);
    const context = await chromium.launchPersistentContext(lease.profilePath, {
      headless: config.headless,
      viewport: config.viewport,
      locale: config.locale,
      timezoneId: config.timezone,
      ignoreHTTPSErrors: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });

    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(60_000);
    this.attachContextEvents(sessionId, context);
    for (const existingPage of context.pages()) {
      this.attachPageEvents(sessionId, existingPage, true);
    }

    if (config.startUrl) {
      await page.goto(config.startUrl, { waitUntil: "load" });
    }

    let cdp: CDPSession | null = null;
    try {
      cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Page.enable");
    } catch {
      cdp = null;
    }

    const managed: ManagedSession = {
      sessionId,
      profileId: lease.profileId,
      lease,
      context,
      page,
      cdp,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    this.sessions.set(sessionId, managed);
    this.telemetry.record(sessionId, "session_start", {
      profileId: managed.profileId,
      url: page.url(),
      headless: config.headless,
      backend: this.backend,
    });

    return this.snapshot(managed);
  }

  getPage(sessionId: string): Page {
    const session = this.sessions.get(sessionId);
    if (!session || session.page.isClosed()) {
      throw new Error(`No active web session for '${sessionId}'. Start one with web_session_start.`);
    }
    session.lastUsedAt = Date.now();
    this.profileStore.renew(session.lease);
    return session.page;
  }

  getSession(sessionId: string): SessionSnapshot {
    const session = this.sessions.get(sessionId);
    if (!session || session.page.isClosed()) {
      throw new Error(`No active web session for '${sessionId}'.`);
    }
    return this.snapshot(session);
  }

  async endSession(sessionId: string): Promise<{ success: boolean }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: true };

    try {
      await session.context.close();
    } finally {
      this.profileStore.release(session.lease);
      this.sessions.delete(sessionId);
      this.telemetry.record(sessionId, "session_end", {
        profileId: session.profileId,
        backend: this.backend,
      });
    }

    return { success: true };
  }

  async cleanupIdleSessions(idleMs = 10 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let closed = 0;

    for (const [sessionId, session] of Array.from(this.sessions.entries())) {
      if (now - session.lastUsedAt < idleMs) continue;
      await this.endSession(sessionId);
      closed += 1;
    }

    return closed;
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
    this.profileStore.renew(session.lease);
  }

  private snapshot(session: ManagedSession): SessionSnapshot {
    return {
      sessionId: session.sessionId,
      profileId: session.profileId,
      backend: this.backend,
      url: session.page.url(),
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
    };
  }

  private attachContextEvents(sessionId: string, context: BrowserContext): void {
    context.on("page", (page) => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      session.page = page;
      this.attachPageEvents(sessionId, page, true);
    });
  }

  private attachPageEvents(sessionId: string, page: Page, emitTabOpen: boolean): void {
    if (this.attachedPages.has(page)) return;
    this.attachedPages.add(page);

    const tabId = this.getPageId(sessionId, page);
    if (emitTabOpen) {
      this.telemetry.record(sessionId, "tab_open", {
        tabId,
        url: page.url(),
        backend: this.backend,
      });
    }

    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      this.telemetry.record(sessionId, "tab_navigate", {
        tabId,
        url: frame.url(),
        backend: this.backend,
      });
    });

    page.on("close", () => {
      this.telemetry.record(sessionId, "tab_close", {
        tabId,
        backend: this.backend,
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
}


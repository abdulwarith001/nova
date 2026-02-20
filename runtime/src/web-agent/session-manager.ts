import type { Page } from "playwright";
import type { WebAgentSessionConfig } from "./contracts.js";
import {
  BrowserProviderError,
  isRecoverableBrowserProviderError,
  type BrowserProvider,
  type SessionSnapshot,
  type WebBackendPreference,
  type WebSessionBackend,
} from "./browser-provider.js";
import { LocalPlaywrightProvider } from "./providers/local-playwright-provider.js";
import { BrowserbaseProvider } from "./providers/browserbase-provider.js";
import { SteelProvider } from "./providers/steel-provider.js";
import { WebTelemetry } from "./telemetry.js";

interface ActiveRoute {
  backend: WebSessionBackend;
  config: WebAgentSessionConfig;
}

export class WebSessionManager {
  private readonly providers: Record<WebSessionBackend, BrowserProvider>;
  private readonly routes = new Map<string, ActiveRoute>();

  constructor(
    providers?: Partial<Record<WebSessionBackend, BrowserProvider>>,
    private readonly telemetry = new WebTelemetry(),
  ) {
    this.providers = {
      local: providers?.local || new LocalPlaywrightProvider(undefined, this.telemetry),
      browserbase: providers?.browserbase || new BrowserbaseProvider(this.telemetry),
      steel: providers?.steel || new SteelProvider(this.telemetry),
    };
  }

  async startSession(
    sessionId: string,
    config: WebAgentSessionConfig,
  ): Promise<SessionSnapshot> {
    const existing = this.routes.get(sessionId);
    if (existing) {
      try {
        const snapshot = this.providers[existing.backend].getSession(sessionId);
        this.touch(sessionId);
        return snapshot;
      } catch {
        await this.providers[existing.backend].endSession(sessionId).catch(() => {});
        this.routes.delete(sessionId);
      }
    }

    const preference = resolveBackendPreference(
      config.backendPreference || process.env.NOVA_WEB_BACKEND,
    );
    const fallbackEnabled =
      parseOptionalBool(config.fallbackOnError) ??
      parseOptionalBool(process.env.NOVA_WEB_BACKEND_FALLBACK_ON_ERROR) ??
      true;

    const tryLocal = async (): Promise<SessionSnapshot> => {
      const snapshot = await this.providers.local.startSession(sessionId, config);
      this.routes.set(sessionId, { backend: "local", config });
      return snapshot;
    };

    if (preference === "local") {
      return await tryLocal();
    }

    const shouldTrySteel =
      preference === "steel" || (preference === "auto" && hasSteelCredentials());
    if (shouldTrySteel) {
      try {
        const snapshot = await this.providers.steel.startSession(sessionId, config);
        this.routes.set(sessionId, { backend: "steel", config });
        return snapshot;
      } catch (error) {
        const recoverable = isRecoverableBrowserProviderError(error);
        const quotaLimited =
          error instanceof BrowserProviderError ? error.quotaLimited : false;

        this.telemetry.record(sessionId, "backend_switch", {
          from: "steel",
          to: fallbackEnabled && recoverable ? "local" : "none",
          reason: String((error as any)?.message || error),
          recoverable,
          quotaLimited,
        });

        if (!fallbackEnabled || !recoverable || preference === "steel") {
          throw error;
        }

        return await tryLocal();
      }
    }

    const shouldTryBrowserbase =
      preference === "browserbase" || (preference === "auto" && hasBrowserbaseCredentials());
    if (shouldTryBrowserbase) {
      try {
        const snapshot = await this.providers.browserbase.startSession(sessionId, config);
        this.routes.set(sessionId, { backend: "browserbase", config });
        return snapshot;
      } catch (error) {
        const recoverable = isRecoverableBrowserProviderError(error);
        const quotaLimited =
          error instanceof BrowserProviderError ? error.quotaLimited : false;

        this.telemetry.record(sessionId, "backend_switch", {
          from: "browserbase",
          to: fallbackEnabled && recoverable ? "local" : "none",
          reason: String((error as any)?.message || error),
          recoverable,
          quotaLimited,
        });

        if (!fallbackEnabled || !recoverable || preference === "browserbase") {
          throw error;
        }

        return await tryLocal();
      }
    }

    return await tryLocal();
  }

  getPage(sessionId: string): Page {
    const route = this.routes.get(sessionId);
    if (!route) {
      throw new Error(`No active web session for '${sessionId}'. Start one with web_session_start.`);
    }
    return this.providers[route.backend].getPage(sessionId);
  }

  getSession(sessionId: string): SessionSnapshot {
    const route = this.routes.get(sessionId);
    if (!route) {
      throw new Error(`No active web session for '${sessionId}'.`);
    }
    return this.providers[route.backend].getSession(sessionId);
  }

  async endSession(sessionId: string): Promise<{ success: boolean }> {
    const route = this.routes.get(sessionId);
    if (!route) return { success: true };
    try {
      return await this.providers[route.backend].endSession(sessionId);
    } finally {
      this.routes.delete(sessionId);
    }
  }

  async cleanupIdleSessions(idleMs = 10 * 60 * 1000): Promise<number> {
    let closed = 0;
    for (const backend of ["local", "steel", "browserbase"] as const) {
      const provider = this.providers[backend];
      if (provider.cleanupIdleSessions) {
        closed += await provider.cleanupIdleSessions(idleMs);
      }
    }
    return closed;
  }

  async closeAll(): Promise<void> {
    for (const sessionId of Array.from(this.routes.keys())) {
      await this.endSession(sessionId);
    }
    for (const backend of ["local", "steel", "browserbase"] as const) {
      await this.providers[backend].closeAll().catch(() => {});
    }
  }

  touch(sessionId: string): void {
    const route = this.routes.get(sessionId);
    if (!route) return;
    this.providers[route.backend].touch(sessionId);
  }
}

function hasBrowserbaseCredentials(): boolean {
  const apiKey = String(process.env.BROWSERBASE_API_KEY || "").trim();
  const projectId = String(process.env.BROWSERBASE_PROJECT_ID || "").trim();
  return Boolean(apiKey && projectId);
}

function hasSteelCredentials(): boolean {
  const apiKey = String(process.env.STEEL_API_KEY || "").trim();
  return Boolean(apiKey);
}

function parseOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function resolveBackendPreference(value: unknown): WebBackendPreference {
  const normalized = String(value || "auto").trim().toLowerCase();
  if (normalized === "local") return "local";
  if (normalized === "browserbase") return "browserbase";
  if (normalized === "steel") return "steel";
  return "auto";
}

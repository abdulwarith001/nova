import type { Page } from "playwright";
import type { WebAgentSessionConfig } from "./contracts.js";

export type WebSessionBackend = "local" | "browserbase" | "steel";
export type WebBackendPreference = "auto" | "local" | "browserbase" | "steel";

export interface SessionSnapshot {
  sessionId: string;
  profileId: string;
  backend: WebSessionBackend;
  url: string;
  title?: string;
  createdAt: number;
  lastUsedAt: number;
  liveViewUrl?: string;
  remoteSessionId?: string;
  remoteContextId?: string;
}

export interface BrowserProvider {
  readonly backend: WebSessionBackend;
  startSession(sessionId: string, config: WebAgentSessionConfig): Promise<SessionSnapshot>;
  getPage(sessionId: string): Page;
  getSession(sessionId: string): SessionSnapshot;
  endSession(sessionId: string): Promise<{ success: boolean }>;
  touch(sessionId: string): void;
  closeAll(): Promise<void>;
  cleanupIdleSessions?(idleMs?: number): Promise<number>;
}

export class BrowserProviderError extends Error {
  readonly recoverable: boolean;
  readonly quotaLimited: boolean;
  readonly statusCode?: number;
  readonly backend?: WebSessionBackend;

  constructor(
    message: string,
    options?: {
      recoverable?: boolean;
      quotaLimited?: boolean;
      statusCode?: number;
      backend?: WebSessionBackend;
    },
  ) {
    super(message);
    this.name = "BrowserProviderError";
    this.recoverable = options?.recoverable ?? true;
    this.quotaLimited = options?.quotaLimited ?? false;
    this.statusCode = options?.statusCode;
    this.backend = options?.backend;
  }
}

export function isRecoverableBrowserProviderError(error: unknown): boolean {
  if (error instanceof BrowserProviderError) return error.recoverable;
  const message = String((error as any)?.message || "").toLowerCase();
  if (message.includes("timeout")) return true;
  if (message.includes("temporarily unavailable")) return true;
  if (message.includes("connection")) return true;
  if (message.includes("network")) return true;
  if (message.includes("rate limit")) return true;
  if (message.includes("429")) return true;
  return false;
}

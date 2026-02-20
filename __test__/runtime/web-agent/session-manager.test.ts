import { describe, expect, it, vi } from "vitest";
import {
  BrowserProviderError,
  type BrowserProvider,
  type SessionSnapshot,
} from "../../../runtime/src/../../runtime/src/../../runtime/src/web-agent/browser-provider.js";
import { WebSessionManager } from "../../../runtime/src/../../runtime/src/../../runtime/src/web-agent/session-manager.js";

function createSnapshot(backend: "local" | "browserbase"): SessionSnapshot {
  return {
    sessionId: "s-1",
    profileId: "p-1",
    backend,
    url: "https://example.com",
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
}

describe("WebSessionManager", () => {
  it("falls back to local provider when browserbase fails in auto mode", async () => {
    const previousApiKey = process.env.BROWSERBASE_API_KEY;
    const previousProjectId = process.env.BROWSERBASE_PROJECT_ID;
    const previousSteelApiKey = process.env.STEEL_API_KEY;
    process.env.BROWSERBASE_API_KEY = "test-api-key";
    process.env.BROWSERBASE_PROJECT_ID = "test-project";
    delete process.env.STEEL_API_KEY;

    const browserbase: BrowserProvider = {
      backend: "browserbase",
      startSession: vi.fn().mockRejectedValue(
        new BrowserProviderError("transient remote error", {
          recoverable: true,
          backend: "browserbase",
        }),
      ),
      getPage: vi.fn() as any,
      getSession: vi.fn() as any,
      endSession: vi.fn().mockResolvedValue({ success: true }),
      touch: vi.fn(),
      closeAll: vi.fn().mockResolvedValue(undefined),
    };
    const local: BrowserProvider = {
      backend: "local",
      startSession: vi.fn().mockResolvedValue(createSnapshot("local")),
      getPage: vi.fn() as any,
      getSession: vi.fn() as any,
      endSession: vi.fn().mockResolvedValue({ success: true }),
      touch: vi.fn(),
      closeAll: vi.fn().mockResolvedValue(undefined),
    };
    const steel: BrowserProvider = {
      backend: "steel",
      startSession: vi.fn() as any,
      getPage: vi.fn() as any,
      getSession: vi.fn() as any,
      endSession: vi.fn().mockResolvedValue({ success: true }),
      touch: vi.fn(),
      closeAll: vi.fn().mockResolvedValue(undefined),
    };

    const manager = new WebSessionManager({ browserbase, local, steel });
    try {
      const snapshot = await manager.startSession("s-1", {
        profileId: "p-1",
        headless: true,
        viewport: { width: 1200, height: 800 },
        locale: "en-US",
        timezone: "UTC",
        backendPreference: "auto",
        fallbackOnError: true,
      });

      expect(snapshot.backend).toBe("local");
      expect(browserbase.startSession).toHaveBeenCalledTimes(1);
      expect(local.startSession).toHaveBeenCalledTimes(1);
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.BROWSERBASE_API_KEY;
      } else {
        process.env.BROWSERBASE_API_KEY = previousApiKey;
      }
      if (previousProjectId === undefined) {
        delete process.env.BROWSERBASE_PROJECT_ID;
      } else {
        process.env.BROWSERBASE_PROJECT_ID = previousProjectId;
      }
      if (previousSteelApiKey === undefined) {
        delete process.env.STEEL_API_KEY;
      } else {
        process.env.STEEL_API_KEY = previousSteelApiKey;
      }
    }
  });

  it("does not fallback when browserbase is explicitly requested", async () => {
    const previousSteelApiKey = process.env.STEEL_API_KEY;
    delete process.env.STEEL_API_KEY;
    const browserbase: BrowserProvider = {
      backend: "browserbase",
      startSession: vi.fn().mockRejectedValue(
        new BrowserProviderError("quota exceeded", {
          recoverable: true,
          quotaLimited: true,
          backend: "browserbase",
        }),
      ),
      getPage: vi.fn() as any,
      getSession: vi.fn() as any,
      endSession: vi.fn().mockResolvedValue({ success: true }),
      touch: vi.fn(),
      closeAll: vi.fn().mockResolvedValue(undefined),
    };
    const local: BrowserProvider = {
      backend: "local",
      startSession: vi.fn().mockResolvedValue(createSnapshot("local")),
      getPage: vi.fn() as any,
      getSession: vi.fn() as any,
      endSession: vi.fn().mockResolvedValue({ success: true }),
      touch: vi.fn(),
      closeAll: vi.fn().mockResolvedValue(undefined),
    };
    const steel: BrowserProvider = {
      backend: "steel",
      startSession: vi.fn() as any,
      getPage: vi.fn() as any,
      getSession: vi.fn() as any,
      endSession: vi.fn().mockResolvedValue({ success: true }),
      touch: vi.fn(),
      closeAll: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new WebSessionManager({ browserbase, local, steel });

    try {
      await expect(
        manager.startSession("s-1", {
          profileId: "p-1",
          headless: true,
          viewport: { width: 1200, height: 800 },
          locale: "en-US",
          timezone: "UTC",
          backendPreference: "browserbase",
          fallbackOnError: true,
        }),
      ).rejects.toThrow(/quota exceeded/i);
      expect(local.startSession).not.toHaveBeenCalled();
    } finally {
      if (previousSteelApiKey === undefined) {
        delete process.env.STEEL_API_KEY;
      } else {
        process.env.STEEL_API_KEY = previousSteelApiKey;
      }
    }
  });
});

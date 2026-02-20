import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { RemoteContextStore } from "../../../runtime/src/../../runtime/src/../../runtime/src/web-agent/remote-context-store.js";

describe("RemoteContextStore", () => {
  it("persists profile and session remote context mappings", () => {
    const rootDir = join(tmpdir(), `nova-remote-context-${Date.now()}`);
    try {
      const store = new RemoteContextStore(rootDir);
      store.setProfileContext("telegram:123", "ctx_abc");
      store.setSessionContext("telegram:123", {
        contextId: "ctx_abc",
        remoteSessionId: "sess_001",
      });

      const reloaded = new RemoteContextStore(rootDir);
      expect(reloaded.getProfileContext("telegram:123")).toBe("ctx_abc");
      const session = reloaded.getSessionContext("telegram:123");
      expect(session?.contextId).toBe("ctx_abc");
      expect(session?.remoteSessionId).toBe("sess_001");
    } finally {
      if (existsSync(rootDir)) rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("persists profile session context payload for remote auth reuse", () => {
    const rootDir = join(tmpdir(), `nova-remote-context-payload-${Date.now()}`);
    try {
      const store = new RemoteContextStore(rootDir);
      store.setProfileSessionContext("telegram:999", {
        cookies: [{ name: "sid", value: "abc" }],
      });

      const reloaded = new RemoteContextStore(rootDir);
      const context = reloaded.getProfileSessionContext("telegram:999");
      expect(Array.isArray(context?.cookies)).toBe(true);
    } finally {
      if (existsSync(rootDir)) rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

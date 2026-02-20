import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ProfileStore } from "../../../runtime/src/../../runtime/src/../../runtime/src/web-agent/profile-store.js";

describe("ProfileStore", () => {
  it("reclaims same-process lock", () => {
    const rootDir = join(tmpdir(), `nova-profile-test-${Date.now()}`);
    mkdirSync(rootDir, { recursive: true });

    try {
      const store = new ProfileStore({ rootDir, leaseMs: 60_000 });
      const profilePath = store.getProfilePath("telegram:123");
      mkdirSync(profilePath, { recursive: true });

      const lockPath = join(profilePath, ".profile.lock.json");
      writeFileSync(
        lockPath,
        JSON.stringify(
          {
            pid: process.pid,
            threadId: 99999,
            lockToken: "old-lock",
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
          },
          null,
          2,
        ),
        "utf-8",
      );

      const lease = store.acquire("telegram:123");
      expect(lease.profileId).toBe("telegram-123");
      expect(lease.lockToken).not.toBe("old-lock");
      store.release(lease);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ProfileAssignmentStore } from "../../../runtime/src/../../runtime/src/../../runtime/src/web-agent/profile-assignment-store.js";

describe("ProfileAssignmentStore", () => {
  it("persists session to profile mapping", () => {
    const rootDir = join(tmpdir(), `nova-profile-assignment-${Date.now()}`);
    mkdirSync(rootDir, { recursive: true });

    try {
      const store = new ProfileAssignmentStore(rootDir);
      store.set("telegram:123", "My-Profile");
      expect(store.get("telegram:123")).toBe("my-profile");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

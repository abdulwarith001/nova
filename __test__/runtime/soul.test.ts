import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadSoul, getSoulPath, resetSoul } from "../../runtime/src/soul";

describe("Soul", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "nova-test-soul-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates default soul.md when it doesn't exist", () => {
    const content = loadSoul(tmpDir);
    expect(content).toContain("Nova");
    expect(content).toContain("Personality");
    expect(content).toContain("Response Style");
    expect(existsSync(join(tmpDir, "soul.md"))).toBe(true);
  });

  it("returns existing soul.md content", () => {
    // Create the soul first
    loadSoul(tmpDir);

    // Modify it
    const customSoul = "# Custom Soul\nI am a custom agent.";
    const { writeFileSync } = require("fs");
    writeFileSync(join(tmpDir, "soul.md"), customSoul, "utf-8");

    // Load again — should get custom content
    const content = loadSoul(tmpDir);
    expect(content).toBe(customSoul);
  });

  it("getSoulPath returns correct path", () => {
    const path = getSoulPath(tmpDir);
    expect(path).toBe(join(tmpDir, "soul.md"));
  });

  it("resetSoul restores default content", () => {
    // Create custom soul
    loadSoul(tmpDir);
    const { writeFileSync } = require("fs");
    writeFileSync(join(tmpDir, "soul.md"), "custom", "utf-8");

    // Reset
    resetSoul(tmpDir);
    const content = readFileSync(join(tmpDir, "soul.md"), "utf-8");
    expect(content).toContain("Nova");
    expect(content).not.toBe("custom");
  });
});

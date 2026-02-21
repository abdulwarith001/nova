import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { HeartbeatEngine } from "../../runtime/src/heartbeat";

describe("HeartbeatEngine", () => {
  let tmpDir: string;
  let engine: HeartbeatEngine;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "nova-test-heartbeat-"));
    engine = new HeartbeatEngine(tmpDir, 999999); // Very long interval to prevent auto-tick
  });

  afterEach(() => {
    engine.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates default heartbeat.md if missing", () => {
    expect(existsSync(join(tmpDir, "heartbeat.md"))).toBe(true);
  });

  it("parses tasks from heartbeat.md", () => {
    const tasks = engine.parseTasks();
    expect(tasks.length).toBe(2);
    expect(tasks[0].name).toBe("Check-in");
    expect(tasks[0].interval).toBe("6h");
    expect(tasks[1].name).toBe("Daily Summary");
    expect(tasks[1].time).toBe("09:00");
  });

  it("parses interval strings correctly", () => {
    expect(engine.parseIntervalMs("30m")).toBe(30 * 60 * 1000);
    expect(engine.parseIntervalMs("6h")).toBe(6 * 60 * 60 * 1000);
    expect(engine.parseIntervalMs("24h")).toBe(24 * 60 * 60 * 1000);
    expect(engine.parseIntervalMs("1d")).toBe(24 * 60 * 60 * 1000);
    expect(engine.parseIntervalMs("10s")).toBe(10 * 1000);
  });

  it("fires tasks when interval has elapsed", async () => {
    writeFileSync(
      join(tmpDir, "heartbeat.md"),
      `# Heartbeat Tasks\n\n## Test Task\n- interval: 1s\n- message: Test tick\n`,
      "utf-8",
    );

    const fired: string[] = [];
    engine.onTick(async (tick) => {
      fired.push(tick.task.name);
    });

    // First tick should fire everything (no lastRun recorded)
    const ticks = await engine.tick();
    expect(ticks.length).toBe(1);
    expect(fired).toContain("Test Task");

    // Immediate second tick should NOT fire (too soon)
    fired.length = 0;
    const ticks2 = await engine.tick();
    expect(ticks2.length).toBe(0);
    expect(fired.length).toBe(0);
  });

  it("respects time-of-day constraint", () => {
    const task = {
      name: "9am Task",
      interval: "24h",
      time: "09:00",
      message: "Good morning",
    };

    // Mock "now" to be 09:01 — should fire
    const nineFiveAm = new Date();
    nineFiveAm.setHours(9, 1, 0, 0);
    expect(engine.shouldRun(task, nineFiveAm.getTime())).toBe(true);

    // Mock "now" to be 15:00 — should not fire
    const threePm = new Date();
    threePm.setHours(15, 0, 0, 0);
    expect(engine.shouldRun(task, threePm.getTime())).toBe(false);
  });

  it("parses custom heartbeat.md", () => {
    writeFileSync(
      join(tmpDir, "heartbeat.md"),
      `# Heartbeat Tasks\n\n## Weather Alert\n- interval: 12h\n- message: Check weather and alert if rain expected\n\n## Code Review\n- interval: 4h\n- message: Check for pending pull requests\n`,
      "utf-8",
    );

    const tasks = engine.parseTasks();
    expect(tasks.length).toBe(2);
    expect(tasks[0].name).toBe("Weather Alert");
    expect(tasks[1].name).toBe("Code Review");
    expect(tasks[1].interval).toBe("4h");
  });
});

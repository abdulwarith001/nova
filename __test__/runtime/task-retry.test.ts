import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { TaskStore } from "../../runtime/src/task-store";
import { TaskEngine } from "../../runtime/src/task-engine";

describe("Task Engine Resiliency", () => {
  let tmpDir: string;
  let store: TaskStore;
  let engine: TaskEngine;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "nova-test-resiliency-"));
    store = new TaskStore(tmpDir);
    engine = new TaskEngine(store, 999_999);
  });

  afterEach(() => {
    engine.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("retries a failing task and implements exponential backoff", async () => {
    const item = store.create({
      kind: "task",
      message: "Resilient task",
      nextRun: Date.now() - 1000,
      maxRetries: 3,
    });

    let attempts = 0;
    engine.onTick(async () => {
      attempts++;
      throw new Error("Transient failure");
    });

    // 1st attempt
    await engine.tick();
    const updated1 = store.getById(item.id);
    expect(updated1?.retries).toBe(1);
    expect(updated1?.status).toBe("active");
    expect(updated1?.nextRun).toBeGreaterThan(Date.now()); // Scheduled for retry
    expect(updated1?.lastError).toBe("Transient failure");

    // Mock time forward for 2nd attempt retry
    const nextRun = updated1!.nextRun;

    // 2nd attempt
    await engine.tick(nextRun + 1000);
    const updated2 = store.getById(item.id);
    expect(updated2?.retries).toBe(2);
    expect(updated2?.status).toBe("active");
    expect(updated2?.nextRun).toBeGreaterThan(nextRun); // Further backoff

    // 3rd attempt (Final failure)
    await engine.tick(updated2!.nextRun + 1000);
    const updated3 = store.getById(item.id);
    expect(updated3?.retries).toBe(3);
    expect(updated3?.status).toBe("failed"); // Max retries reached
  });

  it("completes one-shot tasks only after successful execution", async () => {
    const item = store.create({
      kind: "task",
      message: "One-shot success",
      nextRun: Date.now() - 1000,
    });

    let executed = false;
    engine.onTick(async () => {
      executed = true;
    });

    await engine.tick();
    expect(executed).toBe(true);
    expect(store.getById(item.id)).toBeUndefined(); // Removed on success
  });

  it("advances recurring tasks only after successful execution", async () => {
    const item = store.create({
      kind: "recurring",
      message: "Recurring success",
      nextRun: Date.now() - 1000,
      schedule: "1h",
    });

    engine.onTick(async () => {});

    await engine.tick();
    const updated = store.getById(item.id);
    expect(updated?.lastRun).toBeDefined();
    expect(updated?.nextRun).toBeGreaterThan(Date.now());
  });
});

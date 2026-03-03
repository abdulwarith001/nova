import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { TaskStore } from "../../runtime/src/task-store";
import { TaskEngine } from "../../runtime/src/task-engine";

describe("TaskStore", () => {
  let tmpDir: string;
  let store: TaskStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "nova-test-task-"));
    store = new TaskStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates tasks.json on first write", () => {
    store.create({
      kind: "reminder",
      message: "Test reminder",
      nextRun: Date.now() + 60_000,
    });

    expect(existsSync(join(tmpDir, "tasks.json"))).toBe(true);
  });

  it("creates and lists items", () => {
    store.create({
      kind: "reminder",
      message: "Call John",
      nextRun: Date.now() + 60_000,
    });
    store.create({
      kind: "recurring",
      message: "Daily summary",
      nextRun: Date.now() + 60_000,
      schedule: "24h",
    });

    const all = store.list();
    expect(all.length).toBe(2);
    expect(all[0].kind).toBe("reminder");
    expect(all[1].kind).toBe("recurring");
  });

  it("filters by status and kind", () => {
    store.create({
      kind: "reminder",
      message: "Active reminder",
      nextRun: Date.now() + 60_000,
    });
    const item = store.create({
      kind: "recurring",
      message: "Cancelled recurring",
      nextRun: Date.now() + 60_000,
      schedule: "6h",
    });
    store.cancel(item.id);

    expect(store.list({ status: "active" }).length).toBe(1);
    expect(store.list().length).toBe(1); // cancelled item is gone
    expect(store.list({ kind: "reminder" }).length).toBe(1);
  });

  it("cancels (removes) an item", () => {
    const item = store.create({
      kind: "reminder",
      message: "Cancel me",
      nextRun: Date.now() + 60_000,
    });

    expect(store.cancel(item.id)).toBe(true);
    expect(store.getById(item.id)).toBeUndefined(); // fully removed
    // Can't cancel again — doesn't exist
    expect(store.cancel(item.id)).toBe(false);
  });

  it("updates item fields", () => {
    const item = store.create({
      kind: "reminder",
      message: "Original",
      nextRun: Date.now() + 60_000,
    });

    const newTime = Date.now() + 120_000;
    const updated = store.update(item.id, {
      nextRun: newTime,
      message: "Updated",
    });

    expect(updated?.message).toBe("Updated");
    expect(updated?.nextRun).toBe(newTime);
  });

  it("gets due items", () => {
    const past = Date.now() - 60_000;
    const future = Date.now() + 60_000;

    store.create({ kind: "reminder", message: "Past", nextRun: past });
    store.create({ kind: "reminder", message: "Future", nextRun: future });

    const due = store.getDue();
    expect(due.length).toBe(1);
    expect(due[0].message).toBe("Past");
  });

  it("removes one-shot after trigger", () => {
    const past = Date.now() - 60_000;
    const item = store.create({
      kind: "reminder",
      message: "Done",
      nextRun: past,
    });

    store.markTriggered(item.id);
    expect(store.getById(item.id)).toBeUndefined(); // fully removed
  });

  it("refuses to delete recurring items via markTriggered", () => {
    const past = Date.now() - 60_000;
    const item = store.create({
      kind: "recurring",
      message: "Keep alive",
      nextRun: past,
      schedule: "6h",
    });

    store.markTriggered(item.id);
    // Recurring items should NOT be deleted
    expect(store.getById(item.id)).toBeDefined();
    expect(store.getById(item.id)?.kind).toBe("recurring");
  });

  it("advances recurring items", () => {
    const past = Date.now() - 60_000;
    const item = store.create({
      kind: "recurring",
      message: "Repeat",
      nextRun: past,
      schedule: "6h",
    });

    store.advanceRecurring(item.id);
    const updated = store.getById(item.id);
    expect(updated?.status).toBe("active"); // stays active
    expect(updated?.lastRun).toBeGreaterThan(0);
    expect(updated!.nextRun).toBeGreaterThan(past); // moved forward
  });

  it("returns correct stats", () => {
    store.create({
      kind: "reminder",
      message: "A",
      nextRun: Date.now() + 60_000,
    });
    const b = store.create({
      kind: "reminder",
      message: "B",
      nextRun: Date.now() - 60_000,
    });
    store.markTriggered(b.id);
    const c = store.create({
      kind: "recurring",
      message: "C",
      nextRun: Date.now() + 60_000,
      schedule: "1h",
    });
    store.cancel(c.id);

    const stats = store.getStats();
    expect(stats.active).toBe(1); // only A remains (B removed by trigger, C removed by cancel)
    expect(stats.total).toBe(1);
  });

  it("persists to disk and reloads", () => {
    store.create({
      kind: "reminder",
      message: "Persist me",
      nextRun: Date.now() + 60_000,
    });

    // Create fresh store from same dir
    const store2 = new TaskStore(tmpDir);
    const items = store2.list();
    expect(items.length).toBe(1);
    expect(items[0].message).toBe("Persist me");
  });
});

describe("TaskEngine", () => {
  let tmpDir: string;
  let store: TaskStore;
  let engine: TaskEngine;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "nova-test-engine-"));
    store = new TaskStore(tmpDir);
    engine = new TaskEngine(store, 999_999); // long interval to prevent auto-tick
  });

  afterEach(() => {
    engine.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fires handler for due items", async () => {
    store.create({
      kind: "reminder",
      message: "Fire me",
      nextRun: Date.now() - 1000,
    });

    const fired: string[] = [];
    engine.onTick(async (tick) => {
      fired.push(tick.item.message);
    });

    const ticks = await engine.tick();
    expect(ticks.length).toBe(1);
    expect(fired).toContain("Fire me");
  });

  it("marks one-shots as triggered after tick", async () => {
    const item = store.create({
      kind: "reminder",
      message: "One-shot",
      nextRun: Date.now() - 1000,
    });

    engine.onTick(async () => {});
    await engine.tick();

    expect(store.getById(item.id)).toBeUndefined(); // removed after trigger
  });

  it("advances recurring items after tick", async () => {
    const item = store.create({
      kind: "recurring",
      message: "Repeat",
      nextRun: Date.now() - 1000,
      schedule: "6h",
    });

    engine.onTick(async () => {});
    await engine.tick();

    const updated = store.getById(item.id);
    expect(updated?.status).toBe("active");
    expect(updated!.nextRun).toBeGreaterThan(Date.now() - 1000);
  });

  it("does not fire future items", async () => {
    store.create({
      kind: "reminder",
      message: "Not yet",
      nextRun: Date.now() + 60_000,
    });

    const ticks = await engine.tick();
    expect(ticks.length).toBe(0);
  });
});

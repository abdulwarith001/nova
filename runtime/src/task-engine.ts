/**
 * task-engine.ts — Tick-based engine for executing tasks.
 *
 * Polls TaskStore every minute, fires handlers for due items,
 * and advances recurring tasks.
 */

import { TaskStore, type TaskItem } from "./task-store.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface TaskTick {
  item: TaskItem;
  triggeredAt: number;
}

export type TaskHandler = (tick: TaskTick) => Promise<void>;

// ── Engine ──────────────────────────────────────────────────────────────────

export class TaskEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private handler: TaskHandler | null = null;
  private processing = false;

  constructor(
    private readonly store: TaskStore,
    private readonly tickIntervalMs = 60_000,
  ) {}

  /**
   * Register a handler called for each due item.
   */
  onTick(handler: TaskHandler): void {
    this.handler = handler;
  }

  /**
   * Start the tick loop.
   */
  start(): void {
    if (this.timer) return;

    const lastTick = this.store.getLastTickAt();
    const downtime = lastTick ? Date.now() - lastTick : 0;
    if (downtime > this.tickIntervalMs) {
      console.log(
        `⏰ Task engine started (catching up ${Math.round(downtime / 1000)}s of downtime)`,
      );
    } else {
      console.log("⏰ Task engine started");
    }

    this.timer = setInterval(async () => {
      await this.tick();
    }, this.tickIntervalMs);

    // Run immediately on start (catches missed tasks from downtime)
    this.tick().catch((err) => {
      console.error("⚠️ Task engine tick error:", err);
    });
  }

  /**
   * Run one tick — process all due items.
   * Uses a processing lock to prevent concurrent ticks from firing
   * the same items when handlers take longer than the tick interval.
   */
  async tick(now = Date.now()): Promise<TaskTick[]> {
    if (this.processing) return [];
    this.processing = true;

    try {
      const due = this.store.getDue(now);
      const fired: TaskTick[] = [];

      for (const item of due) {
        const tick: TaskTick = { item, triggeredAt: now };
        fired.push(tick);

        // Mark/advance item BEFORE running handler to prevent
        // the next tick from picking up the same item
        if (item.kind === "recurring" && item.schedule) {
          this.store.advanceRecurring(item.id);
        } else {
          // One-shot: reminder or task — remove immediately
          this.store.markTriggered(item.id);
        }

        // Execute handler
        if (this.handler) {
          try {
            await this.handler(tick);
          } catch (err) {
            console.error(`⚠️ Task handler error for "${item.message}":`, err);
          }
        }
      }

      return fired;
    } finally {
      this.store.setLastTickAt(now);
      this.processing = false;
    }
  }

  /**
   * Stop the tick loop.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("⏰ Task engine stopped");
    }
  }

  /**
   * Get the backing store.
   */
  getStore(): TaskStore {
    return this.store;
  }
}

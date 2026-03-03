/**
 * scheduler-engine.ts — Tick-based engine for executing scheduled items.
 *
 * Replaces HeartbeatEngine. Polls SchedulerStore every minute,
 * fires handlers for due items, and advances recurring schedules.
 */

import { SchedulerStore, type ScheduledItem } from "./scheduler-store.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SchedulerTick {
  item: ScheduledItem;
  triggeredAt: number;
}

export type SchedulerHandler = (tick: SchedulerTick) => Promise<void>;

// ── Engine ──────────────────────────────────────────────────────────────────

export class SchedulerEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private handler: SchedulerHandler | null = null;

  constructor(
    private readonly store: SchedulerStore,
    private readonly tickIntervalMs = 60_000,
  ) {}

  /**
   * Register a handler called for each due item.
   */
  onTick(handler: SchedulerHandler): void {
    this.handler = handler;
  }

  /**
   * Start the tick loop.
   */
  start(): void {
    if (this.timer) return;

    console.log("⏰ Scheduler engine started");

    this.timer = setInterval(async () => {
      await this.tick();
    }, this.tickIntervalMs);

    // Run immediately on start
    this.tick().catch((err) => {
      console.error("⚠️ Scheduler tick error:", err);
    });
  }

  /**
   * Run one tick — process all due items.
   */
  async tick(now = Date.now()): Promise<SchedulerTick[]> {
    const due = this.store.getDue(now);
    const fired: SchedulerTick[] = [];

    for (const item of due) {
      const tick: SchedulerTick = { item, triggeredAt: now };
      fired.push(tick);

      // Execute handler
      if (this.handler) {
        try {
          await this.handler(tick);
        } catch (err) {
          console.error(
            `⚠️ Scheduler handler error for "${item.message}":`,
            err,
          );
        }
      }

      // Update item status
      if (item.kind === "recurring" && item.schedule) {
        this.store.advanceRecurring(item.id);
      } else {
        // One-shot: reminder or task
        this.store.markTriggered(item.id);
      }
    }

    return fired;
  }

  /**
   * Stop the tick loop.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("⏰ Scheduler engine stopped");
    }
  }

  /**
   * Get the backing store.
   */
  getStore(): SchedulerStore {
    return this.store;
  }
}

/**
 * scheduler-store.ts — JSON-file-backed storage for scheduled items.
 *
 * Stores reminders, recurring tasks, and deferred agent actions
 * in ~/.nova/schedules.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

// ── Types ───────────────────────────────────────────────────────────────────

export type ScheduleKind = "reminder" | "recurring" | "task";
export type ScheduleStatus = "active" | "triggered" | "cancelled" | "paused";

export interface ScheduledItem {
  id: string;
  kind: ScheduleKind;
  message: string;
  /** Optional agent instruction — sent through chatService for 'task' and 'recurring' kinds */
  action?: string;
  /** Interval string for recurring items: '6h', '24h', '30m', '1d' */
  schedule?: string;
  /** Time of day for recurring items: '09:00' */
  timeOfDay?: string;
  /** Next trigger time — Unix timestamp in milliseconds */
  nextRun: number;
  /** Last trigger time */
  lastRun?: number;
  status: ScheduleStatus;
  /** Delivery target (e.g. Telegram chat ID) */
  chatId?: string;
  /** Extra context (JSON-serializable) */
  context?: Record<string, unknown>;
  createdAt: number;
}

export interface CreateScheduleInput {
  kind: ScheduleKind;
  message: string;
  /** Unix timestamp ms for when to first trigger */
  nextRun: number;
  action?: string;
  schedule?: string;
  timeOfDay?: string;
  chatId?: string;
  context?: Record<string, unknown>;
}

export interface ScheduleFilter {
  status?: ScheduleStatus;
  kind?: ScheduleKind;
}

export interface ScheduleStats {
  active: number;
  triggered: number;
  cancelled: number;
  paused: number;
  total: number;
}

// ── Store ───────────────────────────────────────────────────────────────────

export class SchedulerStore {
  private readonly filePath: string;
  private items: ScheduledItem[] = [];

  constructor(novaDir?: string) {
    const dir = novaDir || join(homedir(), ".nova");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.filePath = join(dir, "schedules.json");
    this.load();
  }

  // ── CRUD ────────────────────────────────────────────────────────────────

  create(input: CreateScheduleInput): ScheduledItem {
    const item: ScheduledItem = {
      id: randomUUID(),
      kind: input.kind,
      message: input.message,
      action: input.action,
      schedule: input.schedule,
      timeOfDay: input.timeOfDay,
      nextRun: input.nextRun,
      status: "active",
      chatId: input.chatId,
      context: input.context,
      createdAt: Date.now(),
    };

    this.items.push(item);
    this.save();
    return item;
  }

  list(filter?: ScheduleFilter): ScheduledItem[] {
    this.load();
    let result = [...this.items];
    if (filter?.status) {
      result = result.filter((item) => item.status === filter.status);
    }
    if (filter?.kind) {
      result = result.filter((item) => item.kind === filter.kind);
    }
    return result.sort((a, b) => a.nextRun - b.nextRun);
  }

  getById(id: string): ScheduledItem | undefined {
    this.load();
    return this.items.find((item) => item.id === id);
  }

  cancel(id: string): boolean {
    const index = this.items.findIndex((i) => i.id === id);
    if (index === -1) return false;
    this.items.splice(index, 1);
    this.save();
    return true;
  }

  update(
    id: string,
    changes: Partial<
      Pick<
        ScheduledItem,
        "nextRun" | "message" | "status" | "action" | "schedule" | "timeOfDay"
      >
    >,
  ): ScheduledItem | null {
    const item = this.items.find((i) => i.id === id);
    if (!item) return null;
    Object.assign(item, changes);
    this.save();
    return item;
  }

  // ── Scheduling ──────────────────────────────────────────────────────────

  /** Get all items that are due (active + nextRun <= now). */
  getDue(now = Date.now()): ScheduledItem[] {
    this.load();
    return this.items.filter(
      (item) => item.status === "active" && item.nextRun <= now,
    );
  }

  /** Mark a one-shot item as triggered and remove it (it's done). */
  markTriggered(id: string): void {
    const index = this.items.findIndex((i) => i.id === id);
    if (index === -1) return;
    this.items.splice(index, 1);
    this.save();
  }

  /** Advance a recurring item: update lastRun and compute next nextRun. */
  advanceRecurring(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (!item || !item.schedule) return;

    item.lastRun = Date.now();
    const intervalMs = this.parseIntervalMs(item.schedule);
    item.nextRun = item.lastRun + intervalMs;
    this.save();
  }

  // ── Stats ───────────────────────────────────────────────────────────────

  getStats(): ScheduleStats {
    this.load();
    const counts: ScheduleStats = {
      active: 0,
      triggered: 0,
      cancelled: 0,
      paused: 0,
      total: this.items.length,
    };
    for (const item of this.items) {
      if (item.status in counts) {
        counts[item.status as keyof Omit<ScheduleStats, "total">]++;
      }
    }
    return counts;
  }

  // ── Migration ───────────────────────────────────────────────────────────

  /** Import heartbeat.md tasks as recurring items. */
  migrateFromHeartbeat(
    tasks: Array<{
      name: string;
      interval: string;
      time?: string;
      message: string;
    }>,
  ): ScheduledItem[] {
    const migrated: ScheduledItem[] = [];
    for (const task of tasks) {
      // Skip if already migrated (same message exists)
      const exists = this.items.some(
        (item) => item.message === task.message && item.kind === "recurring",
      );
      if (exists) continue;

      const intervalMs = this.parseIntervalMs(task.interval);
      const item = this.create({
        kind: "recurring",
        message: task.message,
        schedule: task.interval,
        timeOfDay: task.time,
        nextRun: Date.now() + intervalMs,
      });
      migrated.push(item);
    }
    return migrated;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** Parse interval string like '6h', '30m', '24h', '1d' into ms. */
  parseIntervalMs(interval: string): number {
    const match = interval.match(/^(\d+)(s|m|h|d)$/i);
    if (!match) return 60 * 60 * 1000; // default 1 hour

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case "s":
        return value * 1000;
      case "m":
        return value * 60 * 1000;
      case "h":
        return value * 60 * 60 * 1000;
      case "d":
        return value * 24 * 60 * 60 * 1000;
      default:
        return 60 * 60 * 1000;
    }
  }

  /** Get the file path. */
  getFilePath(): string {
    return this.filePath;
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.items = [];
      return;
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      this.items = JSON.parse(raw);
    } catch {
      console.warn("⚠️ Failed to parse schedules.json, starting fresh");
      this.items = [];
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(this.items, null, 2), "utf-8");
  }
}

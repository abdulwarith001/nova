/**
 * task-store.ts — JSON-file-backed storage for tasks.
 *
 * Stores reminders, recurring tasks, and deferred agent actions
 * in ~/.nova/tasks.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

// ── Types ───────────────────────────────────────────────────────────────────

export type TaskKind = "reminder" | "recurring" | "task";
export type TaskStatus = "active" | "triggered" | "cancelled" | "paused";

export interface TaskItem {
  id: string;
  kind: TaskKind;
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
  status: TaskStatus;
  /** Delivery target (e.g. Telegram chat ID) */
  chatId?: string;
  /** Extra context (JSON-serializable) */
  context?: Record<string, unknown>;
  createdAt: number;
}

export interface CreateTaskInput {
  kind: TaskKind;
  message: string;
  /** Unix timestamp ms for when to first trigger */
  nextRun: number;
  action?: string;
  schedule?: string;
  timeOfDay?: string;
  chatId?: string;
  context?: Record<string, unknown>;
}

export interface TaskFilter {
  status?: TaskStatus;
  kind?: TaskKind;
}

export interface TaskStats {
  active: number;
  triggered: number;
  cancelled: number;
  paused: number;
  total: number;
}

// ── Store ───────────────────────────────────────────────────────────────────

interface TaskFileData {
  lastTickAt?: number;
  items: TaskItem[];
}

export class TaskStore {
  private readonly filePath: string;
  private items: TaskItem[] = [];
  private lastTickAt: number = 0;

  constructor(novaDir?: string) {
    const dir = novaDir || join(homedir(), ".nova");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.filePath = join(dir, "tasks.json");
    this.load();
  }

  getLastTickAt(): number {
    return this.lastTickAt;
  }

  setLastTickAt(ts: number): void {
    this.lastTickAt = ts;
    this.save();
  }

  // ── CRUD ────────────────────────────────────────────────────────────────

  create(input: CreateTaskInput): TaskItem {
    const item: TaskItem = {
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

  list(filter?: TaskFilter): TaskItem[] {
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

  getById(id: string): TaskItem | undefined {
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
        TaskItem,
        "nextRun" | "message" | "status" | "action" | "schedule" | "timeOfDay"
      >
    >,
  ): TaskItem | null {
    const item = this.items.find((i) => i.id === id);
    if (!item) return null;
    Object.assign(item, changes);
    this.save();
    return item;
  }

  // ── Scheduling ──────────────────────────────────────────────────────────

  /** Get all items that are due (active + nextRun <= now). */
  getDue(now = Date.now()): TaskItem[] {
    this.load();
    return this.items.filter(
      (item) => item.status === "active" && item.nextRun <= now,
    );
  }

  /** Mark a one-shot item as triggered and remove it (it's done).
   *  Safety: refuses to delete recurring items — use advanceRecurring instead. */
  markTriggered(id: string): void {
    const index = this.items.findIndex((i) => i.id === id);
    if (index === -1) return;

    // Guard: never delete recurring items
    const item = this.items[index];
    if (item.kind === "recurring") {
      console.warn(
        `⚠️ markTriggered called on recurring item "${item.message}" — skipping delete, use advanceRecurring instead`,
      );
      return;
    }

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

  getStats(): TaskStats {
    this.load();
    const counts: TaskStats = {
      active: 0,
      triggered: 0,
      cancelled: 0,
      paused: 0,
      total: this.items.length,
    };
    for (const item of this.items) {
      if (item.status in counts) {
        counts[item.status as keyof Omit<TaskStats, "total">]++;
      }
    }
    return counts;
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
      const parsed = JSON.parse(raw);
      // Support both old array format and new object format
      if (Array.isArray(parsed)) {
        this.items = parsed;
        this.lastTickAt = 0;
      } else {
        const data = parsed as TaskFileData;
        this.items = data.items || [];
        this.lastTickAt = data.lastTickAt || 0;
      }
    } catch {
      console.warn("⚠️ Failed to parse tasks.json, starting fresh");
      this.items = [];
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data: TaskFileData = {
      lastTickAt: this.lastTickAt,
      items: this.items,
    };
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}

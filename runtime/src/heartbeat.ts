/**
 * heartbeat.ts — Cron-based heartbeat engine for proactive tasks.
 *
 * Replaces the AutonomyEngine with a simpler system driven by ~/.nova/heartbeat.md.
 * Users define periodic tasks in Markdown, and the engine executes them on schedule.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

// ── Types ───────────────────────────────────────────────────────────────────

export interface HeartbeatTask {
  name: string;
  interval: string; // e.g. "6h", "24h", "30m"
  time?: string; // e.g. "09:00" — for daily tasks
  message: string;
  lastRun?: number;
}

export interface HeartbeatTick {
  task: HeartbeatTask;
  triggeredAt: number;
}

export type HeartbeatHandler = (tick: HeartbeatTick) => Promise<void>;

// ── Default heartbeat.md ────────────────────────────────────────────────────

const DEFAULT_HEARTBEAT = `# Heartbeat Tasks

## Check-in
- interval: 6h
- message: Check in with the user if they've been idle

## Daily Summary
- interval: 24h
- time: 09:00
- message: Send a brief daily summary if there are pending tasks or reminders
`;

// ── Engine ──────────────────────────────────────────────────────────────────

export class HeartbeatEngine {
  private readonly heartbeatPath: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private handler: HeartbeatHandler | null = null;
  private lastRunTimes: Map<string, number> = new Map();
  private readonly tickIntervalMs: number;

  constructor(novaDir?: string, tickIntervalMs = 60_000) {
    const dir = novaDir || join(homedir(), ".nova");
    this.heartbeatPath = join(dir, "heartbeat.md");
    this.tickIntervalMs = tickIntervalMs;

    // Create default heartbeat.md if missing
    if (!existsSync(this.heartbeatPath)) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.heartbeatPath, DEFAULT_HEARTBEAT, "utf-8");
    }
  }

  /**
   * Parse heartbeat.md into task definitions.
   */
  parseTasks(): HeartbeatTask[] {
    if (!existsSync(this.heartbeatPath)) return [];

    const content = readFileSync(this.heartbeatPath, "utf-8");
    const tasks: HeartbeatTask[] = [];
    let current: Partial<HeartbeatTask> | null = null;

    for (const line of content.split("\n")) {
      const headingMatch = line.match(/^##\s+(.+)$/);
      if (headingMatch) {
        if (current?.name && current?.message) {
          tasks.push(current as HeartbeatTask);
        }
        current = { name: headingMatch[1].trim() };
        continue;
      }

      const kvMatch = line.match(/^-\s+(.+?):\s+(.+)$/);
      if (kvMatch && current) {
        const key = kvMatch[1].trim().toLowerCase();
        const value = kvMatch[2].trim();
        if (key === "interval") current.interval = value;
        if (key === "time") current.time = value;
        if (key === "message") current.message = value;
      }
    }

    if (current?.name && current?.message) {
      tasks.push(current as HeartbeatTask);
    }

    return tasks;
  }

  /**
   * Parse an interval string like "6h", "30m", "24h" into milliseconds.
   */
  parseIntervalMs(interval: string): number {
    const match = interval.match(/^(\d+)(m|h|d|s)$/i);
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

  /**
   * Check if a task should run now.
   */
  shouldRun(task: HeartbeatTask, now = Date.now()): boolean {
    const intervalMs = this.parseIntervalMs(task.interval || "1h");
    const lastRun = this.lastRunTimes.get(task.name) || 0;

    if (now - lastRun < intervalMs) return false;

    // If a specific time is set, check if we're in the right time window
    if (task.time) {
      const [hours, minutes] = task.time.split(":").map(Number);
      const nowDate = new Date(now);
      const taskMinutes = hours * 60 + minutes;
      const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
      // Allow a 5-minute window
      if (Math.abs(nowMinutes - taskMinutes) > 5) return false;
    }

    return true;
  }

  /**
   * Register a handler for heartbeat ticks.
   */
  onTick(handler: HeartbeatHandler): void {
    this.handler = handler;
  }

  /**
   * Start the heartbeat loop.
   */
  start(): void {
    if (this.timer) return;

    console.log("💓 Heartbeat engine started");

    this.timer = setInterval(async () => {
      await this.tick();
    }, this.tickIntervalMs);

    // Run immediately on start
    this.tick().catch((err) => {
      console.error("⚠️ Heartbeat tick error:", err);
    });
  }

  /**
   * Run one tick — check all tasks and fire handler for due tasks.
   */
  async tick(now = Date.now()): Promise<HeartbeatTick[]> {
    const tasks = this.parseTasks();
    const fired: HeartbeatTick[] = [];

    for (const task of tasks) {
      if (this.shouldRun(task, now)) {
        const tick: HeartbeatTick = { task, triggeredAt: now };
        this.lastRunTimes.set(task.name, now);
        fired.push(tick);

        if (this.handler) {
          try {
            await this.handler(tick);
          } catch (err) {
            console.error(
              `⚠️ Heartbeat handler error for "${task.name}":`,
              err,
            );
          }
        }
      }
    }

    return fired;
  }

  /**
   * Stop the heartbeat loop.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("💓 Heartbeat engine stopped");
    }
  }

  /**
   * Get the path to heartbeat.md.
   */
  getHeartbeatPath(): string {
    return this.heartbeatPath;
  }
}

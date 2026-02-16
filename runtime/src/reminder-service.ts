import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { parseSchedule, ParsedSchedule } from "./time-parser.js";
import { CronExpressionParser } from "cron-parser";

export type ReminderType = "reminder" | "research";
export type ReminderStatus = "scheduled" | "sending" | "sent" | "cancelled" | "failed";
export type ReminderKind = "one_time" | "recurring";

export interface ReminderRecord {
  id: string;
  kind: ReminderKind;
  type: ReminderType;
  message: string;
  query?: string;
  recipientEmail: string;
  schedule?: string;
  nextRunAt: number;
  lastRunAt?: number;
  status: ReminderStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ReminderFilter {
  status?: ReminderStatus;
  kind?: ReminderKind;
  type?: ReminderType;
  recipientEmail?: string;
  limit?: number;
}

/**
 * SQLite-backed reminder service with polling-based scheduling.
 *
 * Key improvements over the previous file-based system:
 * - SQLite transactions for atomic reads/writes
 * - Indexed queries for efficient due-reminder lookup
 * - Polling loop instead of per-reminder setTimeout (survives restarts)
 * - Proper status management with failed state
 */
export class ReminderService {
  private db: Database.Database;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private sender: (reminder: ReminderRecord) => Promise<void>;
  private pollMs: number;
  private running = false;

  constructor(
    dbPath: string,
    sender: (reminder: ReminderRecord) => Promise<void>,
    pollMs = 30_000,
  ) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.sender = sender;
    this.pollMs = pollMs;

    this.initializeSchema();
  }

  // === Schema ===

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'one_time',
        type TEXT NOT NULL DEFAULT 'reminder',
        message TEXT NOT NULL,
        query TEXT,
        recipient_email TEXT NOT NULL,
        schedule TEXT,
        next_run_at INTEGER NOT NULL,
        last_run_at INTEGER,
        status TEXT NOT NULL DEFAULT 'scheduled',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reminders_due
        ON reminders(next_run_at)
        WHERE status = 'scheduled';

      CREATE INDEX IF NOT EXISTS idx_reminders_status
        ON reminders(status);

      CREATE INDEX IF NOT EXISTS idx_reminders_recipient
        ON reminders(recipient_email);
    `);
  }

  // === CRUD ===

  /**
   * Create a one-time reminder.
   */
  async create(params: {
    type: ReminderType;
    message: string;
    query?: string;
    recipientEmail: string;
    sendAt: number;
  }): Promise<ReminderRecord> {
    const now = Date.now();
    const reminder: ReminderRecord = {
      id: `rem-${now}-${Math.random().toString(36).slice(2, 9)}`,
      kind: "one_time",
      type: params.type,
      message: params.message,
      query: params.query,
      recipientEmail: params.recipientEmail,
      nextRunAt: params.sendAt,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    };

    this.insertReminder(reminder);
    return reminder;
  }

  /**
   * Create a recurring reminder.
   */
  async createRecurring(params: {
    type: ReminderType;
    message: string;
    query?: string;
    recipientEmail: string;
    schedule: string;
  }): Promise<ReminderRecord> {
    const nextRun = this.computeNextRun(params.schedule, Date.now());
    if (!nextRun) {
      throw new Error(`Could not compute next run for schedule: ${params.schedule}`);
    }

    const now = Date.now();
    const reminder: ReminderRecord = {
      id: `rem-${now}-${Math.random().toString(36).slice(2, 9)}`,
      kind: "recurring",
      type: params.type,
      message: params.message,
      query: params.query,
      recipientEmail: params.recipientEmail,
      schedule: params.schedule,
      nextRunAt: nextRun,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    };

    this.insertReminder(reminder);
    return reminder;
  }

  /**
   * Get a single reminder by ID.
   */
  get(id: string): ReminderRecord | null {
    const row = this.db
      .prepare("SELECT * FROM reminders WHERE id = ?")
      .get(id) as any;
    return row ? this.rowToRecord(row) : null;
  }

  /**
   * List reminders with optional filters.
   */
  list(filter?: ReminderFilter): ReminderRecord[] {
    let sql = "SELECT * FROM reminders WHERE 1=1";
    const params: any[] = [];

    if (filter?.status) {
      sql += " AND status = ?";
      params.push(filter.status);
    }
    if (filter?.kind) {
      sql += " AND kind = ?";
      params.push(filter.kind);
    }
    if (filter?.type) {
      sql += " AND type = ?";
      params.push(filter.type);
    }
    if (filter?.recipientEmail) {
      sql += " AND recipient_email = ?";
      params.push(filter.recipientEmail);
    }

    sql += " ORDER BY next_run_at ASC";

    if (filter?.limit) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.rowToRecord(row));
  }

  /**
   * Update a reminder's message or schedule.
   */
  update(
    id: string,
    data: { message?: string; schedule?: string; recipientEmail?: string },
  ): ReminderRecord | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = Date.now();
    let nextRunAt = existing.nextRunAt;

    // If schedule changed on a recurring reminder, recompute next run
    if (data.schedule && existing.kind === "recurring") {
      const computed = this.computeNextRun(data.schedule, now);
      if (!computed) throw new Error(`Invalid schedule: ${data.schedule}`);
      nextRunAt = computed;
    }

    this.db
      .prepare(
        `UPDATE reminders SET
          message = COALESCE(?, message),
          schedule = COALESCE(?, schedule),
          recipient_email = COALESCE(?, recipient_email),
          next_run_at = ?,
          updated_at = ?
        WHERE id = ?`,
      )
      .run(
        data.message ?? null,
        data.schedule ?? null,
        data.recipientEmail ?? null,
        nextRunAt,
        now,
        id,
      );

    return this.get(id);
  }

  /**
   * Cancel a reminder.
   */
  cancel(id: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE reminders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'scheduled'",
      )
      .run(Date.now(), id);
    return result.changes > 0;
  }

  /**
   * Permanently delete a reminder.
   */
  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM reminders WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // === Scheduling ===

  /**
   * Start the polling loop that checks for due reminders.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Immediately check for past-due reminders on startup
    this.poll();

    this.pollInterval = setInterval(() => {
      this.poll();
    }, this.pollMs);
  }

  /**
   * Shut down the polling loop.
   */
  shutdown(): void {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Close the database connection and stop polling.
   */
  close(): void {
    this.shutdown();
    this.db.close();
  }

  /**
   * Poll for due reminders and trigger them.
   */
  private poll(): void {
    const now = Date.now();

    const dueReminders = this.db
      .prepare(
        "SELECT * FROM reminders WHERE status = 'scheduled' AND next_run_at <= ? ORDER BY next_run_at ASC",
      )
      .all(now) as any[];

    for (const row of dueReminders) {
      const reminder = this.rowToRecord(row);
      this.execute(reminder).catch((err) => {
        console.error(`❌ Reminder ${reminder.id} execution failed:`, err);
      });
    }
  }

  /**
   * Execute a single due reminder: send it, then reschedule or mark as sent.
   */
  private async execute(reminder: ReminderRecord): Promise<void> {
    // Mark as sending (atomic guard against double execution)
    const updated = this.db
      .prepare(
        "UPDATE reminders SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'scheduled'",
      )
      .run(Date.now(), reminder.id);

    if (updated.changes === 0) {
      // Already picked up by another poll or cancelled
      return;
    }

    try {
      await this.sender(reminder);

      if (reminder.kind === "recurring" && reminder.schedule) {
        // Compute and schedule next run
        const nextRun = this.computeNextRun(reminder.schedule, Date.now());
        if (nextRun) {
          this.db
            .prepare(
              `UPDATE reminders SET
                status = 'scheduled',
                next_run_at = ?,
                last_run_at = ?,
                updated_at = ?
              WHERE id = ?`,
            )
            .run(nextRun, Date.now(), Date.now(), reminder.id);
        } else {
          // No more occurrences
          this.db
            .prepare(
              "UPDATE reminders SET status = 'cancelled', last_run_at = ?, updated_at = ? WHERE id = ?",
            )
            .run(Date.now(), Date.now(), reminder.id);
        }
      } else {
        // One-time: mark as sent
        this.db
          .prepare(
            "UPDATE reminders SET status = 'sent', last_run_at = ?, updated_at = ? WHERE id = ?",
          )
          .run(Date.now(), Date.now(), reminder.id);
      }
    } catch (error) {
      console.error(`❌ Reminder ${reminder.id} send failed:`, error);

      if (reminder.kind === "recurring" && reminder.schedule) {
        // Still try to reschedule recurring reminders on failure
        const nextRun = this.computeNextRun(reminder.schedule, Date.now());
        if (nextRun) {
          this.db
            .prepare(
              `UPDATE reminders SET
                status = 'scheduled',
                next_run_at = ?,
                last_run_at = ?,
                updated_at = ?
              WHERE id = ?`,
            )
            .run(nextRun, Date.now(), Date.now(), reminder.id);
        } else {
          this.db
            .prepare(
              "UPDATE reminders SET status = 'failed', last_run_at = ?, updated_at = ? WHERE id = ?",
            )
            .run(Date.now(), Date.now(), reminder.id);
        }
      } else {
        this.db
          .prepare(
            "UPDATE reminders SET status = 'failed', last_run_at = ?, updated_at = ? WHERE id = ?",
          )
          .run(Date.now(), Date.now(), reminder.id);
      }
    }
  }

  // === Helpers ===

  private insertReminder(reminder: ReminderRecord): void {
    this.db
      .prepare(
        `INSERT INTO reminders (
          id, kind, type, message, query, recipient_email,
          schedule, next_run_at, last_run_at, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reminder.id,
        reminder.kind,
        reminder.type,
        reminder.message,
        reminder.query ?? null,
        reminder.recipientEmail,
        reminder.schedule ?? null,
        reminder.nextRunAt,
        reminder.lastRunAt ?? null,
        reminder.status,
        reminder.createdAt,
        reminder.updatedAt,
      );
  }

  private rowToRecord(row: any): ReminderRecord {
    return {
      id: row.id,
      kind: row.kind,
      type: row.type,
      message: row.message,
      query: row.query ?? undefined,
      recipientEmail: row.recipient_email,
      schedule: row.schedule ?? undefined,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at ?? undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private computeNextRun(schedule: string, fromTime: number): number | null {
    const parsed: ParsedSchedule = parseSchedule(schedule);
    if (parsed.error || parsed.needsTime) return null;

    if (parsed.intervalMs && parsed.intervalMs > 0) {
      return fromTime + parsed.intervalMs;
    }

    if (parsed.cron) {
      const parts = parsed.cron.trim().split(/\s+/);
      if (parts.length === 5 || parts.length === 6) {
        try {
          const interval = CronExpressionParser.parse(parsed.cron, {
            currentDate: new Date(fromTime),
            tz: process.env.TZ,
          });
          return interval.next().toDate().getTime();
        } catch {
          return null;
        }
      }
      return null;
    }

    if (parsed.dailyTime) {
      const target = new Date(fromTime);
      target.setSeconds(0, 0);
      target.setHours(parsed.dailyTime.hour, parsed.dailyTime.minute, 0, 0);
      if (target.getTime() <= fromTime) {
        target.setDate(target.getDate() + 1);
      }

      for (let i = 0; i < 14; i++) {
        const day = target.getDay();
        const isWeekend = day === 0 || day === 6;
        if (parsed.weekdaysOnly && isWeekend) {
          target.setDate(target.getDate() + 1);
          continue;
        }
        if (parsed.weekendsOnly && !isWeekend) {
          target.setDate(target.getDate() + 1);
          continue;
        }
        return target.getTime();
      }
      return null;
    }

    return null;
  }
}

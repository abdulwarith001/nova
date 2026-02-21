/**
 * learning-engine.ts — File-based learning job queue.
 *
 * Replaces the SQLite-backed LearningEngine.
 * Uses a JSON file (~/.nova/memory/learning-jobs.json) as the job queue.
 */

import { join } from "path";
import { randomUUID } from "crypto";
import {
  readMarkdownFile,
  writeMarkdownFile,
  ensureDir,
} from "./markdown-store.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type MemoryJobType =
  | "post_turn_extract"
  | "post_turn_reflect"
  | "hourly_sweep"
  | "self_audit"
  | "conversation_analysis"
  | "self_discovery";

export interface LearningJob {
  id: string;
  userId: string;
  conversationId: string;
  type: MemoryJobType;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "completed" | "failed" | "dead_letter";
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// ── Engine ──────────────────────────────────────────────────────────────────

export class MarkdownLearningEngine {
  private readonly jobsPath: string;

  constructor(memoryDir: string) {
    ensureDir(memoryDir);
    this.jobsPath = join(memoryDir, "learning-jobs.json");
  }

  private readJobs(): LearningJob[] {
    const content = readMarkdownFile(this.jobsPath);
    if (!content) return [];
    try {
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  private writeJobs(jobs: LearningJob[]): void {
    writeMarkdownFile(this.jobsPath, JSON.stringify(jobs, null, 2));
  }

  enqueueJob(input: {
    userId: string;
    conversationId: string;
    type: MemoryJobType;
    payload?: Record<string, unknown>;
    maxAttempts?: number;
    runAfter?: number;
  }): string {
    const now = Date.now();
    const id = `job-${now}-${randomUUID().slice(0, 8)}`;
    const jobs = this.readJobs();

    jobs.push({
      id,
      userId: input.userId,
      conversationId: input.conversationId,
      type: input.type,
      payload: input.payload || {},
      status: "pending",
      attempts: 0,
      maxAttempts: Math.max(1, Math.min(20, input.maxAttempts || 5)),
      runAfter: input.runAfter || now,
      createdAt: now,
      updatedAt: now,
    });

    this.writeJobs(jobs);
    return id;
  }

  listPendingJobs(limit = 20, now = Date.now()): LearningJob[] {
    const jobs = this.readJobs();
    return jobs
      .filter(
        (j) =>
          (j.status === "pending" || j.status === "failed") &&
          j.runAfter <= now,
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, Math.max(1, Math.min(200, limit)));
  }

  markProcessing(id: string): void {
    const jobs = this.readJobs();
    const job = jobs.find((j) => j.id === id);
    if (job) {
      job.status = "processing";
      job.updatedAt = Date.now();
      this.writeJobs(jobs);
    }
  }

  markCompleted(id: string): void {
    const jobs = this.readJobs();
    const job = jobs.find((j) => j.id === id);
    if (job) {
      job.status = "completed";
      job.updatedAt = Date.now();
      this.writeJobs(jobs);
    }
  }

  markFailed(
    id: string,
    attempts: number,
    maxAttempts: number,
    error: string,
  ): void {
    const jobs = this.readJobs();
    const job = jobs.find((j) => j.id === id);
    if (!job) return;

    const now = Date.now();
    job.attempts = attempts;
    job.error = error;
    job.updatedAt = now;

    if (attempts >= maxAttempts) {
      job.status = "dead_letter";
    } else {
      job.status = "failed";
      const retryDelayMs = Math.min(
        60 * 60 * 1000,
        1000 * 2 ** Math.max(1, attempts),
      );
      job.runAfter = now + retryDelayMs;
    }

    this.writeJobs(jobs);
  }

  /**
   * Purge completed and dead-letter jobs older than maxAge.
   */
  purgeOldJobs(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    const jobs = this.readJobs();
    const filtered = jobs.filter(
      (j) =>
        !(
          (j.status === "completed" || j.status === "dead_letter") &&
          j.updatedAt < cutoff
        ),
    );
    const purged = jobs.length - filtered.length;
    if (purged > 0) this.writeJobs(filtered);
    return purged;
  }
}

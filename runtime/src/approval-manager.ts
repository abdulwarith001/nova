/**
 * approval-manager.ts — File-based approval system.
 *
 * Replaces the SQLite approval_requests table with a JSON file.
 * Used when the HeartbeatEngine or sub-agents want to perform high-impact
 * actions that require user consent.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  userId: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
  reason: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: number;
  expiresAt: number;
  resolvedAt?: number;
  rejectionReason?: string;
  token?: string;
}

// ── Manager ─────────────────────────────────────────────────────────────────

export class ApprovalManager {
  private readonly filePath: string;

  constructor(novaDir?: string) {
    const dir = novaDir || join(homedir(), ".nova");
    const memDir = join(dir, "memory");
    if (!existsSync(memDir)) {
      mkdirSync(memDir, { recursive: true });
    }
    this.filePath = join(memDir, "approvals.json");
  }

  // ── Read/write ──────────────────────────────────────────────────────────

  private readRequests(): ApprovalRequest[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  private writeRequests(requests: ApprovalRequest[]): void {
    writeFileSync(this.filePath, JSON.stringify(requests, null, 2), "utf-8");
  }

  // ── Create ──────────────────────────────────────────────────────────────

  createRequest(input: {
    userId: string;
    actionType: string;
    actionPayload: Record<string, unknown>;
    reason: string;
    ttlMs?: number;
  }): ApprovalRequest {
    const now = Date.now();
    const request: ApprovalRequest = {
      id: randomUUID(),
      userId: input.userId,
      actionType: input.actionType,
      actionPayload: input.actionPayload,
      reason: input.reason,
      status: "pending",
      createdAt: now,
      expiresAt: now + (input.ttlMs || 24 * 60 * 60 * 1000), // default 24h
    };

    const requests = this.readRequests();
    requests.push(request);
    this.writeRequests(requests);

    return request;
  }

  // ── List ────────────────────────────────────────────────────────────────

  listRequests(input?: {
    userId?: string;
    status?: ApprovalRequest["status"];
    limit?: number;
  }): ApprovalRequest[] {
    let requests = this.readRequests();

    // Auto-expire old requests
    const now = Date.now();
    let changed = false;
    for (const req of requests) {
      if (req.status === "pending" && req.expiresAt < now) {
        req.status = "expired";
        req.resolvedAt = now;
        changed = true;
      }
    }
    if (changed) this.writeRequests(requests);

    if (input?.userId) {
      requests = requests.filter((r) => r.userId === input.userId);
    }
    if (input?.status) {
      requests = requests.filter((r) => r.status === input.status);
    }

    // Most recent first
    requests.sort((a, b) => b.createdAt - a.createdAt);

    if (input?.limit) {
      requests = requests.slice(0, input.limit);
    }

    return requests;
  }

  // ── Approve ─────────────────────────────────────────────────────────────

  approve(requestId: string): { id: string; token: string } | null {
    const requests = this.readRequests();
    const request = requests.find((r) => r.id === requestId);

    if (!request || request.status !== "pending") return null;

    const token = randomUUID();
    request.status = "approved";
    request.resolvedAt = Date.now();
    request.token = token;

    this.writeRequests(requests);

    return { id: request.id, token };
  }

  // ── Reject ──────────────────────────────────────────────────────────────

  reject(requestId: string, reason?: string): boolean {
    const requests = this.readRequests();
    const request = requests.find((r) => r.id === requestId);

    if (!request || request.status !== "pending") return false;

    request.status = "rejected";
    request.resolvedAt = Date.now();
    request.rejectionReason = reason;

    this.writeRequests(requests);
    return true;
  }

  // ── Purge ───────────────────────────────────────────────────────────────

  purgeResolved(olderThanMs = 7 * 24 * 60 * 60 * 1000): number {
    const requests = this.readRequests();
    const cutoff = Date.now() - olderThanMs;
    const kept = requests.filter(
      (r) => r.status === "pending" || (r.resolvedAt && r.resolvedAt > cutoff),
    );

    const purged = requests.length - kept.length;
    if (purged > 0) this.writeRequests(kept);
    return purged;
  }
}

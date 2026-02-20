import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { threadId } from "worker_threads";

export interface ProfileLease {
  profileId: string;
  profilePath: string;
  lockPath: string;
  lockToken: string;
}

interface ProfileLockFile {
  pid: number;
  threadId?: number;
  lockToken: string;
  createdAt: number;
  expiresAt: number;
}

export class ProfileStore {
  readonly rootDir: string;
  private readonly leaseMs: number;

  constructor(options?: { rootDir?: string; leaseMs?: number }) {
    this.rootDir =
      options?.rootDir || join(homedir(), ".nova", "profiles");
    this.leaseMs = Math.max(30_000, options?.leaseMs ?? 10 * 60 * 1000);
    mkdirSync(this.rootDir, { recursive: true });
  }

  sanitizeProfileId(input: string): string {
    const cleaned = String(input || "default")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-")
      .slice(0, 80);
    return cleaned || "default";
  }

  getProfilePath(profileId: string): string {
    const safeId = this.sanitizeProfileId(profileId);
    return join(this.rootDir, safeId);
  }

  acquire(profileId: string): ProfileLease {
    const safeId = this.sanitizeProfileId(profileId);
    const profilePath = this.getProfilePath(safeId);
    mkdirSync(profilePath, { recursive: true });

    const lockPath = join(profilePath, ".profile.lock.json");
    const now = Date.now();
    const lockToken = randomUUID();

    const currentLock = this.readLock(lockPath);
    if (currentLock) {
      const isExpired = currentLock.expiresAt <= now;
      const sameProcess = currentLock.pid === process.pid;
      const pidAlive = isProcessAlive(currentLock.pid);

      const staleByProcessDeath = !pidAlive;
      const staleBySameProcessRecovery = sameProcess;

      if (isExpired || staleByProcessDeath || staleBySameProcessRecovery) {
        rmSync(lockPath, { force: true });
      } else {
        throw new Error(
          `Profile '${safeId}' is locked by pid ${currentLock.pid}. Wait and retry.`,
        );
      }
    }

    const lock: ProfileLockFile = {
      pid: process.pid,
      threadId,
      lockToken,
      createdAt: now,
      expiresAt: now + this.leaseMs,
    };
    writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf-8");

    return {
      profileId: safeId,
      profilePath,
      lockPath,
      lockToken,
    };
  }

  renew(lease: ProfileLease): void {
    const lock = this.readLock(lease.lockPath);
    if (!lock || lock.lockToken !== lease.lockToken) return;

    const now = Date.now();
    const updated: ProfileLockFile = {
      ...lock,
      expiresAt: now + this.leaseMs,
    };
    writeFileSync(lease.lockPath, JSON.stringify(updated, null, 2), "utf-8");
  }

  release(lease: ProfileLease): void {
    const lock = this.readLock(lease.lockPath);
    if (!lock) return;
    if (lock.lockToken !== lease.lockToken) return;

    rmSync(lease.lockPath, { force: true });
  }

  private readLock(lockPath: string): ProfileLockFile | null {
    if (!existsSync(lockPath)) return null;

    try {
      return JSON.parse(readFileSync(lockPath, "utf-8")) as ProfileLockFile;
    } catch {
      return null;
    }
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === "EPERM") return true;
    return false;
  }
}

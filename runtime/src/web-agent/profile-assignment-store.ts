import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface AssignmentFile {
  version: 1;
  sessions: Record<string, string>;
}

const EMPTY_ASSIGNMENTS: AssignmentFile = {
  version: 1,
  sessions: {},
};

export class ProfileAssignmentStore {
  readonly filePath: string;

  constructor(rootDir = join(homedir(), ".nova", "web-agent")) {
    mkdirSync(rootDir, { recursive: true });
    this.filePath = join(rootDir, "profile-assignments.json");
  }

  get(sessionId: string): string | undefined {
    const key = this.normalize(sessionId);
    if (!key) return undefined;

    const data = this.readAssignments();
    const value = data.sessions[key];
    return value ? this.normalize(value) : undefined;
  }

  set(sessionId: string, profileId: string): void {
    const key = this.normalize(sessionId);
    const value = this.normalize(profileId);
    if (!key || !value) return;

    const data = this.readAssignments();
    if (data.sessions[key] === value) return;

    data.sessions[key] = value;
    this.writeAssignments(data);
  }

  private normalize(value: string): string {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-")
      .slice(0, 80);
  }

  private readAssignments(): AssignmentFile {
    if (!existsSync(this.filePath)) return { ...EMPTY_ASSIGNMENTS };

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as AssignmentFile;
      if (!parsed || typeof parsed !== "object") return { ...EMPTY_ASSIGNMENTS };
      const sessions =
        parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {};
      return {
        version: 1,
        sessions,
      };
    } catch {
      return { ...EMPTY_ASSIGNMENTS };
    }
  }

  private writeAssignments(data: AssignmentFile): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`profile assignment write skipped: ${reason}`);
    }
  }
}

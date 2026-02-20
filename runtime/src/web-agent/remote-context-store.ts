import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface SessionContextAssignment {
  contextId: string;
  remoteSessionId?: string;
  updatedAt: number;
}

interface ContextAssignmentFile {
  version: 1;
  profiles: Record<string, string>;
  profileSessionContexts: Record<string, Record<string, unknown>>;
  sessions: Record<string, SessionContextAssignment>;
}

const EMPTY_ASSIGNMENTS: ContextAssignmentFile = {
  version: 1,
  profiles: {},
  profileSessionContexts: {},
  sessions: {},
};

export class RemoteContextStore {
  readonly filePath: string;

  constructor(rootDir = join(homedir(), ".nova", "web-agent")) {
    mkdirSync(rootDir, { recursive: true });
    this.filePath = join(rootDir, "remote-context-assignments.json");
  }

  getProfileContext(profileId: string): string | undefined {
    const key = this.normalize(profileId);
    if (!key) return undefined;
    const data = this.readAssignments();
    const value = data.profiles[key];
    return value ? this.normalize(value) : undefined;
  }

  setProfileContext(profileId: string, contextId: string): void {
    const key = this.normalize(profileId);
    const value = this.normalize(contextId);
    if (!key || !value) return;

    const data = this.readAssignments();
    if (data.profiles[key] === value) return;
    data.profiles[key] = value;
    this.writeAssignments(data);
  }

  getProfileSessionContext(profileId: string): Record<string, unknown> | undefined {
    const key = this.normalize(profileId);
    if (!key) return undefined;
    const data = this.readAssignments();
    const value = data.profileSessionContexts[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return value;
  }

  setProfileSessionContext(
    profileId: string,
    sessionContext: Record<string, unknown>,
  ): void {
    const key = this.normalize(profileId);
    if (!key) return;
    if (!sessionContext || typeof sessionContext !== "object" || Array.isArray(sessionContext)) {
      return;
    }
    const data = this.readAssignments();
    data.profileSessionContexts[key] = sessionContext;
    this.writeAssignments(data);
  }

  getSessionContext(sessionId: string): SessionContextAssignment | undefined {
    const key = this.normalize(sessionId);
    if (!key) return undefined;
    const data = this.readAssignments();
    return data.sessions[key];
  }

  setSessionContext(
    sessionId: string,
    assignment: { contextId: string; remoteSessionId?: string },
  ): void {
    const key = this.normalize(sessionId);
    const contextId = this.normalize(assignment.contextId);
    const remoteSessionId = assignment.remoteSessionId
      ? this.normalize(assignment.remoteSessionId)
      : undefined;
    if (!key || !contextId) return;

    const data = this.readAssignments();
    data.sessions[key] = {
      contextId,
      remoteSessionId,
      updatedAt: Date.now(),
    };
    this.writeAssignments(data);
  }

  clearSessionContext(sessionId: string): void {
    const key = this.normalize(sessionId);
    if (!key) return;
    const data = this.readAssignments();
    if (!data.sessions[key]) return;
    delete data.sessions[key];
    this.writeAssignments(data);
  }

  private normalize(value: string): string {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-")
      .slice(0, 120);
  }

  private readAssignments(): ContextAssignmentFile {
    if (!existsSync(this.filePath)) return { ...EMPTY_ASSIGNMENTS };

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as ContextAssignmentFile;
      if (!parsed || typeof parsed !== "object") return { ...EMPTY_ASSIGNMENTS };
      return {
        version: 1,
        profiles:
          parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {},
        profileSessionContexts:
          parsed.profileSessionContexts &&
          typeof parsed.profileSessionContexts === "object"
            ? parsed.profileSessionContexts
            : {},
        sessions:
          parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
      };
    } catch {
      return { ...EMPTY_ASSIGNMENTS };
    }
  }

  private writeAssignments(data: ContextAssignmentFile): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`remote context assignment write skipped: ${reason}`);
    }
  }
}

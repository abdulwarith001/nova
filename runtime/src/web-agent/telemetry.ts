import { appendFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface TelemetryEvent {
  sessionId: string;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export class WebTelemetry {
  private readonly rootDir: string;

  constructor(rootDir = join(homedir(), ".nova", "web-agent", "telemetry")) {
    this.rootDir = rootDir;
    mkdirSync(this.rootDir, { recursive: true });
  }

  record(
    sessionId: string,
    type: string,
    payload: Record<string, unknown> = {},
  ): void {
    const event: TelemetryEvent = {
      sessionId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    };
    const filePath = this.filePath(sessionId);
    try {
      appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf-8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`web telemetry write skipped: ${reason}`);
    }
  }

  private filePath(sessionId: string): string {
    const safe = String(sessionId || "default").replace(/[^a-zA-Z0-9._-]/g, "-");
    return join(this.rootDir, `${safe}.jsonl`);
  }
}

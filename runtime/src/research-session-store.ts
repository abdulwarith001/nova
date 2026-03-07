import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import { canonicalizeUrl, isHttpUrl } from "./web-agent/url-utils.js";

export interface ResearchSessionSource {
  title: string;
  url: string;
  whyRelevant: string;
}

export interface ResearchLaneSessionSummary {
  focusArea: string;
  pagesVisited: string[];
  notableDeviations: string[];
}

export interface ResearchSessionRecord {
  sessionId: string;
  topic: string;
  summary: string;
  lastAnswer: string;
  keyFindings: string[];
  disagreements: string[];
  openQuestions: string[];
  followUpQuestions: string[];
  sources: ResearchSessionSource[];
  confidence: number;
  rounds: number;
  laneSummary: ResearchLaneSessionSummary[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

interface ResearchSessionFile {
  version: 1;
  sessions: Record<string, ResearchSessionRecord>;
}

interface SessionStoreOptions {
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class ResearchSessionStore {
  readonly filePath: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    rootDir = join(homedir(), ".nova"),
    options: SessionStoreOptions = {},
  ) {
    mkdirSync(rootDir, { recursive: true });
    this.filePath = join(rootDir, "research-sessions.json");
    this.ttlMs = Math.max(1, Number(options.ttlMs || DEFAULT_TTL_MS));
    this.now = options.now || (() => Date.now());
  }

  hasActive(sessionId: string): boolean {
    return !!this.getActive(sessionId);
  }

  getActive(sessionId: string): ResearchSessionRecord | undefined {
    const normalized = this.normalizeSessionId(sessionId);
    if (!normalized) return undefined;

    const file = this.readFile();
    const now = this.now();
    let changed = false;

    for (const [key, entry] of Object.entries(file.sessions)) {
      if (!entry || entry.expiresAt <= now) {
        delete file.sessions[key];
        changed = true;
      }
    }

    if (changed) this.writeFile(file);
    const found = file.sessions[normalized];
    return found ? this.clone(found) : undefined;
  }

  clear(sessionId: string): boolean {
    const normalized = this.normalizeSessionId(sessionId);
    if (!normalized) return false;
    const file = this.readFile();
    if (!file.sessions[normalized]) return false;
    delete file.sessions[normalized];
    this.writeFile(file);
    return true;
  }

  upsert(
    sessionId: string,
    payload: Omit<
      ResearchSessionRecord,
      "sessionId" | "createdAt" | "updatedAt" | "expiresAt"
    >,
  ): ResearchSessionRecord {
    const normalized = this.normalizeSessionId(sessionId);
    if (!normalized) {
      throw new Error("sessionId is required");
    }

    const now = this.now();
    const file = this.readFile();
    const existing = file.sessions[normalized];

    const next: ResearchSessionRecord = {
      sessionId: normalized,
      topic: this.sanitize(payload.topic, 300),
      summary: this.sanitize(payload.summary, 5000),
      lastAnswer: this.sanitize(payload.lastAnswer, 25_000),
      keyFindings: this.uniqueStrings(payload.keyFindings, 20, 400),
      disagreements: this.uniqueStrings(payload.disagreements, 20, 400),
      openQuestions: this.uniqueStrings(payload.openQuestions, 20, 300),
      followUpQuestions: this.uniqueStrings(payload.followUpQuestions, 20, 300),
      sources: this.normalizeSources(payload.sources, 20),
      confidence: this.clamp(payload.confidence, 0, 1),
      rounds: Math.max(1, Math.min(2, Math.floor(Number(payload.rounds || 1)))),
      laneSummary: this.normalizeLaneSummary(payload.laneSummary),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expiresAt: now + this.ttlMs,
    };

    file.sessions[normalized] = next;
    this.writeFile(file);
    return this.clone(next);
  }

  private normalizeLaneSummary(
    entries: ResearchLaneSessionSummary[] | undefined,
  ): ResearchLaneSessionSummary[] {
    const source = Array.isArray(entries) ? entries : [];
    const output: ResearchLaneSessionSummary[] = [];

    for (const entry of source) {
      if (!entry || typeof entry !== "object") continue;
      const focusArea = this.sanitize((entry as any).focusArea, 180);
      if (!focusArea) continue;
      output.push({
        focusArea,
        pagesVisited: this.normalizeUrls((entry as any).pagesVisited, 8),
        notableDeviations: this.uniqueStrings(
          (entry as any).notableDeviations,
          8,
          220,
        ),
      });
      if (output.length >= 8) break;
    }

    return output;
  }

  private normalizeSources(
    raw: ResearchSessionSource[] | undefined,
    limit: number,
  ): ResearchSessionSource[] {
    const source = Array.isArray(raw) ? raw : [];
    const out: ResearchSessionSource[] = [];
    const seen = new Set<string>();

    for (const entry of source) {
      if (!entry || typeof entry !== "object") continue;
      const url = canonicalizeUrl(this.sanitize((entry as any).url, 2000));
      if (!isHttpUrl(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      out.push({
        title: this.sanitize((entry as any).title, 300) || url,
        url,
        whyRelevant:
          this.sanitize((entry as any).whyRelevant, 400) ||
          "Referenced during research.",
      });

      if (out.length >= limit) break;
    }

    return out;
  }

  private normalizeUrls(raw: unknown, limit: number): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of raw) {
      const url = canonicalizeUrl(this.sanitize(value, 2000));
      if (!isHttpUrl(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
      if (out.length >= limit) break;
    }
    return out;
  }

  private uniqueStrings(raw: unknown, limit: number, maxLen: number): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();

    for (const value of raw) {
      const text = this.sanitize(value, maxLen);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= limit) break;
    }

    return out;
  }

  private sanitize(value: unknown, maxLen: number): string {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLen);
  }

  private normalizeSessionId(raw: string): string {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._:-]/g, "-")
      .slice(0, 120);
  }

  private clamp(value: unknown, min: number, max: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private readFile(): ResearchSessionFile {
    if (!existsSync(this.filePath)) {
      return { version: 1, sessions: {} };
    }
    try {
      const parsed = JSON.parse(
        readFileSync(this.filePath, "utf-8"),
      ) as ResearchSessionFile;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !parsed.sessions ||
        typeof parsed.sessions !== "object"
      ) {
        return { version: 1, sessions: {} };
      }
      return {
        version: 1,
        sessions: parsed.sessions,
      };
    } catch {
      return { version: 1, sessions: {} };
    }
  }

  private writeFile(data: ResearchSessionFile): void {
    try {
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      renameSync(tmpPath, this.filePath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`research session write skipped: ${reason}`);
    }
  }
}

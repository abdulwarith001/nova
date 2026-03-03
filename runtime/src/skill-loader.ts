/**
 * skill-loader.ts — Lazy skill discovery and loading.
 *
 * At startup: scans SKILL.md headers to build a lightweight index.
 * On demand: loads full tool definitions when the agent requests a skill.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SkillManifest {
  name: string;
  description: string;
  capabilities: string[];
  envRequired: string[];
  toolCount: number;
  path: string;
}

export interface SkillToolDefinition {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  permissions: string[];
  execute: (params: any) => Promise<unknown>;
}

// ── Skill Loader ────────────────────────────────────────────────────────────

export class SkillLoader {
  private index: SkillManifest[] = [];
  private loaded: Map<string, SkillToolDefinition[]> = new Map();

  /**
   * Build the skill index by scanning directories for SKILL.md files.
   * Only reads manifest metadata — does NOT load tool code.
   */
  buildIndex(dirs: string[]): SkillManifest[] {
    this.index = [];

    for (const dir of dirs) {
      if (!existsSync(dir)) continue;

      const entries = readdirSync(dir);
      for (const entry of entries) {
        const skillDir = join(dir, entry);
        if (!statSync(skillDir).isDirectory()) continue;

        const manifestPath = join(skillDir, "SKILL.md");
        if (!existsSync(manifestPath)) continue;

        const manifest = this.parseSkillManifest(manifestPath, skillDir);
        if (manifest) {
          this.index.push(manifest);
        }
      }
    }

    return this.index;
  }

  /**
   * Parse a SKILL.md file into a SkillManifest.
   *
   * Expected format:
   * ---
   * name: google-workspace
   * description: Google Workspace integration
   * capabilities: send email, read email, manage calendar, access Drive
   * env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
   * tools: 14
   * ---
   */
  private parseSkillManifest(
    manifestPath: string,
    skillDir: string,
  ): SkillManifest | null {
    const content = readFileSync(manifestPath, "utf-8");

    // Parse YAML-like frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      // Try key-value format in body
      return this.parseBodyFormat(content, skillDir);
    }

    const frontmatter = frontmatterMatch[1];
    const fields = new Map<string, string>();

    for (const line of frontmatter.split("\n")) {
      const kvMatch = line.match(/^(.+?):\s*(.+)$/);
      if (kvMatch) {
        fields.set(kvMatch[1].trim().toLowerCase(), kvMatch[2].trim());
      }
    }

    const name = fields.get("name");
    if (!name) return null;

    return {
      name,
      description: fields.get("description") || "",
      capabilities: (fields.get("capabilities") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      envRequired: (fields.get("env") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      toolCount: parseInt(fields.get("tools") || "0", 10) || 0,
      path: skillDir,
    };
  }

  /**
   * Fallback parser for SKILL.md files using list format.
   */
  private parseBodyFormat(
    content: string,
    skillDir: string,
  ): SkillManifest | null {
    const fields = new Map<string, string>();

    for (const line of content.split("\n")) {
      const kvMatch = line.match(/^-\s+(.+?):\s+(.+)$/);
      if (kvMatch) {
        fields.set(kvMatch[1].trim().toLowerCase(), kvMatch[2].trim());
      }
    }

    const name = fields.get("name");
    if (!name) return null;

    return {
      name,
      description: fields.get("description") || "",
      capabilities: (fields.get("capabilities") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      envRequired: (fields.get("env") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      toolCount: parseInt(fields.get("tools") || "0", 10) || 0,
      path: skillDir,
    };
  }

  /**
   * Load a skill's tool definitions by name.
   * Dynamically imports the skill's tools.ts/tools.js module.
   */
  async loadSkill(name: string): Promise<SkillToolDefinition[]> {
    // Return cached if already loaded
    if (this.loaded.has(name)) {
      return this.loaded.get(name)!;
    }

    const manifest = this.index.find((s) => s.name === name);
    if (!manifest) {
      throw new Error(`Skill "${name}" not found in index`);
    }

    // Try .ts first (tsx runtime) then .js (compiled)
    const tsPath = join(manifest.path, "tools.ts");
    const jsPath = join(manifest.path, "tools.js");
    const toolsPath = existsSync(tsPath)
      ? tsPath
      : existsSync(jsPath)
        ? jsPath
        : null;

    if (!toolsPath) {
      throw new Error(
        `Skill "${name}" has no tools module at ${manifest.path}`,
      );
    }

    try {
      const module = await import(toolsPath);
      const tools: SkillToolDefinition[] = module.default || module.tools || [];
      this.loaded.set(name, tools);
      return tools;
    } catch (err: any) {
      throw new Error(`Failed to load skill "${name}": ${err.message}`);
    }
  }

  /**
   * Search the index for skills matching a capability keyword.
   */
  searchSkills(query: string): SkillManifest[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    return this.index
      .map((skill) => {
        const haystack = [skill.name, skill.description, ...skill.capabilities]
          .join(" ")
          .toLowerCase();

        const score = queryWords.reduce(
          (total, word) => total + (haystack.includes(word) ? 1 : 0),
          0,
        );

        return { skill, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.skill);
  }

  /**
   * Get a lightweight summary of all skills for injection into the system prompt.
   */
  getIndexSummary(): string {
    if (this.index.length === 0) {
      return "No skills available.";
    }

    const lines = this.index.map((skill) => {
      const caps = skill.capabilities.slice(0, 4).join(", ");
      return `- ${skill.name}: ${skill.description} (${skill.toolCount} tools: ${caps})`;
    });

    return [
      "=== AVAILABLE SKILLS ===",
      ...lines,
      "",
      "=== WEB INTERACTION RULES ===",
      "• browse = READ-ONLY (screenshot + text extraction). CANNOT click, fill, or submit.",
      "• To click buttons, fill forms, submit, log in, or interact with a page, use this flow:",
      "  1. web_session_start(startUrl: url) → opens browser",
      "  2. web_observe() → see page elements",
      '  3. web_act(type: "fill", target: { text: "Email" }, value: "user@test.com")',
      '  4. web_act(type: "click", target: { text: "Submit" })',
      "  5. web_session_end() → close browser",
      "• NEVER say you cannot interact with a page. Use the session tools above.",
      "",
      "=== AGENTIC BEHAVIOR ===",
      "• When a tool fails or returns empty/insufficient results, IMMEDIATELY try an alternative tool in the SAME turn. Do NOT ask the user what to do.",
      "• Fallback chain: scrape fails → try browse. web_search gives poor results → try browse on the URL directly. browse fails → try scrape.",
      "• Always exhaust at least 2 different tools before responding with incomplete information.",
      "• NEVER say 'I can try...' or 'Would you like me to...' — just do it.",
      "",
      "=== TASK RULES ===",
      "CRITICAL: When the user mentions ANY time-related action, USE THE TASK TOOLS IMMEDIATELY. Do NOT do the task yourself — schedule it.",
      "",
      "TRIGGER PHRASES → ACTIONS:",
      "• 'remind me in X min/hours' → task_create(kind: 'reminder', delayMinutes: X)",
      "• 'remind me at 9 AM' → task_create(kind: 'reminder', triggerAt: '<today or tomorrow>T09:00:00')",
      "• 'every day at 7 AM' → task_create(kind: 'recurring', triggerAt: '<next 7AM>T07:00:00', schedule: '24h')",
      "• 'in X minutes, do Y' → task_create(kind: 'task', action: 'Y', delayMinutes: X). NEVER do Y immediately — always schedule it.",
      "",
      "TIME PARAMETERS (use ONE):",
      "• triggerAt: ISO 8601 datetime for specific times (e.g. '2026-03-04T09:00:00'). Use the timezone from your system prompt date/time.",
      "• delayMinutes: minutes from now for relative delays (5 min = 5, 1 hour = 60, 1 day = 1440). NEVER pass milliseconds.",
      "• If the user does NOT specify a time, ASK once. Never guess.",
      "",
      "MODIFYING/DELETING:",
      "• 'update/change that to X', 'make it every X' → call task_list FIRST to get IDs, then task_update. NEVER ask which tool to use — just do it.",
      "• When updating a task, update BOTH message AND action together so they stay in sync.",
      "• To cancel or delete: call task_list FIRST, then task_cancel with the correct ID.",
      "• NEVER create a duplicate — use task_update to modify existing items.",
      "",
      "BE DECISIVE:",
      "• When you have enough info, CREATE the task immediately. Don't ask 'would you like me to...' — just do it.",
      "• Keep confirmations to ONE short sentence: 'Done! I'll remind you at 9 AM daily.'",
      "",
      "=== IMAGE RULES ===",
      "• When the user asks to create/draw/generate an image, use generate_image immediately with a detailed prompt.",
      "• The image will be sent to the user automatically — just confirm what you created.",
      "• When the user sends you a photo, you can see and analyze it. Describe what you see or answer questions about it.",
      "• You can understand images sent to you (screenshots, photos, documents, etc).",
      "• When the user asks for a SCREENSHOT of a website, use browse(url, sendScreenshot: true). The screenshot will be sent automatically.",
      "• Do NOT set sendScreenshot: true unless the user explicitly asks for a screenshot.",
      "",
      "If you need a capability, search your skills. Don't guess — request the skill by name.",
    ].join("\n");
  }

  /**
   * Get the full index.
   */
  getIndex(): SkillManifest[] {
    return [...this.index];
  }

  /**
   * Get default skill directories to scan.
   */
  static getDefaultDirs(projectRoot?: string): string[] {
    const dirs: string[] = [];

    // Project-level core skills
    if (projectRoot) {
      dirs.push(join(projectRoot, "skills", "core"));
    }

    // User-installed skills
    dirs.push(join(homedir(), ".nova", "skills"));

    return dirs;
  }
}

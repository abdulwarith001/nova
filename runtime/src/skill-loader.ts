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
  private scanDirs: string[] = [];

  /**
   * Set the search directories and build the initial index.
   */
  init(dirs: string[]): SkillManifest[] {
    this.scanDirs = [...new Set(dirs)];
    return this.refreshIndex();
  }

  /**
   * Build the skill index by scanning directories for SKILL.md files.
   * @deprecated Use init() and refreshIndex() instead.
   */
  buildIndex(dirs: string[]): SkillManifest[] {
    return this.init(dirs);
  }

  /**
   * Re-scan the registered directories to update the skill index.
   */
  refreshIndex(): SkillManifest[] {
    this.index = [];

    for (const dir of this.scanDirs) {
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
   * Automatically discover and add new skill directories.
   * Searches in common locations like ~/.nova/skills.
   */
  discoverSkills(): SkillManifest[] {
    const defaultDirs = SkillLoader.getDefaultDirs();
    for (const dir of defaultDirs) {
      if (!this.scanDirs.includes(dir)) {
        this.scanDirs.push(dir);
      }
    }
    return this.refreshIndex();
  }

  /**
   * Parse a SKILL.md file into a SkillManifest.
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
   * Search the index for skills matching a keyword.
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
   * Get a lightweight summary of all skills.
   */
  getIndexSummary(): string {
    if (this.index.length === 0) {
      return "No skills available.";
    }

    const lines = this.index.map((skill) => {
      const caps = skill.capabilities.slice(0, 4).join(", ");
      return `- ${skill.name}: ${skill.description} (${skill.toolCount} tools: ${caps})`;
    });

    return ["=== AVAILABLE SKILLS ===", ...lines].join("\n");
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

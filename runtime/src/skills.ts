import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import matter from "gray-matter";

export interface Skill {
  name: string;
  description: string;
  category: string;
  keywords: string[];
  content: string; // Full markdown content
  path: string; // Path to SKILL.md
}

/**
 * Manages loading and querying skills from the skills directory
 */
export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private skillsPath: string;

  constructor(skillsPath: string) {
    this.skillsPath = skillsPath;
    this.loadSkills();
  }

  /**
   * Load all skills from directories
   */
  private loadSkills(): void {
    if (!existsSync(this.skillsPath)) {
      console.warn(`Skills directory not found: ${this.skillsPath}`);
      return;
    }

    // Check core and community skill directories
    const corePath = join(this.skillsPath, "core");
    const communityPath = join(this.skillsPath, "community");

    if (existsSync(corePath)) {
      this.loadSkillsFromDirectory(corePath);
    }

    if (existsSync(communityPath)) {
      this.loadSkillsFromDirectory(communityPath);
    }

    console.log(`📚 Loaded ${this.skills.size} skill(s)`);
  }

  /**
   * Load skills from a specific directory
   */
  private loadSkillsFromDirectory(directory: string): void {
    try {
      const dirs = readdirSync(directory, { withFileTypes: true });

      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;

        const skillPath = join(directory, dir.name, "SKILL.md");
        if (existsSync(skillPath)) {
          try {
            const skill = this.loadSkill(skillPath);
            this.skills.set(skill.name.toLowerCase(), skill);
          } catch (error) {
            console.error(`Failed to load skill at ${skillPath}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to read skills directory ${directory}:`, error);
    }
  }

  /**
   * Load a single skill from SKILL.md file
   */
  private loadSkill(path: string): Skill {
    const content = readFileSync(path, "utf-8");
    const { data, content: markdown } = matter(content);

    return {
      name: data.name || "Unnamed Skill",
      description: data.description || "",
      category: data.category || "other",
      keywords: data.keywords || [],
      content: markdown,
      path,
    };
  }

  /**
   * Get all loaded skills
   */
  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skill by name (case-insensitive)
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name.toLowerCase());
  }

  /**
   * Search skills by keyword
   */
  searchSkills(query: string): Skill[] {
    const queryLower = query.toLowerCase();
    return this.getAllSkills().filter((skill) => {
      return (
        skill.name.toLowerCase().includes(queryLower) ||
        skill.description.toLowerCase().includes(queryLower) ||
        skill.keywords.some((k) => k.toLowerCase().includes(queryLower))
      );
    });
  }

  /**
   * Get skills by category
   */
  getSkillsByCategory(category: string): Skill[] {
    return this.getAllSkills().filter((skill) => skill.category === category);
  }

  /**
   * Get relevant skills for a task
   */
  getRelevantSkills(task: string, maxSkills: number = 3): Skill[] {
    const taskLower = task.toLowerCase();
    const scored = this.getAllSkills().map((skill) => {
      let score = 0;

      // Check keywords
      for (const keyword of skill.keywords) {
        if (taskLower.includes(keyword.toLowerCase())) {
          score += 5;
        }
      }

      // Check name
      if (taskLower.includes(skill.name.toLowerCase())) {
        score += 10;
      }

      // Check description
      const descWords = skill.description.toLowerCase().split(/\s+/);
      for (const word of descWords) {
        if (word.length > 3 && taskLower.includes(word)) {
          score += 2;
        }
      }

      return { skill, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSkills)
      .map((s) => s.skill);
  }

  /**
   * Generate context prompt from relevant skills
   */
  buildSkillContext(task: string): string {
    const skills = this.getRelevantSkills(task);

    if (skills.length === 0) {
      return "";
    }

    let context = "\n\n## Available Skills\n\n";
    context += "You have access to the following specialized skills:\n\n";

    for (const skill of skills) {
      context += `### ${skill.name}\n`;
      context += `${skill.description}\n\n`;
      context += `Keywords: ${skill.keywords.join(", ")}\n\n`;
    }

    return context;
  }
}

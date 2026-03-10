import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface SkillProposal {
  name: string;
  description: string;
  capabilities: string[];
  tools: Array<{
    name: string;
    description: string;
    parametersSchema: Record<string, unknown>;
    code: string; // The implementation logic as a string
  }>;
}

/**
 * SkillBuilder — Generates and persists new skills to disk.
 */
export class SkillBuilder {
  private readonly userSkillDir: string;

  constructor(userSkillDir?: string) {
    this.userSkillDir = userSkillDir || join(homedir(), ".nova", "skills");
    if (!existsSync(this.userSkillDir)) {
      mkdirSync(this.userSkillDir, { recursive: true });
    }
  }

  /**
   * Build and persist a new skill from a proposal.
   */
  async buildSkill(proposal: SkillProposal): Promise<{ path: string }> {
    const skillPath = join(this.userSkillDir, proposal.name);
    if (!existsSync(skillPath)) {
      mkdirSync(skillPath, { recursive: true });
    }

    // 1. Generate SKILL.md
    const manifestContent = this.generateManifest(proposal);
    writeFileSync(join(skillPath, "SKILL.md"), manifestContent);

    // 2. Generate tools.ts
    const toolsContent = this.generateToolsTs(proposal);
    writeFileSync(join(skillPath, "tools.ts"), toolsContent);

    return { path: skillPath };
  }

  private generateManifest(proposal: SkillProposal): string {
    return [
      "---",
      `name: ${proposal.name}`,
      `description: ${proposal.description}`,
      `capabilities: ${proposal.capabilities.join(", ")}`,
      `tools: ${proposal.tools.length}`,
      "---",
      "",
      `# ${proposal.name}`,
      "",
      proposal.description,
      "",
      "## Capabilities",
      ...proposal.capabilities.map((c) => `- ${c}`),
    ].join("\n");
  }

  private generateToolsTs(proposal: SkillProposal): string {
    const toolDefs = proposal.tools.map((t) => {
      if (!t.name || !t.code) {
        throw new Error(
          `Tool implementation for "${t.name || "unknown"}" is missing required 'code' or 'name'.`,
        );
      }

      const schemaStr = JSON.stringify(
        t.parametersSchema || {},
        null,
        2,
      ).replace(/\n/g, "\n    ");
      const codeStr = t.code.replace(/\n/g, "\n      ");

      return [
        "  {",
        `    name: "${t.name}",`,
        `    description: "${t.description || ""}",`,
        `    parametersSchema: ${schemaStr},`,
        "    permissions: [],",
        `    execute: async (params) => {`,
        `      ${codeStr}`,
        "    },",
        "  },",
      ].join("\n");
    });

    return [
      'import { SkillToolDefinition } from "../../runtime/src/skill-loader.js";',
      "",
      "export const tools: SkillToolDefinition[] = [",
      ...toolDefs,
      "];",
      "",
      "export default tools;",
    ].join("\n");
  }
}

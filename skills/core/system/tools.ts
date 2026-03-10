/**
 * system/tools.ts — Agent-facing tools for meta-operations.
 *
 * Tools: skill_create, skill_refresh
 */

import {
  SkillBuilder,
  SkillProposal,
} from "../../../runtime/src/skill-builder.js";
import { SkillLoader } from "../../../runtime/src/skill-loader.js";

export function registerSystemTools(
  registry: { register(tool: any): void },
  builder: SkillBuilder,
  loader: SkillLoader,
): void {
  // ── skill_create ───────────────────────────────────────────────────

  registry.register({
    name: "skill_create",
    description:
      "Create a new skill for yourself. Use this when you need a capability you don't currently have. You will provide a proposal with tool names, descriptions, and TypeScript implementation code. This will be persisted to your user-installed skills directory. ALWAYS explain why you are creating a new skill to the user first.",
    category: "system",
    parametersSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the skill (kebab-case)" },
        description: { type: "string", description: "What the skill does" },
        capabilities: {
          type: "array",
          items: { type: "string" },
          description: "List of capabilities provided",
        },
        tools: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              parametersSchema: { type: "object" },
              code: {
                type: "string",
                description:
                  "TypeScript implementation of the execute function body",
              },
            },
            required: ["name", "description", "parametersSchema", "code"],
          },
        },
      },
      required: ["name", "description", "capabilities", "tools"],
    },
    permissions: ["system", "file_write"],
    execute: async (params: SkillProposal) => {
      const result = await builder.buildSkill(params);
      // Refresh the loader index immediately so the new skill is visible
      loader.refreshIndex();
      return {
        success: true,
        message: `Skill "${params.name}" created successfully at ${result.path}`,
        path: result.path,
      };
    },
  });

  // ── skill_refresh ──────────────────────────────────────────────────

  registry.register({
    name: "skill_refresh",
    description:
      "Re-scan your skill directories for any changes or newly added skills. Use this if you've manually added a skill or if you think your index is out of date.",
    category: "system",
    parametersSchema: { type: "object", properties: {} },
    permissions: ["system"],
    execute: async () => {
      const index = loader.refreshIndex();
      return {
        success: true,
        count: index.length,
        skills: index.map((s) => s.name),
      };
    },
  });
}

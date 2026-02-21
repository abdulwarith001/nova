/**
 * sub-agent.ts — Multi-agent sub-spawning system.
 *
 * Allows the master agent to delegate complex tasks to specialized sub-agents,
 * each with scoped tools, focused prompts, and independent conversation contexts.
 */

import { Agent, type Message } from "./index.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SubAgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  tools: string[];
  maxIterations: number;
}

export interface SubTask {
  agentType: string;
  description: string;
  context?: string;
}

export interface SubAgentResult {
  agentName: string;
  agentType: string;
  task: string;
  result: string;
  success: boolean;
  durationMs: number;
}

export interface DelegationPlan {
  shouldDelegate: boolean;
  subTasks: SubTask[];
  confidence: number;
  reasoning?: string;
}

// ── Predefined Agent Types ──────────────────────────────────────────────────

const AGENT_TYPES: Record<string, Omit<SubAgentConfig, "name">> = {
  researcher: {
    role: "Web research and fact gathering",
    systemPrompt: [
      "You are a research specialist. Your job is to find and verify information.",
      "Be thorough but concise. Focus on facts with sources.",
      "Return your findings in clear, structured prose.",
      "Always include the source URL when citing information.",
    ].join("\n"),
    tools: ["web_search", "browse", "scrape", "curl"],
    maxIterations: 5,
  },
  coder: {
    role: "Code writing and file creation",
    systemPrompt: [
      "You are a coding specialist. Your job is to write clean, working code.",
      "Follow best practices and add comments for complex logic.",
      "Create files and run tests when appropriate.",
      "Keep your output focused — return the code and a brief explanation.",
    ].join("\n"),
    tools: ["read", "write", "bash"],
    maxIterations: 5,
  },
  communicator: {
    role: "Email drafting and messaging",
    systemPrompt: [
      "You are a communication specialist. Your job is to draft professional messages.",
      "Match the tone to the context — formal for business, warm for personal.",
      "Keep messages concise and actionable.",
      "Always confirm the recipient and subject before sending.",
    ].join("\n"),
    tools: ["gmail_send", "gmail_reply", "gmail_draft"],
    maxIterations: 3,
  },
  analyst: {
    role: "Data analysis and summarization",
    systemPrompt: [
      "You are a data analysis specialist. Your job is to analyze information and produce insights.",
      "Look for patterns, trends, and actionable conclusions.",
      "Present findings in clear, concise summaries.",
      "Use data to support every claim.",
    ].join("\n"),
    tools: ["read", "bash"],
    maxIterations: 5,
  },
};

// ── Sub-Agent Manager ───────────────────────────────────────────────────────

export class SubAgentManager {
  private readonly agentConfig: {
    provider: "openai" | "anthropic";
    model: string;
    apiKey?: string;
  };

  constructor(agentConfig: {
    provider: "openai" | "anthropic";
    model: string;
    apiKey?: string;
  }) {
    this.agentConfig = agentConfig;
  }

  /**
   * Get available sub-agent types and their descriptions.
   */
  getAvailableTypes(): Array<{ type: string; role: string; tools: string[] }> {
    return Object.entries(AGENT_TYPES).map(([type, config]) => ({
      type,
      role: config.role,
      tools: config.tools,
    }));
  }

  /**
   * Spawn a sub-agent and run a task.
   */
  async runSubAgent(
    subTask: SubTask,
    toolExecutor?: (
      name: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>,
  ): Promise<SubAgentResult> {
    const startTime = Date.now();
    const agentType = subTask.agentType;
    const typeConfig = AGENT_TYPES[agentType];

    if (!typeConfig) {
      return {
        agentName: `${agentType}-agent`,
        agentType,
        task: subTask.description,
        result: `Unknown agent type: ${agentType}`,
        success: false,
        durationMs: Date.now() - startTime,
      };
    }

    // Create a scoped agent with role-specific system prompt
    const systemPrompt = [
      typeConfig.systemPrompt,
      "",
      subTask.context ? `Context: ${subTask.context}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const subAgent = new Agent(this.agentConfig, systemPrompt);

    try {
      // Run the sub-agent's task
      const response = await subAgent.chat(subTask.description, []);

      return {
        agentName: `${agentType}-agent`,
        agentType,
        task: subTask.description,
        result: response,
        success: true,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        agentName: `${agentType}-agent`,
        agentType,
        task: subTask.description,
        result: `Sub-agent error: ${error.message}`,
        success: false,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Run multiple sub-agents in parallel.
   */
  async runParallel(
    subTasks: SubTask[],
    toolExecutor?: (
      name: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>,
  ): Promise<SubAgentResult[]> {
    const promises = subTasks.map((task) =>
      this.runSubAgent(task, toolExecutor),
    );
    return await Promise.all(promises);
  }

  /**
   * Run sub-agents sequentially, passing results forward.
   */
  async runSequential(
    subTasks: SubTask[],
    toolExecutor?: (
      name: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>,
  ): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    let previousContext = "";

    for (const task of subTasks) {
      // Pass previous results as context to the next agent
      const enrichedTask: SubTask = {
        ...task,
        context: [task.context, previousContext].filter(Boolean).join("\n\n"),
      };

      const result = await this.runSubAgent(enrichedTask, toolExecutor);
      results.push(result);

      if (result.success) {
        previousContext = `Previous agent (${result.agentType}) result:\n${result.result}`;
      }
    }

    return results;
  }

  /**
   * Synthesize results from multiple sub-agents into a final summary.
   */
  async synthesize(
    originalTask: string,
    results: SubAgentResult[],
  ): Promise<string> {
    const synthesizer = new Agent(
      this.agentConfig,
      [
        "You are synthesizing results from multiple specialist agents into a coherent final response.",
        "Combine the insights naturally. Don't list agent names — just present the unified answer.",
        "Be concise and direct.",
      ].join("\n"),
    );

    const resultsSummary = results
      .map(
        (r) =>
          `[${r.agentType}] ${r.success ? "✓" : "✗"} ${r.result.slice(0, 1000)}`,
      )
      .join("\n\n");

    return await synthesizer.chat(
      `Original task: ${originalTask}\n\nAgent results:\n${resultsSummary}\n\nSynthesize a final response.`,
      [],
    );
  }
}

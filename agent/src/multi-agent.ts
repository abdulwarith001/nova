import { AutonomousAgent, AutonomousAgentConfig } from "./autonomous.js";
import type { Runtime } from "../../runtime/src/index.js";

/**
 * Agent specialization types
 */
export type AgentRole =
  | "researcher"
  | "coder"
  | "analyst"
  | "coordinator"
  | "reminder";

/**
 * Message between agents
 */
export interface AgentMessage {
  from: AgentRole;
  to: AgentRole;
  type: "task" | "result" | "question" | "status";
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Task delegation
 */
export interface DelegatedTask {
  id: string;
  assignedTo: AgentRole;
  description: string;
  context?: string;
  status: "pending" | "in-progress" | "completed" | "failed";
  result?: string;
  error?: string;
}

/**
 * Specialized agent with a specific role
 */
export class SpecializedAgent extends AutonomousAgent {
  private role: AgentRole;
  private specialization: string;

  constructor(
    runtime: Runtime,
    role: AgentRole,
    config: Omit<AutonomousAgentConfig, "systemPrompt">,
  ) {
    const systemPrompt = SpecializedAgent.getSystemPrompt(role);
    const specialization = SpecializedAgent.getSpecialization(role);

    super(runtime, {
      ...config,
      systemPrompt,
    });

    this.role = role;
    this.specialization = specialization;
  }

  /**
   * Get specialized system prompt for role
   */
  private static getSystemPrompt(role: AgentRole): string {
    const basePrompt = `You are Nova, an AI super agent specialized as a `;

    const prompts: Record<AgentRole, string> = {
      researcher: `${basePrompt}RESEARCHER.

Your expertise:
- Web scraping and data extraction
- Finding information across multiple sources
- Analyzing and synthesizing research
- Verifying facts and sources

Available tools:
- browser_navigate: Navigate to URLs
- browser_extract: Extract content from pages
- browser_screenshot: Capture screenshots
- bash: Execute commands for data processing
- read/write: Manage research files

Your approach:
1. Identify information needs
2. Search multiple sources
3. Extract relevant data
4. Verify accuracy
5. Synthesize findings
6. Document sources

Be thorough and cite your sources.`,

      coder: `${basePrompt}CODER.

Your expertise:
- Writing clean, efficient code
- File operations and project structure
- Code analysis and refactoring
- Testing and validation

Available tools:
- read: Read code files
- write: Create/modify files
- bash: Run code, tests, builds

Your approach:
1. Understand requirements
2. Design solution architecture
3. Write clean, tested code
4. Follow best practices
5. Document your work
6. Verify functionality

Write production-quality code with proper error handling.`,

      analyst: `${basePrompt}ANALYST.

Your expertise:
- Data processing and analysis
- Pattern recognition
- Statistical analysis
- Report generation

Available tools:
- read: Process data files
- bash: Run analysis scripts
- write: Generate reports

Your approach:
1. Understand data and questions
2. Clean and prepare data
3. Apply analytical methods
4. Identify patterns and insights
5. Generate clear visualizations
6. Write actionable reports

Provide data-driven insights with clear recommendations.`,

      coordinator: `${basePrompt}COORDINATOR.

Your expertise:
- Breaking down complex tasks
- Delegating to specialized agents
- Coordinating workflows
- Synthesizing results

You work with:
- Researcher: Web scraping, data gathering
- Coder: File operations, coding tasks
- Analyst: Data processing, insights

Your role:
- Analyze user requests
- Identify required expertise
- Delegate to specialists
- Coordinate execution
- Integrate results
- Deliver complete solutions`,
      reminder: `${basePrompt}REMINDER AGENT.

You only execute reminder tasks when they are due. You do NOT ask follow-up questions.
You will receive a JSON task payload in the user message. Parse it carefully.

Task payload shape:
{
  "taskType": "reminder" | "research",
  "message"?: string,
  "query"?: string,
  "recipientEmail": string,
  "subject"?: string,
  "instructions"?: string
}

Rules:
1. If taskType is "research":
   - Use the browser_search tool with the provided query.
   - Summarize the results into a short paragraph (4-6 sentences).
   - Include a "Sources" section with bullet URLs or titles.
   - Send the email using email_send to recipientEmail.
2. If taskType is "reminder":
   - Send a reminder email to recipientEmail with the message.
   - Use subject if provided, otherwise "Nova Reminder".
3. Do not invent emails or queries. If required fields are missing, respond with a clear error.

Always send the email using email_send, not by printing the content.`,
    };

    return prompts[role];
  }

  /**
   * Get specialization description
   */
  private static getSpecialization(role: AgentRole): string {
    const specializations: Record<AgentRole, string> = {
      researcher: "Web scraping and information gathering",
      coder: "Code writing and file operations",
      analyst: "Data analysis and reporting",
      coordinator: "Task coordination and delegation",
      reminder: "Reminder execution and research email delivery",
    };
    return specializations[role];
  }

  /**
   * Get agent role
   */
  getRole(): AgentRole {
    return this.role;
  }

  /**
   * Get specialization
   */
  getSpecialization(): string {
    return this.specialization;
  }
}

/**
 * Multi-agent orchestrator
 */
export class AgentOrchestrator {
  private runtime: Runtime;
  private agents: Map<AgentRole, SpecializedAgent> = new Map();
  private messages: AgentMessage[] = [];
  private tasks: Map<string, DelegatedTask> = new Map();
  private config: AutonomousAgentConfig;

  constructor(runtime: Runtime, config: AutonomousAgentConfig) {
    this.runtime = runtime;
    this.config = config;

    // Initialize specialized agents
    this.initializeAgents();
  }

  /**
   * Initialize all specialized agents
   */
  private initializeAgents(): void {
    const roles: AgentRole[] = ["researcher", "coder", "analyst", "reminder"];

    for (const role of roles) {
      const roleConfig =
        role === "reminder"
          ? {
              ...this.config,
              allowedTools: ["browser_search", "email_send"],
              toolLimits: { browser_search: 1, email_send: 1 },
            }
          : this.config;
      const agent = new SpecializedAgent(this.runtime, role, roleConfig);
      this.agents.set(role, agent);
    }

    console.log(`\n🎭 Initialized ${roles.length} specialized agents:`);
    for (const [role, agent] of this.agents.entries()) {
      console.log(`   - ${role.toUpperCase()}: ${agent.getSpecialization()}`);
    }
  }

  /**
   * Execute a complex task using multiple agents
   */
  async executeCollaborative(userTask: string): Promise<string> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎭 Multi-Agent Orchestrator`);
    console.log(`📋 Task: "${userTask}"`);
    console.log(`${"=".repeat(60)}\n`);

    // Step 1: Analyze task and determine required agents
    const plan = await this.planExecution(userTask);

    console.log(`📝 Execution Plan:`);
    console.log(`   Agents assigned: ${plan.size}`);
    for (const [role, subtask] of plan.entries()) {
      console.log(`   - ${role.toUpperCase()}: ${subtask.substring(0, 60)}...`);
    }
    console.log();

    // Step 2: Execute tasks in parallel or sequence
    const results: Map<AgentRole, string> = new Map();

    for (const [role, subtask] of plan.entries()) {
      console.log(`\n${"─".repeat(60)}`);
      console.log(`🤖 ${role.toUpperCase()} Agent Starting...`);
      console.log(`${"─".repeat(60)}`);

      const agent = this.agents.get(role);
      if (!agent) {
        console.error(`   ❌ Agent not found: ${role}`);
        continue;
      }

      try {
        const result = await agent.execute(subtask);
        results.set(role, result);
        console.log(`\n✅ ${role.toUpperCase()} completed successfully`);
      } catch (error) {
        console.error(`\n❌ ${role.toUpperCase()} failed:`, error);
        results.set(role, `Failed: ${error}`);
      }
    }

    // Step 3: Synthesize results
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🔄 Synthesizing results from ${results.size} agent(s)...`);
    console.log(`${"=".repeat(60)}\n`);

    const finalResult = await this.synthesizeResults(userTask, results);

    console.log(`\n✅ Collaborative task complete!`);
    console.log(`${"=".repeat(60)}\n`);

    return finalResult;
  }

  /**
   * Plan task execution and delegate to agents
   */
  private async planExecution(task: string): Promise<Map<AgentRole, string>> {
    const plan = new Map<AgentRole, string>();
    const taskLower = task.toLowerCase();

    // Research-related keywords
    if (
      taskLower.includes("research") ||
      taskLower.includes("find") ||
      taskLower.includes("search") ||
      taskLower.includes("web") ||
      taskLower.includes("scrape") ||
      taskLower.includes("information") ||
      taskLower.includes("gather")
    ) {
      plan.set("researcher", `Research and gather information: ${task}`);
    }

    // Code-related keywords
    if (
      taskLower.includes("code") ||
      taskLower.includes("file") ||
      taskLower.includes("create") ||
      taskLower.includes("write") ||
      taskLower.includes("implement") ||
      taskLower.includes("build") ||
      taskLower.includes("develop")
    ) {
      plan.set("coder", `Implement and create: ${task}`);
    }

    // Analysis-related keywords
    if (
      taskLower.includes("analyze") ||
      taskLower.includes("report") ||
      taskLower.includes("summary") ||
      taskLower.includes("insights") ||
      taskLower.includes("data") ||
      taskLower.includes("compare") ||
      taskLower.includes("evaluate")
    ) {
      plan.set("analyst", `Analyze and report: ${task}`);
    }

    // Default: use coder for general tasks
    if (plan.size === 0) {
      plan.set("coder", task);
    }

    return plan;
  }

  /**
   * Synthesize results from multiple agents
   */
  private async synthesizeResults(
    originalTask: string,
    results: Map<AgentRole, string>,
  ): Promise<string> {
    const parts: string[] = [];

    parts.push(`# Multi-Agent Collaborative Results\n`);
    parts.push(`**Original Task**: ${originalTask}\n`);
    parts.push(`**Agents Involved**: ${results.size}\n`);
    parts.push(`---\n`);

    for (const [role, result] of results.entries()) {
      parts.push(
        `## ${role.charAt(0).toUpperCase() + role.slice(1)} Agent Results\n`,
      );
      parts.push(result);
      parts.push(`\n---\n`);
    }

    parts.push(`\n**Collaboration Summary**:`);
    parts.push(
      `This task was completed collaboratively by ${results.size} specialized agent(s).`,
    );
    parts.push(
      `Each agent contributed their unique expertise to deliver a comprehensive solution.\n`,
    );

    return parts.join("\n");
  }

  /**
   * Send message between agents
   */
  async sendMessage(message: AgentMessage): Promise<void> {
    this.messages.push(message);
    console.log(`\n📨 Message: ${message.from} → ${message.to}`);
    console.log(`   Type: ${message.type}`);
    console.log(`   Content: ${message.content.substring(0, 100)}...`);
  }

  /**
   * Get agent by role
   */
  getAgent(role: AgentRole): SpecializedAgent | undefined {
    return this.agents.get(role);
  }

  /**
   * Get all messages
   */
  getMessages(): AgentMessage[] {
    return [...this.messages];
  }

  /**
   * Get message history for agent
   */
  getMessagesForAgent(role: AgentRole): AgentMessage[] {
    return this.messages.filter((m) => m.to === role || m.from === role);
  }

  /**
   * Get execution statistics
   */
  getStats() {
    return {
      agentCount: this.agents.size,
      messageCount: this.messages.length,
      taskCount: this.tasks.size,
      agents: Array.from(this.agents.keys()),
    };
  }
}

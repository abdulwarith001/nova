import type { Task } from "./index.js";
import type { ExecutionPlan, ExecutionStep } from "./executor.js";

/**
 * Planner for multi-step task decomposition and dependency detection
 */
export class Planner {
  constructor(private readonly llmChat?: (prompt: string) => Promise<string>) {}

  /**
   * Plan the execution of a task
   */
  async plan(task: Task): Promise<ExecutionPlan> {
    const steps: ExecutionStep[] = task.toolCalls.map((call, index) => ({
      id: `step-${index}`,
      toolName: call.toolName,
      parameters: call.parameters,
      dependencies: [],
    }));

    if (!this.llmChat) {
      return { taskId: task.id, steps };
    }

    try {
      // 1. Prepare steps description for LLM
      const stepsText = steps
        .map(
          (s) => `Step ${s.id}: ${s.toolName}(${JSON.stringify(s.parameters)})`,
        )
        .join("\n");

      // 2. Draft prompt (using a local prompt if shared one isn't imported)
      const prompt = `Analyze the following sequence of tool calls for a task. 
Identify logical dependencies where a step requires information or a state created by a previous step.
Consider parameter values (look for placeholders like {{step-N.result}}), tool descriptions, and the overall task goal.

Task Goal: ${task.description}
Steps:
${stepsText}

Output a JSON array of dependencies. Each entry should be: { "stepId": string, "dependsOn": string[] }.
Only include steps that have dependencies. If no dependencies exist, return an empty array [].
Respond ONLY with the JSON array.`;

      const response = await this.llmChat(prompt);
      const dependencies = this.parseDependencies(response);

      // 3. Apply dependencies to steps
      for (const dep of dependencies) {
        const step = steps.find((s) => s.id === dep.stepId);
        if (step) {
          step.dependencies = dep.dependsOn;
        }
      }
    } catch (error) {
      console.warn(
        `⚠️ Planner failed to detect dependencies: ${error}. Proceeding with sequential fallback.`,
      );
      // If LLM fails, we could default to sequential: step-N depends on step-(N-1)
      for (let i = 1; i < steps.length; i++) {
        steps[i].dependencies = [`step-${i - 1}`];
      }
    }

    return {
      taskId: task.id,
      steps,
    };
  }

  private parseDependencies(
    response: string,
  ): Array<{ stepId: string; dependsOn: string[] }> {
    try {
      // Basic JSON extraction from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(response);
    } catch {
      return [];
    }
  }
}

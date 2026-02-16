import type { Task } from "./index";
import type { ExecutionPlan, ExecutionStep } from "./executor";

/**
 * Planner for multi-step task decomposition
 */
export class Planner {
  /**
   * Plan the execution of a task
   */
  async plan(task: Task): Promise<ExecutionPlan> {
    // Simple planning: convert tool calls to execution steps
    const steps: ExecutionStep[] = task.toolCalls.map((call, index) => ({
      id: `step-${index}`,
      toolName: call.toolName,
      parameters: call.parameters,
      dependencies: [], // TODO: Implement dependency detection
    }));

    return {
      taskId: task.id,
      steps,
    };
  }
}

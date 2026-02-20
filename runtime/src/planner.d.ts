import type { Task } from "./index";
import type { ExecutionPlan } from "./executor";
/**
 * Planner for multi-step task decomposition
 */
export declare class Planner {
    /**
     * Plan the execution of a task
     */
    plan(task: Task): Promise<ExecutionPlan>;
}

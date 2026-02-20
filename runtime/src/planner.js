/**
 * Planner for multi-step task decomposition
 */
export class Planner {
    /**
     * Plan the execution of a task
     */
    async plan(task) {
        // Simple planning: convert tool calls to execution steps
        const steps = task.toolCalls.map((call, index) => ({
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
//# sourceMappingURL=planner.js.map
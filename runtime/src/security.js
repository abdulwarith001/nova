/**
 * Security manager with capability-based permissions
 */
export class SecurityManager {
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * Authorize an execution plan
     */
    authorize(plan) {
        const allowAll = this.config.allowedTools.includes("*");
        for (const step of plan.steps) {
            // Check if tool is allowed
            if (this.config.allowedTools.length > 0 &&
                !allowAll &&
                !this.config.allowedTools.includes(step.toolName)) {
                throw new Error(`Tool '${step.toolName}' is not in allowlist`);
            }
            // Check if tool is denied
            if (this.config.deniedTools.includes(step.toolName)) {
                throw new Error(`Tool '${step.toolName}' is denied`);
            }
        }
    }
    /**
     * Get default security config
     */
    static default() {
        return {
            sandboxMode: "process",
            allowedTools: ["bash", "read", "write"],
            deniedTools: [],
        };
    }
}
//# sourceMappingURL=security.js.map
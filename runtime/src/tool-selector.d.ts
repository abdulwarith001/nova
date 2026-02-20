import { ToolDefinition } from "./tools.js";
export interface ToolSelectionReasoning {
    toolNames: string[];
    rationale?: string;
    confidence?: number;
}
/**
 * Intelligent tool selector using keyword matching and categories
 */
export declare class ToolSelector {
    /**
     * Score tools by relevance for a given task
     */
    scoreTools(task: string, allTools: ToolDefinition[]): Array<{
        tool: ToolDefinition;
        score: number;
    }>;
    /**
     * Select relevant tools for a given task
     */
    selectTools(task: string, allTools: ToolDefinition[], maxTools?: number): ToolDefinition[];
    /**
     * Select tools using optional reasoning output
     */
    selectToolsWithReasoning(task: string, allTools: ToolDefinition[], context?: {
        maxTools?: number;
        reasoning?: ToolSelectionReasoning;
        fallbackToSimple?: boolean;
    }): Promise<{
        tools: ToolDefinition[];
        reasoning?: ToolSelectionReasoning;
        confidence: number;
    }>;
    /**
     * Calculate relevance score for a tool given a task description
     */
    private calculateRelevance;
    /**
     * Get tools by category
     */
    getToolsByCategory(category: string, allTools: ToolDefinition[]): ToolDefinition[];
    /**
     * Get tool selection explanation (for debugging)
     */
    explainSelection(task: string, selectedTools: ToolDefinition[]): string;
}

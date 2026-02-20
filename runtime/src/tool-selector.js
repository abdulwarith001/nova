/**
 * Intelligent tool selector using keyword matching and categories
 */
export class ToolSelector {
    /**
     * Score tools by relevance for a given task
     */
    scoreTools(task, allTools) {
        const taskLower = task.toLowerCase();
        return allTools
            .map((tool) => ({
            tool,
            score: this.calculateRelevance(taskLower, tool),
        }))
            .sort((a, b) => b.score - a.score);
    }
    /**
     * Select relevant tools for a given task
     */
    selectTools(task, allTools, maxTools = 20) {
        // If we have few tools, return all
        if (allTools.length <= maxTools) {
            return allTools;
        }
        // Score each tool by relevance
        const scored = this.scoreTools(task, allTools);
        // Take top N tools, but include all with score > 0
        const relevant = scored.filter((s) => s.score > 0);
        if (relevant.length === 0) {
            // No matches found, return all tools (let LLM decide)
            return allTools.slice(0, maxTools);
        }
        return relevant.slice(0, maxTools).map((s) => s.tool);
    }
    /**
     * Select tools using optional reasoning output
     */
    async selectToolsWithReasoning(task, allTools, context) {
        const maxTools = context?.maxTools ?? 20;
        const reasoning = context?.reasoning;
        const fallbackToSimple = context?.fallbackToSimple ?? true;
        if (reasoning?.toolNames) {
            if (reasoning.toolNames.length === 0) {
                return {
                    tools: [],
                    reasoning,
                    confidence: reasoning.confidence ?? 0.4,
                };
            }
            const toolMap = new Map(allTools.map((tool) => [tool.name, tool]));
            const ordered = reasoning.toolNames
                .map((name) => toolMap.get(name))
                .filter((tool) => Boolean(tool));
            const limited = ordered.slice(0, maxTools);
            if (limited.length > 0) {
                return {
                    tools: limited,
                    reasoning,
                    confidence: reasoning.confidence ?? 0.6,
                };
            }
            if (!fallbackToSimple) {
                return {
                    tools: [],
                    reasoning,
                    confidence: reasoning.confidence ?? 0.4,
                };
            }
        }
        else if (reasoning && !fallbackToSimple) {
            return {
                tools: [],
                reasoning,
                confidence: reasoning.confidence ?? 0.4,
            };
        }
        const tools = this.selectTools(task, allTools, maxTools);
        return {
            tools,
            reasoning,
            confidence: reasoning?.confidence ?? 0.4,
        };
    }
    /**
     * Calculate relevance score for a tool given a task description
     */
    calculateRelevance(taskLower, tool) {
        let score = 0;
        // Check tool name match (highest weight)
        if (taskLower.includes(tool.name)) {
            score += 10;
        }
        // Check keywords
        if (tool.keywords) {
            for (const keyword of tool.keywords) {
                if (taskLower.includes(keyword.toLowerCase())) {
                    score += 5;
                }
            }
        }
        // Check description
        const descWords = tool.description.toLowerCase().split(/\s+/);
        for (const word of descWords) {
            if (word.length > 3 && taskLower.includes(word)) {
                score += 2;
            }
        }
        // Check examples
        if (tool.examples) {
            for (const example of tool.examples) {
                const exampleWords = example.toLowerCase().split(/\s+/);
                let matchCount = 0;
                for (const word of exampleWords) {
                    if (word.length > 3 && taskLower.includes(word)) {
                        matchCount++;
                    }
                }
                if (matchCount >= 2) {
                    score += 3;
                }
            }
        }
        return score;
    }
    /**
     * Get tools by category
     */
    getToolsByCategory(category, allTools) {
        return allTools.filter((tool) => tool.category === category);
    }
    /**
     * Get tool selection explanation (for debugging)
     */
    explainSelection(task, selectedTools) {
        const taskLower = task.toLowerCase();
        const explanations = [];
        for (const tool of selectedTools) {
            const reasons = [];
            if (taskLower.includes(tool.name)) {
                reasons.push("name match");
            }
            if (tool.keywords) {
                const matched = tool.keywords.filter((k) => taskLower.includes(k.toLowerCase()));
                if (matched.length > 0) {
                    reasons.push(`keywords: ${matched.join(", ")}`);
                }
            }
            if (tool.category) {
                reasons.push(`category: ${tool.category}`);
            }
            if (reasons.length > 0) {
                explanations.push(`${tool.name}: ${reasons.join("; ")}`);
            }
        }
        return explanations.join("\n");
    }
}
//# sourceMappingURL=tool-selector.js.map
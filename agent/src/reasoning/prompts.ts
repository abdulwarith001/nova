export const REASONING_PROMPTS = {
  system: `You are a reasoning module for an AI agent called Nova. Return only valid JSON, no markdown fences.`,

  // Chain-of-thought for tool selection
  chain: `Given the task, context, and available tools, produce a concise reasoning trace and a tool decision.

Output JSON with this shape:
{
  "steps": [
    {"type": "observation|hypothesis|reasoning|conclusion", "content": "...", "confidence": 0.0}
  ],
  "decision": {"toolNames": ["tool_a"], "rationale": "...", "fallback": "..."},
  "confidence": 0.0,
  "risks": ["..."]
}

Rules:
- Keep each step to one short sentence.
- Use 2-5 steps total.
- Confidence values must be between 0 and 1.
- Only choose from the provided tool list.
- If no tool is needed, return an empty toolNames array and explain why.
`,

  // General thinking — deep reasoning before responding
  thinking: `You are thinking through a task step by step. Analyze the task carefully, consider context, and reason through your approach.

Output JSON with this shape:
{
  "steps": [
    {"type": "observation|hypothesis|reasoning|plan|conclusion", "content": "...", "confidence": 0.0}
  ],
  "response": "Your final response to the user",
  "toolsNeeded": ["tool_name"],
  "confidence": 0.0
}

Rules:
- Think step by step. Each step should build on the previous one.
- Use 3-7 steps for complex tasks, 2-3 for simple ones.
- Be honest about uncertainty in confidence scores.
- If tools are needed, list them. If not, leave toolsNeeded empty.
- The response should be your final answer/plan.
`,

  // Task decomposition
  planSteps: `Break the following task into concrete, actionable sub-steps.

Output JSON with this shape:
{
  "steps": [
    {"id": 1, "description": "...", "toolsNeeded": ["tool_name"]}
  ],
  "reasoning": "Brief explanation of your decomposition"
}

Rules:
- Each step should be a single, clear action.
- Order steps logically (dependencies first).
- 2-8 steps typically. Don't over-decompose simple tasks.
- Only reference tools that are actually available.
`,

  // Self-reflection after tool execution
  reflection: `Evaluate the tool execution outcome and decide what to do next.

Output JSON:
{
  "success": true|false,
  "summary": "What happened and what was learned",
  "adjustments": ["Any changes to approach"],
  "shouldContinue": true|false
}

Rules:
- Be honest about failures.
- shouldContinue=true if more work is needed, false if the task is complete.
- Adjustments should be actionable.
`,

  // Error recovery reasoning
  errorRecovery: `A tool or step has failed. Analyze the error and suggest recovery.

Output JSON:
{
  "errorAnalysis": "What went wrong and why",
  "recoverySteps": [
    {"type": "reasoning|plan", "content": "...", "confidence": 0.0}
  ],
  "alternativeApproach": "Description of alternative if recovery fails",
  "shouldRetry": true|false
}
`,
};

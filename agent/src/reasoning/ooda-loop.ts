import { ToolSelector } from "../../../runtime/src/tool-selector.js";
import {
  ObservationResult,
  OrientationCandidate,
  OrientationResult,
  ReasoningContext,
} from "./types.js";

export async function observe(
  context: ReasoningContext,
): Promise<ObservationResult> {
  const maxTools = context.maxTools ?? 20;

  return {
    task: context.task,
    memoryContext: context.memoryContext,
    availableTools: context.tools,
    constraints: {
      maxTools,
    },
    notes: [
      context.memoryContext ? "Memory context available" : "No memory context",
      `Available tools: ${context.tools.length}`,
    ],
  };
}

export async function orient(
  observation: ObservationResult,
  toolSelector: ToolSelector,
): Promise<OrientationResult> {
  const scored = toolSelector.scoreTools(
    observation.task,
    observation.availableTools as any,
  );

  const candidates: OrientationCandidate[] = scored.map((entry) => ({
    tool: entry.tool as any,
    score: entry.score,
    rationale: entry.score > 0 ? "keyword match" : "low match",
  }));

  const confidence =
    candidates.length > 0 ? Math.min(1, candidates[0].score / 10) : 0.2;

  return {
    intent: observation.task,
    candidates,
    confidence,
    risks: candidates.length === 0 ? ["No obvious tool matches found"] : [],
  };
}

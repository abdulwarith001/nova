import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type {
  AgentEvent,
  ReasoningTrace,
  ThinkingResult,
  ThoughtStep,
} from "./types.js";

/**
 * Reasoning Logger — writes all reasoning traces and events to a log file.
 * Default location: ~/.nova/reasoning.log
 */
export class ReasoningLogger {
  private logPath: string;
  private enabled: boolean;

  constructor(logDir?: string, enabled = true) {
    const dir = logDir || join(homedir(), ".nova");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.logPath = join(dir, "reasoning.log");
    this.enabled = enabled;
  }

  /**
   * Log an agent event
   */
  logEvent(event: AgentEvent): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    let entry: string;

    switch (event.type) {
      case "thinking_start":
        entry = `[${timestamp}] 🧠 THINKING START | Iteration ${event.iteration} | Task: ${event.task}`;
        break;
      case "thinking_step":
        entry = `[${timestamp}]   └─ ${event.step.type.toUpperCase()} (conf: ${event.step.confidence.toFixed(2)}): ${event.step.content}`;
        break;
      case "thinking_complete":
        entry = `[${timestamp}] ✅ THINKING COMPLETE | Iteration ${event.iteration} | Confidence: ${event.result.confidence.toFixed(2)} | Steps: ${event.result.steps.length}`;
        break;
      case "tool_start":
        entry = `[${timestamp}] 🔧 TOOL START | ${event.toolName} | Params: ${JSON.stringify(event.parameters)}`;
        break;
      case "tool_complete":
        entry = `[${timestamp}] ${event.error ? "❌" : "✅"} TOOL COMPLETE | ${event.toolName} | ${event.error ? `Error: ${event.error}` : `Result: ${JSON.stringify(event.result).slice(0, 200)}`}`;
        break;
      case "reflection":
        entry = `[${timestamp}] 🪞 REFLECTION | Success: ${event.result.success} | ${event.result.summary} | Continue: ${event.result.shouldContinue ?? "n/a"}`;
        break;
      case "plan_created":
        entry = `[${timestamp}] 📋 PLAN CREATED | ${event.steps.length} steps:\n${event.steps.map((s) => `    ${s.id}. ${s.description}`).join("\n")}`;
        break;
      case "iteration_complete":
        entry = `[${timestamp}] 🔄 ITERATION ${event.iteration}/${event.maxIterations} COMPLETE`;
        break;
      case "task_complete":
        entry = `[${timestamp}] 🏁 TASK COMPLETE | Result: ${event.result.slice(0, 200)}`;
        break;
      default:
        entry = `[${timestamp}] EVENT | ${JSON.stringify(event)}`;
    }

    this.write(entry);
  }

  /**
   * Log a full reasoning trace
   */
  logTrace(trace: ReasoningTrace): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const separator = "═".repeat(80);
    const lines = [
      "",
      separator,
      `[${timestamp}] REASONING TRACE: ${trace.task}`,
      `  Task ID: ${trace.taskId}`,
      `  Duration: ${trace.completedAt ? `${trace.completedAt - trace.startedAt}ms` : "incomplete"}`,
      `  Iterations: ${trace.iterations.length}`,
    ];

    for (const iter of trace.iterations) {
      lines.push(`  ── Iteration ${iter.iteration} ──`);
      for (const step of iter.thinking.steps) {
        lines.push(
          `    [${step.type}] (${step.confidence.toFixed(2)}) ${step.content}`,
        );
      }
      if (iter.toolCalls?.length) {
        lines.push(
          `    Tools called: ${iter.toolCalls.map((t) => t.name).join(", ")}`,
        );
      }
      if (iter.toolResults?.length) {
        for (const r of iter.toolResults) {
          lines.push(
            `    ${r.error ? "❌" : "✅"} ${r.toolName}: ${r.error || JSON.stringify(r.result).slice(0, 100)}`,
          );
        }
      }
      if (iter.reflection) {
        lines.push(`    Reflection: ${iter.reflection.summary}`);
      }
    }

    if (trace.finalResult) {
      lines.push(`  Final Result: ${trace.finalResult.slice(0, 300)}`);
    }
    lines.push(separator, "");

    this.write(lines.join("\n"));
  }

  /**
   * Log a thinking result
   */
  logThinking(taskDescription: string, result: ThinkingResult): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const lines = [
      `[${timestamp}] 💭 THINKING | Task: ${taskDescription}`,
      `  Confidence: ${result.confidence.toFixed(2)}`,
    ];

    for (const step of result.steps) {
      lines.push(`  [${step.type}] ${step.content}`);
    }

    lines.push(`  Response: ${result.response.slice(0, 300)}`);
    if (result.toolCalls?.length) {
      lines.push(`  Tools: ${result.toolCalls.map((t) => t.name).join(", ")}`);
    }

    this.write(lines.join("\n"));
  }

  private write(content: string): void {
    try {
      appendFileSync(this.logPath, content + "\n", "utf-8");
    } catch {
      // Silently fail — logging should never crash the agent
    }
  }
}

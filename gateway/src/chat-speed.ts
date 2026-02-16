export type ChatPath = "fast" | "tool";
export type ChatSpeedMode = "turbo" | "balanced" | "quality";

export interface ChatExecutionPlan {
  path: ChatPath;
  maxIterations: number;
  maxTokens: number;
  temperature: number;
  mode: ChatSpeedMode;
}

export interface ChatHistoryMessage {
  role: string;
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveSpeedMode(rawMode: string | undefined): ChatSpeedMode {
  if (rawMode === "balanced" || rawMode === "quality") {
    return rawMode;
  }
  return "turbo";
}

export function planChatExecution(
  _message: string,
  env: NodeJS.ProcessEnv = process.env,
): ChatExecutionPlan {
  const mode = resolveSpeedMode(env.NOVA_CHAT_SPEED_MODE);

  const defaultMaxIterations = parsePositiveInt(
    env.NOVA_CHAT_MAX_ITER_DEFAULT,
    mode === "quality" ? 2 : 1,
  );

  return {
    path: "tool",
    maxIterations: defaultMaxIterations,
    maxTokens: mode === "quality" ? 700 : mode === "balanced" ? 500 : 320,
    temperature: mode === "quality" ? 0.6 : mode === "balanced" ? 0.4 : 0.2,
    mode,
  };
}

function sanitizeOrphanToolCalls(
  history: ChatHistoryMessage[],
): ChatHistoryMessage[] {
  const cleanHistory: ChatHistoryMessage[] = [];
  for (let i = 0; i < history.length; i++) {
    const message = history[i];
    if (message.tool_calls && message.tool_calls.length > 0) {
      const requiredIds = new Set(message.tool_calls.map((toolCall) => toolCall.id));
      for (let j = i + 1; j < history.length; j++) {
        const toolMessage = history[j];
        if (toolMessage.role === "tool" && toolMessage.tool_call_id) {
          requiredIds.delete(toolMessage.tool_call_id);
        }
      }
      if (requiredIds.size > 0) continue;
    }
    cleanHistory.push(message);
  }
  return cleanHistory;
}

export function trimConversationHistory(
  history: ChatHistoryMessage[],
  maxMessages: number = 12,
): ChatHistoryMessage[] {
  const firstSystemMessage = history.find((message) => message.role === "system");
  const nonSystem = history.filter((message) => message.role !== "system");
  const trimmed = sanitizeOrphanToolCalls(nonSystem.slice(-maxMessages));
  return firstSystemMessage ? [firstSystemMessage, ...trimmed] : trimmed;
}

export function truncateToolContent(
  value: unknown,
  maxChars: number = 1200,
): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }

  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}

export class LatencyTracker {
  private readonly samples: Record<ChatPath, number[]> = {
    fast: [],
    tool: [],
  };

  constructor(private readonly sampleLimit: number = 200) {}

  record(path: ChatPath, totalMs: number): LatencyStats {
    const store = this.samples[path];
    store.push(totalMs);
    if (store.length > this.sampleLimit) {
      store.splice(0, store.length - this.sampleLimit);
    }

    return {
      count: store.length,
      p50: percentile(store, 0.5),
      p95: percentile(store, 0.95),
    };
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[index];
}

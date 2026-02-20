export type ChatProgressStage =
  | "planning"
  | "discovering"
  | "opening_pages"
  | "extracting"
  | "verifying"
  | "searching"
  | "reading_sources"
  | "synthesizing"
  | "finalizing"
  | "done"
  | "error";

export interface ChatProgressEvent {
  type: "response_progress";
  requestId?: string;
  stage: ChatProgressStage;
  message: string;
  timestamp: number;
  iteration?: number;
}

type InternalExternalDataEventType =
  | "tool_start"
  | "tool_complete"
  | "synthesis_start"
  | "finalized";

export interface InternalExternalDataEvent {
  type: InternalExternalDataEventType;
  timestamp?: number;
  details?: Record<string, unknown>;
}

const STAGE_MESSAGES: Record<ChatProgressStage, string> = {
  planning: "Planning next steps...",
  discovering: "Discovering relevant web pages...",
  opening_pages: "Opening web pages...",
  extracting: "Extracting structured web content...",
  verifying: "Cross-checking web context...",
  searching: "Checking web data...",
  reading_sources: "Reading page content...",
  synthesizing: "Combining context into an answer...",
  finalizing: "Finalizing response...",
  done: "Web assist complete.",
  error: "Web assist ran into an error.",
};

export function createProgressEvent(
  stage: ChatProgressStage,
  options?: {
    requestId?: string;
    timestamp?: number;
    message?: string;
    iteration?: number;
  },
): ChatProgressEvent {
  return {
    type: "response_progress",
    requestId: options?.requestId,
    stage,
    message: options?.message || STAGE_MESSAGES[stage],
    timestamp: options?.timestamp || Date.now(),
    iteration: options?.iteration,
  };
}

export function mapExternalDataEventToProgress(
  event: InternalExternalDataEvent,
  requestId?: string,
): ChatProgressEvent | null {
  if (event.type === "synthesis_start") {
    const forced = event.details?.forced === true;
    const repair = event.details?.repair === true;
    const iteration = toPositiveInt(event.details?.iteration);

    if (forced || repair) {
      return createProgressEvent("synthesizing", {
        requestId,
        timestamp: event.timestamp,
      });
    }

    return createProgressEvent("planning", {
      requestId,
      timestamp: event.timestamp,
      iteration,
      message:
        iteration && iteration > 1
          ? "Planning next web-assist step..."
          : STAGE_MESSAGES.planning,
    });
  }

  if (event.type === "tool_start") {
    const toolName = String(event.details?.name || "").toLowerCase();
    const stage = resolveToolStage(toolName);
    return createProgressEvent(stage, {
      requestId,
      timestamp: event.timestamp,
    });
  }

  if (event.type === "tool_complete") {
    const toolName = String(event.details?.name || "").toLowerCase();
    if (toolName === "web_session_backend") {
      const backend = String(event.details?.backend || "").trim();
      const liveViewUrl = String(event.details?.liveViewUrl || "").trim();
      const backendLabel = backend ? `Connected backend: ${backend}` : "Connected browser backend.";
      const suffix = liveViewUrl ? ` Live view: ${liveViewUrl}` : "";
      return createProgressEvent("planning", {
        requestId,
        timestamp: event.timestamp,
        message: `${backendLabel}${suffix}`,
      });
    }
  }

  if (event.type === "finalized") {
    return createProgressEvent("done", {
      requestId,
      timestamp: event.timestamp,
    });
  }

  return null;
}

function resolveToolStage(toolName: string): ChatProgressStage {
  if (!toolName) return "reading_sources";
  if (toolName.startsWith("web_search")) return "searching";
  if (toolName.startsWith("web_session_start")) return "planning";
  if (toolName.startsWith("web_decide_next")) return "planning";
  if (toolName.startsWith("web_act")) return "opening_pages";
  if (toolName.startsWith("web_observe")) return "reading_sources";
  if (toolName.startsWith("web_extract_structured")) return "extracting";
  if (toolName.startsWith("web_session_end")) return "finalizing";
  if (
    toolName.includes("search") ||
    toolName.includes("lookup") ||
    toolName.includes("discover")
  ) {
    return "searching";
  }
  if (
    toolName.includes("fetch") ||
    toolName.includes("extract")
  ) {
    return "reading_sources";
  }
  return "reading_sources";
}

function toPositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}
